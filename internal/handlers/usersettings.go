package handlers

import (
	"net/http"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

// handleGetUserSettings/handleUpdateUserSettings back User Settings'
// Appearance/Library cards — the three admin-screen-visible structured
// preferences (show/hide Books in sidebar, theme, pagination mode) that
// migration 00025's user_settings table and
// repo.GetUserSettings/UpdateUserSettings have carried, with no HTTP
// surface until now. Read/write is `read`-permission only, not
// admin-gated — this is the calling user's own data, same scoping as
// Tags/Practice Status above.
//
// Decoding straight into repo.UserSettings (rather than a separate
// api.UpdateUserSettingsRequest DTO) — its JSON tags already match the wire
// shape this endpoint needs exactly, and unlike PieceWriteRequest's many
// optional fields, there's no partial-update case to represent here: the
// frontend always PATCHes the complete three-field object (read current
// values, flip one, send all three back), matching
// UpdateUserSettings' own full-replace convention.

func (s *Server) handleGetUserSettings(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionRead)
	if !ok {
		return
	}
	settings, err := repo.GetUserSettings(r.Context(), s.DB, user.ID)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, settings)
}

func (s *Server) handleUpdateUserSettings(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionRead)
	if !ok {
		return
	}
	var req repo.UserSettings
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}
	// Checked explicitly rather than left to user_settings' own CHECK
	// constraint — a raw constraint violation would surface as an opaque
	// 500 (writeError has no special case for it, unlike ErrDuplicateName),
	// not a clean 400.
	switch req.ThemePreference {
	case "light", "dark", "system":
	default:
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "themePreference must be one of light, dark, system")
		return
	}
	switch req.ContentViewMode {
	case "paginated", "infinite":
	default:
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "contentViewMode must be one of paginated, infinite")
		return
	}

	if err := repo.UpdateUserSettings(r.Context(), s.DB, user.ID, req); err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, req)
}
