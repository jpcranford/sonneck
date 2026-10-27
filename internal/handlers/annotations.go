package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/repo"
)

// The Sheet Viewer's annotations (migration 00035): the caller's own marks
// on a piece, `read` then `practice` like every viewer write. The viewer
// loads a piece's pages at once and saves one page whole each time it
// changes.

// maxAnnotationBody caps one page's save: thousands of strokes still fit.
const maxAnnotationBody = 8 << 20

type annotationsResponse struct {
	// Pages with marks, by page number (as JSON object keys).
	Pages map[int]json.RawMessage `json:"pages"`
}

// handleGetAnnotations returns the caller's marks on every page of a piece.
func (s *Server) handleGetAnnotations(w http.ResponseWriter, r *http.Request) {
	user, id, ok := s.practiceRequest(w, r)
	if !ok {
		return
	}
	if _, err := repo.GetPieceByID(r.Context(), s.DB, id); err != nil {
		s.writeError(w, err)
		return
	}
	pages, err := repo.GetAnnotations(r.Context(), s.DB, user.ID, id)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, annotationsResponse{Pages: pages})
}

// handlePutPageAnnotations replaces the caller's marks on one page (full
// replace; an empty list clears the page).
func (s *Server) handlePutPageAnnotations(w http.ResponseWriter, r *http.Request) {
	user, id, ok := s.practiceRequest(w, r)
	if !ok {
		return
	}
	page, err := strconv.Atoi(r.PathValue("page"))
	if err != nil || page < 1 {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid page")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxAnnotationBody)
	var req struct {
		Marks json.RawMessage `json:"marks"`
	}
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}
	if len(req.Marks) == 0 {
		req.Marks = json.RawMessage("[]")
	}
	marks, count, err := repo.NormalizeMarks(req.Marks)
	if err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, err.Error())
		return
	}
	err = s.withTx(r.Context(), func(tx *sql.Tx) error {
		p, err := repo.GetPieceByID(r.Context(), tx, id)
		if err != nil {
			return err
		}
		if page > p.PageCount {
			return errPageOutOfRange
		}
		return repo.SetPageAnnotations(r.Context(), tx, user.ID, id, page, marks, count)
	})
	if errors.Is(err, errPageOutOfRange) {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "the piece has no such page")
		return
	}
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, map[string]any{"page": page, "marks": marks})
}

var errPageOutOfRange = errors.New("page out of range")
