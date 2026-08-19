package handlers

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
	"github.com/jpcranford/sonneck/internal/storage"
)

// handleCreatePiece is design doc §5's "Single-piece upload (no book)"
// path: upload a PDF directly, creating a bare Piece with just the file
// and a filename-derived title. It deliberately does NOT run
// api.ValidatePiece — that only applies to the two flows CLAUDE.md names
// (the wizard's fill step and the standalone edit menu), both of which
// happen via handleUpdatePiece after this upload completes.
//
// Dedupes on SHA-256 match against any existing Piece (CLAUDE.md > File
// handling), same rule as Book uploads: an identical file returns the
// existing Piece with 200 OK instead of creating a duplicate row, so the
// frontend can route the user to the piece that already represents this
// file rather than minting a second one.
func (s *Server) handleCreatePiece(w http.ResponseWriter, r *http.Request) {
	file, header, ok := requireMultipartFile(w, r)
	if !ok {
		return
	}
	defer file.Close()

	stagingDir := filepath.Join(s.Cfg.DataDir, "library", "pieces")
	tempPath, hash, pageCount, ok := s.stageUpload(w, r, stagingDir, file)
	if !ok {
		return
	}

	existing, err := repo.GetPieceByFileHash(r.Context(), s.DB, hash)
	if err != nil && !errors.Is(err, repo.ErrNotFound) {
		s.writeError(w, err)
		return
	}
	if existing != nil {
		os.Remove(tempPath)
		resp, err := api.BuildPieceResponse(r.Context(), s.DB, existing)
		if err != nil {
			s.writeError(w, err)
			return
		}
		api.WriteData(w, http.StatusOK, resp)
		return
	}

	finalPath := storage.PiecePath(s.Cfg.DataDir, hash)
	if err := storage.MoveIntoPlace(tempPath, finalPath); err != nil {
		s.writeError(w, err)
		return
	}

	var resp *api.PieceResponse
	err = s.withTx(r.Context(), func(tx *sql.Tx) error {
		p := &models.Piece{
			Title:         defaultTitleFromFilename(header.Filename),
			ImslpNumber:   detectImslpNumber(header.Filename),
			FilePath:      finalPath,
			FileHash:      hash,
			PageCount:     pageCount,
			ThumbnailPage: 1,
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
		if err := repo.SetPieceKeys(r.Context(), tx, id, p.KeyIDs); err != nil {
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
		// orphanedBook.FilePath is nil only for a manually created book
		// (migration 00014) — which, in practice, can never actually reach
		// this path (nothing can attach a Piece to a book with no PDF to
		// split), but the field is nullable now regardless, so this stays
		// a real nil check rather than an assumed-safe dereference.
		if orphanedBook.FilePath != nil {
			if err := os.Remove(*orphanedBook.FilePath); err != nil && !os.IsNotExist(err) {
				s.Logger.Error("failed to remove book file after orphan cleanup", "error", err, "bookId", orphanedBook.ID, "filePath", *orphanedBook.FilePath)
			}
		}
		// slog's default formatting of a *string logs the pointer address,
		// not the value it points to (fmt only auto-derefs pointer-to-
		// struct/slice/map for %v, not pointer-to-scalar) — dereference
		// explicitly rather than let a real hash silently log as 0xc000....
		fileHash := "(none)"
		if orphanedBook.FileHash != nil {
			fileHash = *orphanedBook.FileHash
		}
		s.Logger.Info("orphaned book cleaned up", "bookId", orphanedBook.ID, "fileHash", fileHash, "reason", "last referencing piece deleted")
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

// handlePieceThumbnail renders (and caches) a single page of a piece's own
// file as a PNG — the Library view's card thumbnail and page-cycle control
// (design doc §11) and a building block for the basic piece preview (§7).
// Unlike handleBookPageThumbnail, this always renders from p.FilePath, never
// a book's file: a Piece's file is already just that piece's own content,
// whether it's a book-extraction (already split down to this piece's pages)
// or a standalone upload — so this is the one thumbnail route that works
// for every piece regardless of provenance, with no dependency on
// sourceBookId being set. page is validated against the piece's own
// PageCount (populated at upload/replace time — see CreatePiece call sites),
// not the book's.
func (s *Server) handlePieceThumbnail(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid piece id")
		return
	}
	page, err := strconv.Atoi(r.PathValue("page"))
	if err != nil || page < 1 {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid page number")
		return
	}

	p, err := repo.GetPieceByID(r.Context(), s.DB, id)
	if err != nil {
		s.writeError(w, err)
		return
	}
	if page > p.PageCount {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError,
			fmt.Sprintf("page %d exceeds this piece's %d page(s)", page, p.PageCount))
		return
	}

	thumbPath, err := s.cachedThumbnail(r.Context(), p.FilePath, page, 100, fmt.Sprintf("piece-%d-page-%d", id, page))
	if err != nil {
		s.writeError(w, err)
		return
	}

	http.ServeFile(w, r, thumbPath)
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
	tempPath, newHash, newPageCount, ok := s.stageUpload(w, r, stagingDir, file)
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
		p.PageCount = newPageCount
		// A prior manual thumbnail-page pick almost certainly no longer
		// points at the same content (or may not even be a valid page
		// number anymore, if the new file is shorter) — reset to 1 rather
		// than carry a stale/out-of-range selection forward silently.
		p.ThumbnailPage = 1
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

	// handlePieceThumbnail caches per page by piece id, not file hash — every
	// cached page for this piece is now stale (both its content and how many
	// pages exist may have changed), so clear all of them and let requests
	// re-render on demand (derived data, safe to just remove).
	stalePattern := filepath.Join(s.Cfg.DataDir, "cache", "thumbnails", fmt.Sprintf("piece-%d-page-*.png", id))
	if stale, err := filepath.Glob(stalePattern); err != nil {
		s.Logger.Error("failed to list stale piece thumbnails after file replace", "error", err, "pieceId", id)
	} else {
		for _, f := range stale {
			if err := os.Remove(f); err != nil && !os.IsNotExist(err) {
				s.Logger.Error("failed to invalidate stale piece thumbnail after file replace", "error", err, "pieceId", id, "file", f)
			}
		}
	}

	s.Logger.Info("piece file replaced", "pieceId", id, "oldFileHash", oldFileHash, "newFileHash", newHash)

	api.WriteData(w, http.StatusOK, resp)
}

type setThumbnailPageRequest struct {
	Page int `json:"page"`
}

// handleSetPieceThumbnailPage lets the user manually pick which rendered
// page becomes this piece's Library card thumbnail — a design doc §14
// addition made during the Piece View's build, not in the original spec.
// A small, single-purpose action endpoint (same shape as replace-file),
// not folded into PieceWriteRequest/handleUpdatePiece: that's a full-form
// replace meant for the (not-yet-built) Piece Properties Edit Menu, and
// this is a one-click action triggered from the preview, not a field edit.
func (s *Server) handleSetPieceThumbnailPage(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid piece id")
		return
	}

	var req setThumbnailPageRequest
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

		if req.Page < 1 || req.Page > p.PageCount {
			return api.ValidationErrors{{
				Field:   "page",
				Message: fmt.Sprintf("must be between 1 and %d", p.PageCount),
			}}
		}

		p.ThumbnailPage = req.Page
		p.UpdatedAt = time.Now().UTC()
		if err := repo.UpdatePiece(r.Context(), tx, p); err != nil {
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
