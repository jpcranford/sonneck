package handlers

import (
	"database/sql"
	"net/http"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

// The Sheet Viewer's own writes: the caller's notes on a piece and their
// per-piece viewer settings. Both are gated `read` then `practice` — the
// permission the viewer itself needs — never `edit`: they're the caller's
// own data, not library metadata (same shape as the practice-status
// endpoint).

// handleSetPieceUserNotes sets (or, empty or null, clears) the caller's
// notes on one piece, from the viewer's Info panel. The full
// PATCH /api/pieces/{id} still accepts notes too, for Edit Piece.
func (s *Server) handleSetPieceUserNotes(w http.ResponseWriter, r *http.Request) {
	user, id, ok := s.practiceRequest(w, r)
	if !ok {
		return
	}
	var req struct {
		UserNotes *string `json:"userNotes"`
	}
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
		if err := repo.SetUserNotes(r.Context(), tx, user.ID, id, req.UserNotes); err != nil {
			return err
		}
		resp, err = api.BuildPieceResponse(r.Context(), tx, p, s.Cfg.CopyrightRegion(), user.ID)
		return err
	})
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, resp)
}

// handleGetPracticeSettings returns the caller's viewer settings for one
// piece — the defaults when they've never adjusted it.
func (s *Server) handleGetPracticeSettings(w http.ResponseWriter, r *http.Request) {
	user, id, ok := s.practiceRequest(w, r)
	if !ok {
		return
	}
	if _, err := repo.GetPieceByID(r.Context(), s.DB, id); err != nil {
		s.writeError(w, err)
		return
	}
	settings, err := repo.GetPracticeSettings(r.Context(), s.DB, user.ID, id)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, settings)
}

// handlePutPracticeSettings replaces the caller's viewer settings for one
// piece. Every field is sent every time (full replace, like the setlist
// order's PUT).
func (s *Server) handlePutPracticeSettings(w http.ResponseWriter, r *http.Request) {
	user, id, ok := s.practiceRequest(w, r)
	if !ok {
		return
	}
	var req repo.PracticeSettings
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}
	if req.HiddenColors < 0 || req.HiddenColors >= 1<<repo.AnnotationColors {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "hiddenColors must name only the six colors")
		return
	}
	for _, v := range []int{req.Brightness, req.Contrast} {
		if v < repo.PhotoStepMin || v > repo.PhotoStepMax || v%repo.PhotoStep != 0 {
			api.WriteError(w, http.StatusBadRequest, api.CodeValidationError,
				"brightness and contrast must be 50 to 150, in steps of 10")
			return
		}
	}
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		if _, err := repo.GetPieceByID(r.Context(), tx, id); err != nil {
			return err
		}
		return repo.SetPracticeSettings(r.Context(), tx, user.ID, id, req)
	})
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, req)
}

// practiceRequest checks `read` then `practice` and reads the piece id.
func (s *Server) practiceRequest(w http.ResponseWriter, r *http.Request) (*models.User, int64, bool) {
	if _, ok := s.requirePermission(w, r, models.PermissionRead); !ok {
		return nil, 0, false
	}
	user, ok := s.requirePermission(w, r, models.PermissionPractice)
	if !ok {
		return nil, 0, false
	}
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid piece id")
		return nil, 0, false
	}
	return user, id, true
}
