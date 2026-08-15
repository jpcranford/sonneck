package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/jpcranford/picarda/internal/api"
	"github.com/jpcranford/picarda/internal/models"
	"github.com/jpcranford/picarda/internal/repo"
	"github.com/jpcranford/picarda/internal/storage"
)

// handleCreatePiece is design doc §5's "Single-piece upload (no book)"
// path: upload a PDF directly, creating a bare Piece with just the file
// and a filename-derived title. It deliberately does NOT run
// api.ValidatePiece — that only applies to the two flows CLAUDE.md names
// (the wizard's fill step and the standalone edit menu), both of which
// happen via handleUpdatePiece after this upload completes.
func (s *Server) handleCreatePiece(w http.ResponseWriter, r *http.Request) {
	file, header, ok := requireMultipartFile(w, r)
	if !ok {
		return
	}
	defer file.Close()

	stagingDir := filepath.Join(s.Cfg.DataDir, "library", "pieces")
	tempPath, hash, _, ok := s.stageUpload(w, r, stagingDir, file)
	if !ok {
		return
	}

	finalPath := storage.PiecePath(s.Cfg.DataDir, hash)
	if err := storage.MoveIntoPlace(tempPath, finalPath); err != nil {
		s.writeError(w, err)
		return
	}

	var resp *api.PieceResponse
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		p := &models.Piece{
			Title:       defaultTitleFromFilename(header.Filename),
			ImslpNumber: detectImslpNumber(header.Filename),
			FilePath:    finalPath,
			FileHash:    hash,
		}
		id, err := repo.CreatePiece(r.Context(), tx, p)
		if err != nil {
			return err
		}

		if err := repo.ResyncSearchIndex(r.Context(), tx, id); err != nil {
			return err
		}

		// Re-fetch rather than reusing p: CreatePiece doesn't populate
		// DB-assigned defaults (createdAt/updatedAt) back onto it, and the
		// response must reflect what's actually stored, not what was sent.
		created, err := repo.GetPieceByID(r.Context(), tx, id)
		if err != nil {
			return err
		}
		resp, err = api.BuildPieceResponse(r.Context(), tx, created)
		return err
	})
	if err != nil {
		s.writeError(w, err)
		return
	}

	api.WriteData(w, http.StatusCreated, resp)
}

func (s *Server) handleGetPiece(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid piece id")
		return
	}

	p, err := repo.GetPieceByID(r.Context(), s.DB, id)
	if err != nil {
		s.writeError(w, err)
		return
	}
	resp, err := api.BuildPieceResponse(r.Context(), s.DB, p)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, resp)
}

// handleUpdatePiece is the standalone Piece Properties Edit Menu (design
// doc §15) — one of the two flows that must run api.ValidatePiece.
func (s *Server) handleUpdatePiece(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid piece id")
		return
	}

	var req api.PieceWriteRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}

	var resp *api.PieceResponse
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		p, err := repo.GetPieceByID(r.Context(), tx, id)
		if err != nil {
			return err
		}

		if err := applyPieceWriteRequest(r.Context(), tx, p, req); err != nil {
			return err
		}

		errs, err := api.ValidatePiece(r.Context(), tx, p)
		if err != nil {
			return err
		}
		if len(errs) > 0 {
			return errs
		}

		p.UpdatedAt = time.Now().UTC()
		if err := repo.UpdatePiece(r.Context(), tx, p); err != nil {
			return err
		}
		if err := repo.SetPieceInstruments(r.Context(), tx, id, p.InstrumentIDs); err != nil {
			return err
		}
		if err := repo.SetPieceUserTags(r.Context(), tx, id, p.UserTagIDs); err != nil {
			return err
		}
		if err := repo.ResyncSearchIndex(r.Context(), tx, id); err != nil {
			return err
		}

		resp, err = api.BuildPieceResponse(r.Context(), tx, p)
		return err
	})
	if err != nil {
		s.writeError(w, err)
		return
	}

	api.WriteData(w, http.StatusOK, resp)
}

// handleDeletePiece implements CLAUDE.md > File handling's deletion
// semantics: hard delete + orphan cleanup, both logged at INFO. The DB
// transaction (row delete, FTS resync, orphan detection/deletion) commits
// first; only once that's durably true do we touch the filesystem.
func (s *Server) handleDeletePiece(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid piece id")
		return
	}

	var deletedPiece *models.Piece
	var orphanedBook *models.Book
	var fileStillReferenced bool

	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		p, err := repo.GetPieceByID(r.Context(), tx, id)
		if err != nil {
			return err
		}
		deletedPiece = p

		if err := repo.DeletePiece(r.Context(), tx, id); err != nil {
			return err
		}
		if err := repo.ResyncSearchIndex(r.Context(), tx, id); err != nil {
			return err
		}

		// Storage is content-addressed but piece uploads aren't deduped on
		// hash the way book uploads are, so another piece row can
		// legitimately still point at this same file (identical content
		// from two different extractions or uploads). This count runs
		// after the delete above, in the same transaction, so it already
		// excludes the row just removed.
		remaining, err := repo.CountPiecesWithFileHash(r.Context(), tx, p.FileHash)
		if err != nil {
			return err
		}
		fileStillReferenced = remaining > 0

		if p.SourceBookID != nil {
			count, err := repo.CountPiecesForBook(r.Context(), tx, *p.SourceBookID)
			if err != nil {
				return err
			}
			if count == 0 {
				book, err := repo.GetBookByID(r.Context(), tx, *p.SourceBookID)
				if err != nil {
					return err
				}
				if err := repo.DeleteBook(r.Context(), tx, book.ID); err != nil {
					return err
				}
				orphanedBook = book
			}
		}
		return nil
	})
	if err != nil {
		s.writeError(w, err)
		return
	}

	if !fileStillReferenced {
		if err := os.Remove(deletedPiece.FilePath); err != nil && !os.IsNotExist(err) {
			s.Logger.Error("failed to remove piece file after delete", "error", err, "pieceId", id, "filePath", deletedPiece.FilePath)
		}
	}
	s.Logger.Info("piece deleted", "pieceId", deletedPiece.ID, "fileHash", deletedPiece.FileHash, "title", deletedPiece.Title)

	if orphanedBook != nil {
		if err := os.Remove(orphanedBook.FilePath); err != nil && !os.IsNotExist(err) {
			s.Logger.Error("failed to remove book file after orphan cleanup", "error", err, "bookId", orphanedBook.ID, "filePath", orphanedBook.FilePath)
		}
		s.Logger.Info("orphaned book cleaned up", "bookId", orphanedBook.ID, "fileHash", orphanedBook.FileHash, "reason", "last referencing piece deleted")
	}

	api.WriteData(w, http.StatusOK, map[string]any{"deleted": true, "id": id})
}

// handleDownloadPieceFile is design doc §7's stable route, shared by
// preview and download. Content-Disposition is set to "inline" (not
// "attachment") with a title-derived filename — this suggests a sensible
// name for "Save As" without forcing a download, so the same route still
// works for the piece preview embed.
func (s *Server) handleDownloadPieceFile(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid piece id")
		return
	}
	p, err := repo.GetPieceByID(r.Context(), s.DB, id)
	if err != nil {
		s.writeError(w, err)
		return
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", sanitizeFilename(p.Title)+".pdf"))
	http.ServeFile(w, r, p.FilePath)
}

// handleReplacePieceFile hard-replaces a piece's file on the same record
// (design doc §14): sourceBookId/sourcePageStart/sourcePageEnd are
// deliberately left untouched as historical provenance. The new file is
// moved into its content-addressed final path BEFORE the DB row is
// updated, and the old file is only removed AFTER the transaction commits
// — so a failure at any point leaves either the old (DB row + file) pair
// or the new one intact, never a row pointing at a missing file.
func (s *Server) handleReplacePieceFile(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid piece id")
		return
	}

	file, _, ok := requireMultipartFile(w, r)
	if !ok {
		return
	}
	defer file.Close()

	stagingDir := filepath.Join(s.Cfg.DataDir, "library", "pieces")
	tempPath, newHash, _, ok := s.stageUpload(w, r, stagingDir, file)
	if !ok {
		return
	}

	newPath := storage.PiecePath(s.Cfg.DataDir, newHash)
	// Content-addressed storage means newPath may already exist (this
	// upload happens to match another piece's content) — remember that
	// before moving, so a later failure never deletes a file something
	// else still references.
	_, statErr := os.Stat(newPath)
	newPathPreexisted := statErr == nil
	if err := storage.MoveIntoPlace(tempPath, newPath); err != nil {
		s.writeError(w, err)
		return
	}

	var oldFilePath, oldFileHash string
	var resp *api.PieceResponse
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		p, err := repo.GetPieceByID(r.Context(), tx, id)
		if err != nil {
			return err
		}
		oldFilePath, oldFileHash = p.FilePath, p.FileHash

		p.FilePath = newPath
		p.FileHash = newHash
		p.UpdatedAt = time.Now().UTC()
		if err := repo.UpdatePiece(r.Context(), tx, p); err != nil {
			return err
		}
		if err := repo.ResyncSearchIndex(r.Context(), tx, id); err != nil {
			return err
		}

		resp, err = api.BuildPieceResponse(r.Context(), tx, p)
		return err
	})
	if err != nil {
		// The DB write didn't happen. Only remove newPath if this request
		// was the one that created it — if it already existed (content
		// happened to match something else already stored), some other
		// row may reference it and it must not be touched.
		if !newPathPreexisted {
			os.Remove(newPath)
		}
		s.writeError(w, err)
		return
	}

	if oldFilePath != newPath {
		// Same content-addressed-storage caveat as handleDeletePiece: this
		// piece's own row now points at newHash (committed above), so if
		// another piece still has oldFileHash, it's a genuinely different
		// row still relying on this file — don't remove it out from
		// under that piece.
		remaining, err := repo.CountPiecesWithFileHash(r.Context(), s.DB, oldFileHash)
		if err != nil {
			s.Logger.Error("failed to check old file hash reference count after replace", "error", err, "pieceId", id, "fileHash", oldFileHash)
		} else if remaining == 0 {
			if err := os.Remove(oldFilePath); err != nil && !os.IsNotExist(err) {
				s.Logger.Error("failed to remove old piece file after replace", "error", err, "pieceId", id, "filePath", oldFilePath)
			}
		}
	}
	s.Logger.Info("piece file replaced", "pieceId", id, "oldFileHash", oldFileHash, "newFileHash", newHash)

	api.WriteData(w, http.StatusOK, resp)
}
