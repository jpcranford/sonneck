package handlers

import (
	"database/sql"
	"net/http"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/auth"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

func buildAdminUserResponse(u *models.User, isLastAdmin bool) api.AdminUserResponse {
	perms := u.Permissions
	if perms == nil {
		perms = []string{}
	}
	return api.AdminUserResponse{ID: u.ID, DisplayName: u.DisplayName, Permissions: perms, IsLastAdmin: isLastAdmin}
}

// handleListAdminUsers is Admin Settings' Users screen — in none/singlepass
// mode always exactly the one seeded account; OIDC is the only
// mode that ever adds more.
func (s *Server) handleListAdminUsers(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, models.PermissionAdmin); !ok {
		return
	}
	users, err := repo.ListUsers(r.Context(), s.DB)
	if err != nil {
		s.writeError(w, err)
		return
	}
	adminCount, err := repo.CountAdmins(r.Context(), s.DB)
	if err != nil {
		s.writeError(w, err)
		return
	}

	resp := make([]api.AdminUserResponse, 0, len(users))
	for _, u := range users {
		isLastAdmin := adminCount == 1 && u.HasPermission(models.PermissionAdmin)
		resp = append(resp, buildAdminUserResponse(u, isLastAdmin))
	}
	api.WriteData(w, http.StatusOK, resp)
}

// handleSetUserPermissions is the Users screen's expandable permission grid
// — full-replace, per SetUserPermissionsRequest's own doc comment. Rejects
// a write that would leave the install with no admin at all (the same rule
// the Users screen's own per-row lock enforces client-side, re-checked here
// since the client's disabled state is never trusted server-side).
func (s *Server) handleSetUserPermissions(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, models.PermissionAdmin); !ok {
		return
	}
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid user id")
		return
	}

	var req api.SetUserPermissionsRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}
	for _, p := range req.Permissions {
		if !isValidPermission(p) {
			api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "unknown permission: "+p)
			return
		}
	}

	var resp api.AdminUserResponse
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		target, err := repo.GetUserByID(r.Context(), tx, id)
		if err != nil {
			return err
		}
		willBeAdmin := false
		for _, p := range req.Permissions {
			if p == models.PermissionAdmin {
				willBeAdmin = true
			}
		}
		if target.HasPermission(models.PermissionAdmin) && !willBeAdmin {
			adminCount, err := repo.CountAdmins(r.Context(), tx)
			if err != nil {
				return err
			}
			if adminCount <= 1 {
				return api.ValidationErrors{{Field: "permissions", Message: "can't remove admin from the last remaining admin"}}
			}
		}

		if err := repo.SetUserPermissions(r.Context(), tx, id, req.Permissions); err != nil {
			return err
		}
		target.Permissions = req.Permissions
		adminCount, err := repo.CountAdmins(r.Context(), tx)
		if err != nil {
			return err
		}
		resp = buildAdminUserResponse(target, adminCount == 1 && willBeAdmin)
		return nil
	})
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, resp)
}

// handleDeleteAdminUser removes only this app's own users row — cascades
// via ON DELETE CASCADE, can't touch anything at the identity provider
// itself. Guarded the same way
// handleSetUserPermissions is: never leaves the install with no admin.
func (s *Server) handleDeleteAdminUser(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, models.PermissionAdmin); !ok {
		return
	}
	id, ok := pathID(r, "id")
	if !ok {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid user id")
		return
	}

	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		target, err := repo.GetUserByID(r.Context(), tx, id)
		if err != nil {
			return err
		}
		if target.HasPermission(models.PermissionAdmin) {
			adminCount, err := repo.CountAdmins(r.Context(), tx)
			if err != nil {
				return err
			}
			if adminCount <= 1 {
				return api.ValidationErrors{{Field: "id", Message: "can't delete the last remaining admin"}}
			}
		}
		return repo.DeleteUser(r.Context(), tx, id)
	})
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, map[string]any{"deleted": true, "id": id})
}

func isValidPermission(p string) bool {
	for _, valid := range models.AllPermissions {
		if p == valid {
			return true
		}
	}
	return false
}

// handleAdminSecurity is POST /api/admin/security: reachable only while
// the *current* resolved auth method is none/singlepass (never oidc —
// that stays permanently env-var-only, unreachable from any UI) and
// AUTH_METHOD isn't itself env-set. Switching between none/singlepass
// never risks losing an account, since both modes are always exactly the
// one implicit account — none of the destructive multi-account downgrade
// machinery the Auth Change flow handles applies to this path.
func (s *Server) handleAdminSecurity(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, models.PermissionAdmin); !ok {
		return
	}

	settings, err := repo.GetServerSettings(r.Context(), s.DB)
	if err != nil {
		s.writeError(w, err)
		return
	}
	if s.Cfg.AuthMethod != "" {
		api.WriteError(w, http.StatusConflict, api.CodeConflict, "AUTH_METHOD is set by environment variable")
		return
	}
	current := repo.ResolveAuthMethod(s.Cfg.AuthMethod, settings)
	if current == "oidc" {
		api.WriteError(w, http.StatusConflict, api.CodeConflict, "OIDC can only be changed via the AUTH_METHOD environment variable")
		return
	}

	var req api.AdminSecurityRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}

	var passwordHash *string
	switch req.AuthMethod {
	case "none":
		// passwordHash stays nil — clears any existing password.
	case "singlepass":
		user, err := repo.GetUserByID(r.Context(), s.DB, 1)
		if err != nil {
			s.writeError(w, err)
			return
		}
		switch {
		case req.Password != nil && *req.Password != "":
			if len(*req.Password) < minSinglepassPasswordLength {
				api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "password must be at least 8 characters")
				return
			}
			hash, err := auth.HashPassword(*req.Password)
			if err != nil {
				s.writeError(w, err)
				return
			}
			passwordHash = &hash
		case user.PasswordHash != nil:
			// Blank means "keep the current password" — only valid when one
			// already exists.
			passwordHash = user.PasswordHash
		default:
			api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "password is required")
			return
		}
	default:
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, `authMethod must be "none" or "singlepass"`)
		return
	}

	err = s.withTx(r.Context(), func(tx *sql.Tx) error {
		if err := repo.SetUserPasswordHash(r.Context(), tx, 1, passwordHash); err != nil {
			return err
		}
		return repo.UpdateAuthMethod(r.Context(), tx, req.AuthMethod)
	})
	if err != nil {
		s.writeError(w, err)
		return
	}

	api.WriteData(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleLibraryCounts backs Admin Settings' "Library" stat cards.
func (s *Server) handleLibraryCounts(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, models.PermissionAdmin); !ok {
		return
	}
	pieces, err := repo.CountAllPieces(r.Context(), s.DB)
	if err != nil {
		s.writeError(w, err)
		return
	}
	books, err := repo.CountAllBooks(r.Context(), s.DB)
	if err != nil {
		s.writeError(w, err)
		return
	}
	people, err := repo.CountAllPeople(r.Context(), s.DB)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, api.LibraryCountsResponse{Pieces: pieces, Books: books, People: people})
}
