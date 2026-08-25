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
// ranges are the per-piece page ranges computed by the Split screen's own
// UI (see wizard.ValidateRanges — the server validates, it doesn't derive),
// pieces is the per-piece field data collected in step 3, one entry per
// range in the same order — so len(pieces) must equal len(ranges).
type ConfirmImportRequest struct {
	Ranges []wizard.PageRange      `json:"ranges"`
	Pieces []api.PieceWriteRequest `json:"pieces"`
	// PageOffset (design doc §5, added post-launch) — a single whole-book
	// correction applied to every piece's SourcePageStart/SourcePageEnd,
	// set on the wizard's "About this book" screen via a page cycler bound
	// to a "printed page number for this PDF page" field. Extraction and
	// PageCount below are entirely unaffected — Ranges stay the raw
	// physical PDF page positions, since that's what actually needs
	// extracting; PageOffset only shifts what gets written into the
	// citation-facing SourcePageStart/SourcePageEnd fields. Zero value
	// (omitted, or an unmodified book) is a no-op, so this is a strict
	// backward-compatible addition — existing callers that never set it
	// get today's exact behavior.
	PageOffset int `json:"pageOffset"`
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
	// A manually created book (migration 00014 — the Books library view's
	// "New Book" button) has no PDF to split at all, so this endpoint
	// (reachable, in the normal flow, only after handleUploadBook) doesn't
	// apply to it — a clear validation error, not a nil-pointer panic.
	if book.FilePath == nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "this book has no file to import from")
		return
	}

	totalPages, err := pdf.PageCount(r.Context(), *book.FilePath)
	if err != nil {
		s.writeError(w, err)
		return
	}

	if err := wizard.ValidateRanges(totalPages, req.Ranges); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, err.Error())
		return
	}
	if len(req.Ranges) != len(req.Pieces) {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError,
			fmt.Sprintf("expected %d piece(s) (one per range), got %d", len(req.Ranges), len(req.Pieces)))
		return
	}
	ranges := req.Ranges

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

		if err := pdf.ExtractPages(r.Context(), *book.FilePath, rg.Start, rg.End, tempPath); err != nil {
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
				SourceBookID:  &bookID,
				FilePath:      storage.PiecePath(s.Cfg.DataDir, sp.hash),
				FileHash:      sp.hash,
				PageCount:     end - start + 1,
				ThumbnailPage: 1,
			}

			if err := applyPieceWriteRequest(r.Context(), tx, p, req.Pieces[i]); err != nil {
				return fmt.Errorf("piece %d (pages %d-%d): %w", i+1, start, end, err)
			}
			// The actual book/extraction range is authoritative here — it
			// must win over whatever req happened to carry (the wizard's
			// fill step doesn't collect a sourceBookId or page range at
			// all; they're seeded from the real split, editable later via
			// the piece edit menu, design doc §15). Setting these after
			// applyPieceWriteRequest, not before, is what makes the
			// override correct rather than a silent bug — req.Pieces[i]
			// has no sourceBookId key in its JSON body, so
			// applyPieceWriteRequest's own (correct, general-case)
			// full-replace handling of that field would otherwise null out
			// the &bookID this piece was just constructed with above.
			p.SourceBookID = &bookID
			// The printed-page correction from Screen 3 applies here, not to
			// `start`/`end` themselves — those two remain the raw physical
			// PDF range used for extraction/PageCount above.
			adjustedStart := start + req.PageOffset
			adjustedEnd := end + req.PageOffset
			p.SourcePageStart = &adjustedStart
			p.SourcePageEnd = &adjustedEnd

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
