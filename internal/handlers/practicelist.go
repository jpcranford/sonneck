package handlers

import (
	"database/sql"
	"errors"
	"net/http"
	"time"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

// The Sheet Viewer's Practice List and practiced days (migration 00033).
// Every endpoint is gated `read` then `practice`, the viewer's own
// permission: this is the caller's own data.
//
// A "day" is always the caller's local calendar day ('YYYY-MM-DD'), sent by
// the viewer — the server can't know which day it is for them.

// practiceListEntry is one row of GET /api/practice-list: the piece, and its
// mark for the requested day (true practiced, false unmarked, null neither).
type practiceListEntry struct {
	Piece     *api.SetlistPieceSummary `json:"piece"`
	Practiced *bool                    `json:"practiced"`
}

func validDay(day string) bool {
	_, err := time.Parse("2006-01-02", day)
	return err == nil
}

// practiceUser checks `read` then `practice`.
func (s *Server) practiceUser(w http.ResponseWriter, r *http.Request) (*models.User, bool) {
	if _, ok := s.requirePermission(w, r, models.PermissionRead); !ok {
		return nil, false
	}
	return s.requirePermission(w, r, models.PermissionPractice)
}

// writePracticeList writes the caller's list, with each piece's mark for
// day when one is given.
func (s *Server) writePracticeList(w http.ResponseWriter, r *http.Request, q repo.Queryer, userID int64, day string) {
	ids, err := repo.ListPracticeList(r.Context(), q, userID)
	if err != nil {
		s.writeError(w, err)
		return
	}
	marks := map[int64]bool{}
	if day != "" {
		if marks, err = repo.PracticedOn(r.Context(), q, userID, day, ids); err != nil {
			s.writeError(w, err)
			return
		}
	}
	entries := make([]practiceListEntry, 0, len(ids))
	for _, id := range ids {
		summary, err := api.BuildPieceSummary(r.Context(), q, id)
		if err != nil {
			s.writeError(w, err)
			return
		}
		entry := practiceListEntry{Piece: summary}
		if practiced, ok := marks[id]; ok {
			entry.Practiced = &practiced
		}
		entries = append(entries, entry)
	}
	api.WriteData(w, http.StatusOK, entries)
}

// handleGetPracticeList returns the caller's list in order; ?day= adds each
// piece's mark for that day.
func (s *Server) handleGetPracticeList(w http.ResponseWriter, r *http.Request) {
	user, ok := s.practiceUser(w, r)
	if !ok {
		return
	}
	day := r.URL.Query().Get("day")
	if day != "" && !validDay(day) {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "day must be YYYY-MM-DD")
		return
	}
	s.writePracticeList(w, r, s.DB, user.ID, day)
}

// handleAddToPracticeList appends pieces to the end of the caller's list,
// in the order given, skipping any already on it — Play's "Add to Practice
// List", and Play Set's "Add all pieces". Returns how many were added.
func (s *Server) handleAddToPracticeList(w http.ResponseWriter, r *http.Request) {
	user, ok := s.practiceUser(w, r)
	if !ok {
		return
	}
	var req struct {
		PieceIDs []int64 `json:"pieceIds"`
	}
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}
	var added int
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		for _, id := range req.PieceIDs {
			if _, err := repo.GetPieceByID(r.Context(), tx, id); err != nil {
				return err
			}
		}
		var err error
		added, err = repo.AddToPracticeList(r.Context(), tx, user.ID, req.PieceIDs)
		return err
	})
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, map[string]int{"added": added})
}

// handleRemoveFromPracticeList takes one piece off the caller's list.
func (s *Server) handleRemoveFromPracticeList(w http.ResponseWriter, r *http.Request) {
	user, ok := s.practiceUser(w, r)
	if !ok {
		return
	}
	id, ok := pathID(r, "pieceId")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid piece id")
		return
	}
	if err := repo.RemoveFromPracticeList(r.Context(), s.DB, user.ID, id); err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, map[string]bool{"removed": true})
}

// handleReorderPracticeList takes the complete new order — every piece on
// the list, once — sent whole on every drop (like the setlist order's PUT).
func (s *Server) handleReorderPracticeList(w http.ResponseWriter, r *http.Request) {
	user, ok := s.practiceUser(w, r)
	if !ok {
		return
	}
	var req struct {
		PieceIDs []int64 `json:"pieceIds"`
	}
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		return repo.ReorderPracticeList(r.Context(), tx, user.ID, req.PieceIDs)
	})
	if errors.Is(err, repo.ErrPracticeListOrder) {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, err.Error())
		return
	}
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, map[string]bool{"reordered": true})
}

// handleGetPracticed returns a piece's mark for ?day= (true, false for an
// unmark, or null) and the last day it was practiced — the viewer's
// practiced rule and Piece Details' "Last practiced".
func (s *Server) handleGetPracticed(w http.ResponseWriter, r *http.Request) {
	user, id, ok := s.practiceRequest(w, r)
	if !ok {
		return
	}
	day := r.URL.Query().Get("day")
	if day != "" && !validDay(day) {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "day must be YYYY-MM-DD")
		return
	}
	if _, err := repo.GetPieceByID(r.Context(), s.DB, id); err != nil {
		s.writeError(w, err)
		return
	}
	resp := struct {
		Practiced     *bool   `json:"practiced"`
		LastPracticed *string `json:"lastPracticed"`
	}{}
	if day != "" {
		marks, err := repo.PracticedOn(r.Context(), s.DB, user.ID, day, []int64{id})
		if err != nil {
			s.writeError(w, err)
			return
		}
		if practiced, ok := marks[id]; ok {
			resp.Practiced = &practiced
		}
	}
	last, err := repo.LastPracticed(r.Context(), s.DB, user.ID, id)
	if err != nil {
		s.writeError(w, err)
		return
	}
	resp.LastPracticed = last
	api.WriteData(w, http.StatusOK, resp)
}

// handleSetPracticed marks a piece practiced on a day, or (false) unmarks it
// for that day, which keeps the viewer from marking it again that day.
func (s *Server) handleSetPracticed(w http.ResponseWriter, r *http.Request) {
	user, id, ok := s.practiceRequest(w, r)
	if !ok {
		return
	}
	day := r.PathValue("day")
	if !validDay(day) {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "day must be YYYY-MM-DD")
		return
	}
	var req struct {
		Practiced *bool `json:"practiced"`
	}
	if err := decodeJSON(r, &req); err != nil || req.Practiced == nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "practiced (true or false) is required")
		return
	}
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		if _, err := repo.GetPieceByID(r.Context(), tx, id); err != nil {
			return err
		}
		return repo.SetPracticed(r.Context(), tx, user.ID, id, day, *req.Practiced)
	})
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, map[string]bool{"practiced": *req.Practiced})
}
