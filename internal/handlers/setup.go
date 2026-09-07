package handlers

import (
	"net/http"

	"golang.org/x/crypto/bcrypt"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/repo"
)

// minSinglepassPasswordLength matches the first-time launch flow's own
// mockup/frontend validation (FirstLaunchMockup.tsx) — kept in sync
// deliberately, not shared code, since one is Go and one is TypeScript.
const minSinglepassPasswordLength = 8

// handleCompleteSetup persists the first-time launch flow's Security step
// (memory project_multiuser_build.md, Phase 3) — auth_method plus a hashed
// password for singlepass. This is the one real backend slice that flow
// needs; actual login-wall enforcement (sessions, requirePermission on
// every other endpoint) is a later "Backend changes" phase, not this one.
//
// Only runs once per install: rejects if first-launch has already
// completed, so this can't double as an open, unauthenticated way to reset
// the password or auth method later — there's no real auth yet to gate it
// otherwise (that lands in the later phase above), so this guard is the
// only thing standing between "first-run setup" and "anyone on the network
// can silently change security settings at any time."
//
// When AUTH_METHOD is set via env var, it's authoritative over the
// request's own AuthMethod — this endpoint's job in that case narrows to
// collecting a singlepass password (a real secret with no env var
// equivalent) and marking setup done, not letting the request override
// which method is actually active. The frontend's own picker already
// reflects this (a locked state, not the full 3-card choice) — this is the
// server-side half of the same rule, not trust in the disabled UI alone.
func (s *Server) handleCompleteSetup(w http.ResponseWriter, r *http.Request) {
	settings, err := repo.GetServerSettings(r.Context(), s.DB)
	if err != nil {
		s.writeError(w, err)
		return
	}
	if settings.FirstLaunchCompletedAt != nil {
		api.WriteError(w, http.StatusConflict, api.CodeConflict, "setup has already been completed")
		return
	}

	var req api.SetupCompleteRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}

	authMethod := req.AuthMethod
	if s.Cfg.AuthMethod != "" {
		authMethod = s.Cfg.AuthMethod
	}

	var passwordHash *string
	switch authMethod {
	case "none", "oidc":
		// passwordHash stays nil — "oidc" only reaches here via the env-var
		// override above (the picker UI this endpoint serves never offers
		// it as a selectable option — memory project_multiuser_build.md:
		// OIDC is env-var-only, never settable through this flow).
	case "singlepass":
		if req.Password == nil || len(*req.Password) < minSinglepassPasswordLength {
			api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "password must be at least 8 characters")
			return
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(*req.Password), bcrypt.DefaultCost)
		if err != nil {
			s.writeError(w, err)
			return
		}
		hashStr := string(hash)
		passwordHash = &hashStr
	default:
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, `authMethod must be "none" or "singlepass"`)
		return
	}

	if err := repo.CompleteFirstLaunch(r.Context(), s.DB, authMethod, passwordHash); err != nil {
		s.writeError(w, err)
		return
	}

	api.WriteData(w, http.StatusOK, map[string]bool{"ok": true})
}
