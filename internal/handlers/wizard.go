package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"path/filepath"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/pdf"
	"github.com/jpcranford/sonneck/internal/repo"
	"github.com/jpcranford/sonneck/internal/storage"
	"github.com/jpcranford/sonneck/internal/wizard"
)

// ConfirmImportRequest is the wizard's steps 2-4 combined (design doc §5):
// boundaries are the split points (see wizard.ComputePieceRanges), pieces
// is the per-piece field data collected in step 3, one entry per resulting
// range — so len(pieces) must equal len(boundaries)+1.
type ConfirmImportRequest struct {
	Boundaries []int                   `json:"boundaries"`
	Pieces     []api.PieceWriteRequest `json:"pieces"`
}

type stagedPiece struct {
	tempPath string
	hash     string
	start    int
	end      int
}

// handleConfirmImport implements design doc §5's transactional guarantee
// verbatim: extract every piece into a staging area first; only once every
// extraction succeeds does a single DB transaction insert all Piece rows;
// only after that transaction commits are the staged files moved into
// their final library/pieces/ location. A failure at any point before
// commit leaves nothing committed and the staging directory is simply
// discarded — never a half-imported book.
func (s *Server) handleConfirmImport(w http.ResponseWriter, r *http.Request) {
	bookID, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid book id")
		return
	}

	var req ConfirmImportRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}

	book, err := repo.GetBookByID(r.Context(), s.DB, bookID)
	if err != nil {
		s.writeError(w, err)
		return
	}

	totalPages, err := pdf.PageCount(r.Context(), book.FilePath)
	if err != nil {
		s.writeError(w, err)
		return
	}

	ranges, err := wizard.ComputePieceRanges(totalPages, req.Boundaries)
	if err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, err.Error())
		return
	}
	if len(ranges) != len(req.Pieces) {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError,
			fmt.Sprintf("expected %d piece(s) (one per range), got %d", len(ranges), len(req.Pieces)))
		return
	}

	stagingDir := filepath.Join(s.Cfg.DataDir, "library", "pieces")
	if err := os.MkdirAll(stagingDir, 0o755); err != nil {
		s.writeError(w, err)
		return
	}

	staged := make([]stagedPiece, 0, len(ranges))
	defer func() {
		// Any staged file that never made it into a committed piece (the
		// happy path clears this slice down to nothing before returning)
		// gets discarded here.
		for _, sp := range staged {
			os.Remove(sp.tempPath)
		}
	}()

	for _, rg := range ranges {
		tmp, err := os.CreateTemp(stagingDir, "extract-*.pdf")
		if err != nil {
			s.writeError(w, err)
			return
		}
		tempPath := tmp.Name()
		tmp.Close()

		if err := pdf.ExtractPages(r.Context(), book.FilePath, rg.Start, rg.End, tempPath); err != nil {
			os.Remove(tempPath)
			s.writeError(w, err)
			return
		}
		hash, _, err := storage.HashFile(tempPath)
		if err != nil {
			os.Remove(tempPath)
			s.writeError(w, err)
			return
		}
		staged = append(staged, stagedPiece{tempPath: tempPath, hash: hash, start: rg.Start, end: rg.End})
	}

	var createdIDs []int64
	err = s.withTx(r.Context(), func(tx *sql.Tx) error {
		for i, sp := range staged {
			start, end := sp.start, sp.end
			p := &models.Piece{
				SourceBookID: &bookID,
				FilePath:     storage.PiecePath(s.Cfg.DataDir, sp.hash),
				FileHash:     sp.hash,
				PageCount:    end - start + 1,
			}

			if err := applyPieceWriteRequest(r.Context(), tx, p, req.Pieces[i]); err != nil {
				return fmt.Errorf("piece %d (pages %d-%d): %w", i+1, start, end, err)
			}
			// The actual extraction range is authoritative here — it must
			// win over whatever req happened to carry (the wizard's fill
			// step doesn't collect these; they're seeded from the real
			// split, editable later via the piece edit menu, design doc
			// §15). Setting these after applyPieceWriteRequest, not
			// before, is what makes that override correct rather than a
			// silent page-range bug.
			p.SourcePageStart = &start
			p.SourcePageEnd = &end

			errs, err := api.ValidatePiece(r.Context(), tx, p)
			if err != nil {
				return err
			}
			if len(errs) > 0 {
				return fmt.Errorf("piece %d (pages %d-%d): %w", i+1, start, end, errs)
			}

			id, err := repo.CreatePiece(r.Context(), tx, p)
			if err != nil {
				return err
			}
			p.ID = id

			if err := repo.SetPieceInstruments(r.Context(), tx, id, p.InstrumentIDs); err != nil {
				return err
			}
			if err := repo.SetPieceUserTags(r.Context(), tx, id, p.UserTagIDs); err != nil {
				return err
			}
			if err := repo.ResyncSearchIndex(r.Context(), tx, id); err != nil {
				return err
			}

			createdIDs = append(createdIDs, id)
		}
		return nil
	})
	if err != nil {
		s.writeError(w, err)
		return
	}

	// Committed — move every staged file into place. A failure here
	// (unlike anything above) leaves a Piece row pointing at a
	// not-yet-relocated file; per design doc §5 this window is the
	// accepted edge of the transactional guarantee, not something rolled
	// back. Best-effort: keep moving the rest and log what failed.
	for _, sp := range staged {
		finalPath := storage.PiecePath(s.Cfg.DataDir, sp.hash)
		if err := storage.MoveIntoPlace(sp.tempPath, finalPath); err != nil {
			s.Logger.Error("failed to move staged piece file into place after commit",
				"error", err, "bookId", bookID, "tempPath", sp.tempPath, "finalPath", finalPath)
		}
	}
	staged = nil // moved (or logged as failed) — the deferred cleanup above is now a no-op

	responses := make([]*api.PieceResponse, 0, len(createdIDs))
	for _, id := range createdIDs {
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
		responses = append(responses, resp)
	}

	api.WriteData(w, http.StatusCreated, map[string]any{"pieces": responses})
}
