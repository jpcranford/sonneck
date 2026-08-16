package handlers

import (
	"net/http"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/repo"
)

func (s *Server) handleListKeys(w http.ResponseWriter, r *http.Request) {
	keys, err := repo.ListKeys(r.Context(), s.DB)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, keys)
}

func (s *Server) handleListSheetTypes(w http.ResponseWriter, r *http.Request) {
	types, err := repo.ListSheetTypes(r.Context(), s.DB)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, types)
}

// handleListInstruments and handleListUserTags return every existing tag
// so the frontend's combobox (design doc §10/§15) can suggest matches
// before falling back to "create new".
func (s *Server) handleListInstruments(w http.ResponseWriter, r *http.Request) {
	tags, err := repo.ListInstruments(r.Context(), s.DB)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, tags)
}

func (s *Server) handleListUserTags(w http.ResponseWriter, r *http.Request) {
	tags, err := repo.ListUserTags(r.Context(), s.DB)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, tags)
}
