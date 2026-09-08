package handlers

import (
	"net/http"
	"time"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/auth"
	"github.com/jpcranford/sonneck/internal/repo"
)

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

	token, err := auth.NewSessionToken()
	if err != nil {
		s.writeError(w, err)
		return
	}
	expiresAt := time.Now().Add(auth.SessionTTL)
	if err := repo.CreateSession(ctx, s.DB, token, user.ID, expiresAt); err != nil {
		s.writeError(w, err)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     auth.SessionCookieName,
		Value:    token,
		Path:     "/",
		Expires:  expiresAt,
		HttpOnly: true,
		// SameSite=Lax, not Strict — Strict would break the OIDC
		// redirect-back flow (Phase 14); not Secure — this app is commonly
		// reached over plain HTTP on a LAN (CLAUDE.md's own clipboard-API
		// note makes the same point), so forcing Secure would silently stop
		// the browser from ever sending the cookie back.
		SameSite: http.SameSiteLaxMode,
	})

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
