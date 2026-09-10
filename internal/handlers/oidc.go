package handlers

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"time"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/oidcauth"
	"github.com/jpcranford/sonneck/internal/repo"
)

// OIDCAuthenticator is the minimal surface Server needs from
// *oidcauth.Authenticator — defined here (point of use, not in oidcauth
// itself) so tests can inject a fake that never does real network I/O
// instead of standing up a full JWT-signing fake IdP just to exercise the
// login/callback handlers below.
type OIDCAuthenticator interface {
	AuthCodeURL(state string) string
	Exchange(ctx context.Context, code string) (oidcauth.Claims, error)
}

// oidcStateCookieName is short-lived (5 minutes — long enough for a real
// login, never meant to persist) and scoped to /api/auth/oidc, narrower
// than the session cookie's own "/" — nothing outside the login/callback
// pair ever needs to read it.
const oidcStateCookieName = "sonneck_oidc_state"

// handleOIDCLogin redirects to the IdP's own authorization endpoint. Only
// meaningful when the server is actually configured for OIDC; s.OIDCAuth is
// nil otherwise (mirrors
// s.BackupScheduler's own "nil when not applicable" convention), which a
// client could only reach by hitting this URL directly in a non-oidc
// deployment.
func (s *Server) handleOIDCLogin(w http.ResponseWriter, r *http.Request) {
	if s.OIDCAuth == nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "OIDC is not configured on this server")
		return
	}
	state, err := oidcauth.NewState()
	if err != nil {
		s.writeError(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     oidcStateCookieName,
		Value:    state,
		Path:     "/api/auth/oidc",
		MaxAge:   int((5 * time.Minute).Seconds()),
		HttpOnly: true,
		Secure:   isSecureRequest(r, s.Cfg.TrustProxyHTTPS),
		SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, s.OIDCAuth.AuthCodeURL(state), http.StatusFound)
}

// handleOIDCCallback completes the exchange and resolves/creates the
// account (repo.ClaimOrProvisionOIDCUser — see that function's own comment
// for the first-login-claims-id=1 / auto-provision logic). Every failure
// path redirects back to "/" with a small fixed ?oidcError= code rather
// than rendering a server-side error page or leaking raw error text into a
// URL — LoginScreen.tsx (still what renders, since no session was ever
// issued on a failure) maps the code to a friendly line.
func (s *Server) handleOIDCCallback(w http.ResponseWriter, r *http.Request) {
	if s.OIDCAuth == nil {
		http.Redirect(w, r, "/?oidcError=unconfigured", http.StatusFound)
		return
	}

	// Clear the state cookie either way — it's single-use regardless of
	// outcome.
	http.SetCookie(w, &http.Cookie{
		Name: oidcStateCookieName, Value: "", Path: "/api/auth/oidc", MaxAge: -1, HttpOnly: true,
		Secure: isSecureRequest(r, s.Cfg.TrustProxyHTTPS),
	})

	cookie, err := r.Cookie(oidcStateCookieName)
	if err != nil || r.URL.Query().Get("state") != cookie.Value {
		http.Redirect(w, r, "/?oidcError=state", http.StatusFound)
		return
	}

	claims, err := s.OIDCAuth.Exchange(r.Context(), r.URL.Query().Get("code"))
	if err != nil {
		s.Logger.Warn("oidc exchange failed", "error", err)
		http.Redirect(w, r, "/?oidcError=exchange", http.StatusFound)
		return
	}

	var picture *string
	if claims.Picture != "" {
		picture = &claims.Picture
	}

	var user *models.User
	err = s.withTx(r.Context(), func(tx *sql.Tx) error {
		u, err := repo.ClaimOrProvisionOIDCUser(
			r.Context(), tx, claims.Subject, claims.Name, picture,
			s.Cfg.OIDCDefaultPermissions, s.Cfg.OIDCAllowRegistration,
		)
		if err != nil {
			return err
		}
		user = u
		return nil
	})
	if errors.Is(err, repo.ErrOIDCRegistrationDisabled) {
		http.Redirect(w, r, "/?oidcError=registration_disabled", http.StatusFound)
		return
	}
	if err != nil {
		s.Logger.Error("oidc account resolution failed", "error", err)
		http.Redirect(w, r, "/?oidcError=internal", http.StatusFound)
		return
	}

	if err := s.issueSession(w, r, user.ID); err != nil {
		s.Logger.Error("oidc session issuance failed", "error", err)
		http.Redirect(w, r, "/?oidcError=internal", http.StatusFound)
		return
	}
	http.Redirect(w, r, "/", http.StatusFound)
}
