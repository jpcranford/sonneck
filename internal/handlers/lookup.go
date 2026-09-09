package handlers

import (
	"database/sql"
	"net/http"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

func (s *Server) handleListKeys(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, models.PermissionRead); !ok {
		return
	}
	keys, err := repo.ListKeys(r.Context(), s.DB)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, keys)
}

func (s *Server) handleListSheetTypes(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, models.PermissionRead); !ok {
		return
	}
	types, err := repo.ListSheetTypes(r.Context(), s.DB)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, types)
}

// handleListInstruments and handleListUserTags return every existing tag
// so the frontend's combobox (design doc §10/§15) can suggest matches
// before falling back to "create new". handleListUserTags is scoped to the
// calling user's own private vocabulary (migration 00025), unlike
// Instruments, which stays a shared/global list.
func (s *Server) handleListInstruments(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, models.PermissionRead); !ok {
		return
	}
	tags, err := repo.ListInstruments(r.Context(), s.DB)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, tags)
}

func (s *Server) handleListUserTags(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionRead)
	if !ok {
		return
	}
	tags, err := repo.ListUserTags(r.Context(), s.DB, user.ID)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, tags)
}

// --- Admin Settings' Lookup Tables: create/rename/delete/merge for
// SheetType and Instrument (master plan's Backend architecture). Every
// piece/book affected by either path needs its search-index row resynced
// (CLAUDE.md > Search) — repo.PieceIDsUsing{SheetType,Instrument} collects
// the affected set BEFORE the delete/merge itself runs, while the old id is
// still the value actually stored.

func (s *Server) handleCreateSheetType(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, models.PermissionAdmin); !ok {
		return
	}
	var req api.LookupCreateRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}
	if err := api.ValidateTagName(req.Name); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, err.Error())
		return
	}
	id, err := repo.CreateSheetType(r.Context(), s.DB, req.Name)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusCreated, repo.Tag{ID: id, Name: req.Name})
}

func (s *Server) handleRenameSheetType(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, models.PermissionAdmin); !ok {
		return
	}
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid sheet type id")
		return
	}
	var req api.LookupRenameRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}
	if err := api.ValidateTagName(req.Name); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, err.Error())
		return
	}
	if err := repo.RenameSheetType(r.Context(), s.DB, id, req.Name); err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, repo.Tag{ID: id, Name: req.Name})
}

func (s *Server) handleDeleteSheetType(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, models.PermissionAdmin); !ok {
		return
	}
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid sheet type id")
		return
	}
	var req api.LookupDeleteRequest
	if r.ContentLength != 0 {
		if err := decodeJSON(r, &req); err != nil {
			api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
			return
		}
	}
	if req.MergeIntoID != nil && *req.MergeIntoID == id {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "mergeIntoId must not equal the sheet type being deleted")
		return
	}

	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		affected, err := repo.PieceIDsUsingSheetType(r.Context(), tx, id)
		if err != nil {
			return err
		}
		if err := repo.DeleteSheetType(r.Context(), tx, id, req.MergeIntoID); err != nil {
			return err
		}
		for _, pieceID := range affected {
			if err := repo.ResyncSearchIndex(r.Context(), tx, pieceID); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, map[string]bool{"deleted": true})
}

func (s *Server) handleCreateInstrument(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, models.PermissionAdmin); !ok {
		return
	}
	var req api.LookupCreateRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}
	if err := api.ValidateTagName(req.Name); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, err.Error())
		return
	}
	id, err := repo.CreateInstrument(r.Context(), s.DB, req.Name)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusCreated, repo.Tag{ID: id, Name: req.Name})
}

func (s *Server) handleRenameInstrument(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, models.PermissionAdmin); !ok {
		return
	}
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid instrument id")
		return
	}
	var req api.LookupRenameRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}
	if err := api.ValidateTagName(req.Name); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, err.Error())
		return
	}
	if err := repo.RenameInstrument(r.Context(), s.DB, id, req.Name); err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, repo.Tag{ID: id, Name: req.Name})
}

func (s *Server) handleDeleteInstrument(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, models.PermissionAdmin); !ok {
		return
	}
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid instrument id")
		return
	}
	var req api.LookupDeleteRequest
	if r.ContentLength != 0 {
		if err := decodeJSON(r, &req); err != nil {
			api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
			return
		}
	}
	if req.MergeIntoID != nil && *req.MergeIntoID == id {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "mergeIntoId must not equal the instrument being deleted")
		return
	}

	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		affected, err := repo.PieceIDsUsingInstrument(r.Context(), tx, id)
		if err != nil {
			return err
		}
		if err := repo.DeleteInstrument(r.Context(), tx, id, req.MergeIntoID); err != nil {
			return err
		}
		for _, pieceID := range affected {
			if err := repo.ResyncSearchIndex(r.Context(), tx, pieceID); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, map[string]bool{"deleted": true})
}

// handleListPracticeStatuses returns the calling user's own practice
// statuses — the User Settings Practice Status card's list, and (once a
// real Piece Details/Edit Piece picker exists) the source of valid values
// for the practiceStatus field.
func (s *Server) handleListPracticeStatuses(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionRead)
	if !ok {
		return
	}
	statuses, err := repo.ListPracticeStatuses(r.Context(), s.DB, user.ID)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, statuses)
}

// --- Your Tags / Practice Status create/delete/merge (master plan's
// Backend architecture) — user-scoped (read permission only, not
// admin-gated: this is the calling user's own private data), split across
// user_tags and practice_statuses.

func (s *Server) handleCreateUserTag(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionRead)
	if !ok {
		return
	}
	var req api.LookupCreateRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}
	if err := api.ValidateTagName(req.Name); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, err.Error())
		return
	}
	id, err := repo.CreateUserTag(r.Context(), s.DB, user.ID, req.Name)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusCreated, repo.Tag{ID: id, Name: req.Name})
}

// handleRenameUserTag is User Settings' Your Tags card inline rename
// (master plan Phase 12) — unlike the admin lookup tables' rename above,
// user tags are indexed in pieces_fts (CLAUDE.md > Search's corrected note:
// "user tags genuinely are indexed"), so every piece carrying this tag
// needs its search-index row resynced with the new name, same as a
// merge/delete.
func (s *Server) handleRenameUserTag(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionRead)
	if !ok {
		return
	}
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid tag id")
		return
	}
	var req api.LookupRenameRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}
	if err := api.ValidateTagName(req.Name); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, err.Error())
		return
	}

	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		affected, err := repo.PieceIDsWithUserTag(r.Context(), tx, id)
		if err != nil {
			return err
		}
		if err := repo.RenameUserTag(r.Context(), tx, user.ID, id, req.Name); err != nil {
			return err
		}
		for _, pieceID := range affected {
			if err := repo.ResyncSearchIndex(r.Context(), tx, pieceID); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, repo.Tag{ID: id, Name: req.Name})
}

func (s *Server) handleDeleteUserTag(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionRead)
	if !ok {
		return
	}
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid tag id")
		return
	}
	var req api.LookupDeleteRequest
	if r.ContentLength != 0 {
		if err := decodeJSON(r, &req); err != nil {
			api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
			return
		}
	}
	if req.MergeIntoID != nil && *req.MergeIntoID == id {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "mergeIntoId must not equal the tag being deleted")
		return
	}

	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		// Ownership is checked here, not trusted from the client — the same
		// scoping favorite/userNotes already get by resolved user.
		owned, err := repo.UserTagsByIDsForUser(r.Context(), tx, user.ID, []int64{id})
		if err != nil {
			return err
		}
		if len(owned) == 0 {
			return repo.ErrNotFound
		}
		if req.MergeIntoID != nil {
			ownedTarget, err := repo.UserTagsByIDsForUser(r.Context(), tx, user.ID, []int64{*req.MergeIntoID})
			if err != nil {
				return err
			}
			if len(ownedTarget) == 0 {
				return api.ValidationErrors{{Field: "mergeIntoId", Message: "not found in your own tags"}}
			}
		}
		affected, err := repo.PieceIDsWithUserTag(r.Context(), tx, id)
		if err != nil {
			return err
		}
		if err := repo.DeleteUserTag(r.Context(), tx, id, req.MergeIntoID); err != nil {
			return err
		}
		for _, pieceID := range affected {
			if err := repo.ResyncSearchIndex(r.Context(), tx, pieceID); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, map[string]bool{"deleted": true})
}

func (s *Server) handleCreatePracticeStatus(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionRead)
	if !ok {
		return
	}
	var req api.LookupCreateRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}
	if err := api.ValidateTagName(req.Name); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, err.Error())
		return
	}
	id, err := repo.CreatePracticeStatus(r.Context(), s.DB, user.ID, req.Name)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusCreated, repo.PracticeStatus{ID: id, Name: req.Name})
}

// handleRenamePracticeStatus is User Settings' Practice Status card inline
// rename (master plan Phase 12). No search-index resync needed — practice
// status isn't indexed in pieces_fts, unlike a user tag rename above.
func (s *Server) handleRenamePracticeStatus(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionRead)
	if !ok {
		return
	}
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid practice status id")
		return
	}
	var req api.LookupRenameRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}
	if err := api.ValidateTagName(req.Name); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, err.Error())
		return
	}
	if err := repo.RenamePracticeStatus(r.Context(), s.DB, user.ID, id, req.Name); err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, repo.PracticeStatus{ID: id, Name: req.Name})
}

func (s *Server) handleDeletePracticeStatus(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionRead)
	if !ok {
		return
	}
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid practice status id")
		return
	}
	var req api.LookupDeleteRequest
	if r.ContentLength != 0 {
		if err := decodeJSON(r, &req); err != nil {
			api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
			return
		}
	}
	if req.MergeIntoID != nil && *req.MergeIntoID == id {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "mergeIntoId must not equal the status being deleted")
		return
	}

	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		owned, err := repo.ListPracticeStatuses(r.Context(), tx, user.ID)
		if err != nil {
			return err
		}
		if !containsStatusID(owned, id) {
			return repo.ErrNotFound
		}
		if req.MergeIntoID != nil && !containsStatusID(owned, *req.MergeIntoID) {
			return api.ValidationErrors{{Field: "mergeIntoId", Message: "not found in your own practice statuses"}}
		}
		return repo.DeletePracticeStatus(r.Context(), tx, id, req.MergeIntoID)
	})
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, map[string]bool{"deleted": true})
}

func containsStatusID(statuses []repo.PracticeStatus, id int64) bool {
	for _, s := range statuses {
		if s.ID == id {
			return true
		}
	}
	return false
}
