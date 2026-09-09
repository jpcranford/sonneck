package handlers

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/auth"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

// issueSession mints a session token, persists it, and sets the cookie —
// shared by handleLogin (singlepass) and handleOIDCCallback (Phase 14), so
// the two login paths can't drift on cookie flags or TTL.
func (s *Server) issueSession(w http.ResponseWriter, ctx context.Context, userID int64) error {
	token, err := auth.NewSessionToken()
	if err != nil {
		return err
	}
	expiresAt := time.Now().Add(auth.SessionTTL)
	if err := repo.CreateSession(ctx, s.DB, token, userID, expiresAt); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     auth.SessionCookieName,
		Value:    token,
		Path:     "/",
		Expires:  expiresAt,
		HttpOnly: true,
		// SameSite=Lax, not Strict — Strict would break the OIDC
		// redirect-back flow; not Secure — this app is commonly reached
		// over plain HTTP on a LAN (CLAUDE.md's own clipboard-API note
		// makes the same point), so forcing Secure would silently stop the
		// browser from ever sending the cookie back.
		SameSite: http.SameSiteLaxMode,
	})
	return nil
}

// handleLogin is the singlepass password check — the only login UI that
// exists pre-OIDC (master plan's Auth methods table: `none` has no login at
// all, `oidc` redirects to the IdP instead, Phase 14). Only reachable when
// the resolved auth method is genuinely singlepass; `none`/`oidc` reject
// outright rather than silently no-op, since a client hitting this by
// mistake deserves a real error, not a confusing false "success".
func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	settings, err := repo.GetServerSettings(ctx, s.DB)
	if err != nil {
		s.writeError(w, err)
		return
	}
	if repo.ResolveAuthMethod(s.Cfg.AuthMethod, settings) != "singlepass" {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "login is not applicable for the current auth method")
		return
	}

	var req api.LoginRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}

	// singlepass mode always has exactly one implicit account (master
	// plan's Auth methods table) — id=1, same row `none` mode uses.
	user, err := repo.GetUserByID(ctx, s.DB, 1)
	if err != nil {
		s.writeError(w, err)
		return
	}
	if user.PasswordHash == nil || !auth.CheckPassword(*user.PasswordHash, req.Password) {
		api.WriteError(w, http.StatusUnauthorized, api.CodeUnauthorized, "incorrect password")
		return
	}

	if err := s.issueSession(w, ctx, user.ID); err != nil {
		s.writeError(w, err)
		return
	}

	resp, err := api.BuildAuthMeResponse(user, repo.ResolveAuthMethod(s.Cfg.AuthMethod, settings))
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, resp)
}

// handleLogout clears the session cookie's server-side row (if any) and
// tells the browser to drop the cookie. Idempotent — logging out with no
// session, or twice in a row, is not an error.
func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(auth.SessionCookieName); err == nil {
		if err := repo.DeleteSession(r.Context(), s.DB, cookie.Value); err != nil {
			s.writeError(w, err)
			return
		}
	}
	http.SetCookie(w, &http.Cookie{
		Name:     auth.SessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	api.WriteData(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleGetMe returns the current request's already-resolved user (attached
// to context by authMiddleware) — the frontend's one source of truth for
// route guards and the sidebar user menu.
func (s *Server) handleGetMe(w http.ResponseWriter, r *http.Request) {
	user, ok := userFromContext(r.Context())
	if !ok {
		// Not reachable in practice — every /api/* route runs through
		// authMiddleware first, which would have already written 401.
		api.WriteError(w, http.StatusUnauthorized, api.CodeUnauthorized, "authentication required")
		return
	}
	settings, err := repo.GetServerSettings(r.Context(), s.DB)
	if err != nil {
		s.writeError(w, err)
		return
	}
	resp, err := api.BuildAuthMeResponse(user, repo.ResolveAuthMethod(s.Cfg.AuthMethod, settings))
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, resp)
}

// handleUpdateMe is User Settings' Account card self-rename (master plan
// Phase 12) — a user can only ever rename themselves, so this needs no
// permission beyond being authenticated (models.PermissionRead is the
// lowest bar every real account already has). Unlike PATCH
// /api/admin/users/{id} (permissions only, admin-gated, any user), this
// never takes a target id — always the calling user's own row. Rejected
// outright for an OIDC account (Phase 14) — that identity's name is the
// IdP's to own and gets re-synced on every login (ClaimOrProvisionOIDCUser),
// so a local rename here would just be silently overwritten on next login;
// UserSettingsPage.tsx's own Account field is disabled for the same reason,
// this is the server-side backstop (CLAUDE.md > Frontend: "the backend
// stays sole authority").
func (s *Server) handleUpdateMe(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionRead)
	if !ok {
		return
	}
	settings, err := repo.GetServerSettings(r.Context(), s.DB)
	if err != nil {
		s.writeError(w, err)
		return
	}
	if repo.ResolveAuthMethod(s.Cfg.AuthMethod, settings) == "oidc" {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "your name is managed by your identity provider")
		return
	}

	var req api.UpdateMeRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}
	name := strings.TrimSpace(req.DisplayName)
	if name == "" {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "display name is required")
		return
	}
	if err := repo.UpdateDisplayName(r.Context(), s.DB, user.ID, name); err != nil {
		s.writeError(w, err)
		return
	}

	user.DisplayName = name
	resp, err := api.BuildAuthMeResponse(user, repo.ResolveAuthMethod(s.Cfg.AuthMethod, settings))
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, resp)
}

// handleChangePassword is User Settings' Account card "Change Password"
// action (master plan Phase 12) — self-service, singlepass only. Distinct
// from POST /api/admin/security's admin-only set-or-clear (which never asks
// for the account's own current password) and from the reset-password CLI
// (which just clears the hash for lockout recovery) — this is the normal,
// in-app "I know my password and want a new one" path.
func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, models.PermissionRead)
	if !ok {
		return
	}
	settings, err := repo.GetServerSettings(r.Context(), s.DB)
	if err != nil {
		s.writeError(w, err)
		return
	}
	if repo.ResolveAuthMethod(s.Cfg.AuthMethod, settings) != "singlepass" {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "changing your password isn't applicable for the current auth method")
		return
	}

	var req api.ChangePasswordRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}
	if user.PasswordHash == nil || !auth.CheckPassword(*user.PasswordHash, req.CurrentPassword) {
		api.WriteError(w, http.StatusUnauthorized, api.CodeUnauthorized, "current password is incorrect")
		return
	}
	if len(req.NewPassword) < minSinglepassPasswordLength {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "new password must be at least 8 characters")
		return
	}

	hash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		s.writeError(w, err)
		return
	}
	if err := repo.SetUserPasswordHash(r.Context(), s.DB, user.ID, &hash); err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, map[string]bool{"ok": true})
}
