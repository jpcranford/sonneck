package handlers

import (
	"database/sql"
	"errors"
	"io"
	"net/http"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/auth"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

// pendingAuthChange re-derives GET /api/config's own authChangePending
// computation — both of this file's handlers call it first, rejecting
// with 409 if there's genuinely nothing pending, rather than trusting the
// client to only call these when App.tsx's own gate says to. Returns the
// resolved target method alongside the settings/user list, since every
// caller needs at least one of those next.
func (s *Server) pendingAuthChange(w http.ResponseWriter, r *http.Request) (target string, ok bool) {
	settings, err := repo.GetServerSettings(r.Context(), s.DB)
	if err != nil {
		s.writeError(w, err)
		return "", false
	}
	resolved := repo.ResolveAuthMethod(s.Cfg.AuthMethod, settings)
	if settings.LastActiveAuthMethod == nil || *settings.LastActiveAuthMethod == resolved {
		api.WriteError(w, http.StatusConflict, api.CodeConflict, "no auth method change is pending")
		return "", false
	}
	return resolved, true
}

// handleAuthChangeCandidates is GET /api/auth-change/candidates — the
// destructive downgrade's account data, only meaningful when the pending
// target is none/singlepass and more than one account currently exists.
// Returns every account (not just admins — see AuthChangeCandidateResponse's
// own doc comment for why confirm-delete needs the full list), each flagged
// IsAdmin so the choose-admin step's own radio list can still filter down
// to just the eligible survivors. Deliberately public (see this file's own
// package doc note in oidc.go's sibling reasoning, and
// precious-kindling-pretzel.md's Phase 16 section) — nobody can be logged
// in yet under whichever method just became active, so this can't be
// permission-gated the normal way; it's self-guarded by pendingAuthChange
// instead.
func (s *Server) handleAuthChangeCandidates(w http.ResponseWriter, r *http.Request) {
	target, ok := s.pendingAuthChange(w, r)
	if !ok {
		return
	}
	if target == "oidc" {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "candidates only apply when downgrading away from OIDC")
		return
	}
	users, err := repo.ListUsers(r.Context(), s.DB)
	if err != nil {
		s.writeError(w, err)
		return
	}
	if len(users) <= 1 {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "only one account exists — nothing to choose between")
		return
	}
	resp := make([]api.AuthChangeCandidateResponse, 0, len(users))
	for _, u := range users {
		resp = append(resp, api.AuthChangeCandidateResponse{
			ID: u.ID, DisplayName: u.DisplayName, IsAdmin: u.HasPermission(models.PermissionAdmin),
		})
	}
	api.WriteData(w, http.StatusOK, resp)
}

// handleAuthChangeComplete is POST /api/auth-change/complete — the flow's
// one completion action, covering every transition shape
// AuthChangeFlowMockup.tsx designed: re-derives what the pending
// transition actually needs server-side (never trusts which fields the
// client bothered to send) rather than branching on the request body
// alone.
func (s *Server) handleAuthChangeComplete(w http.ResponseWriter, r *http.Request) {
	target, ok := s.pendingAuthChange(w, r)
	if !ok {
		return
	}

	// Every field is optional — several transitions (upgrading to oidc,
	// singlepass<->none with nothing left to decide) need no body at all,
	// so an empty request body is valid here, not a decode error.
	var req api.AuthChangeCompleteRequest
	if err := decodeJSON(r, &req); err != nil && !errors.Is(err, io.EOF) {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}

	users, err := repo.ListUsers(r.Context(), s.DB)
	if err != nil {
		s.writeError(w, err)
		return
	}

	err = s.withTx(r.Context(), func(tx *sql.Tx) error {
		if target != "oidc" && len(users) > 1 {
			// Multi-account downgrade — a survivor must be chosen, and it
			// must genuinely be an admin (mirrors the mockup's own rule:
			// none/singlepass mode's one account is always implicitly
			// full-admin, so only an existing admin is eligible to become
			// it).
			if req.KeepUserID == nil {
				return api.ValidationErrors{{Field: "keepUserId", Message: "required when more than one account exists"}}
			}
			var keep *models.User
			for _, u := range users {
				if u.ID == *req.KeepUserID {
					keep = u
				}
			}
			if keep == nil || !keep.HasPermission(models.PermissionAdmin) {
				return api.ValidationErrors{{Field: "keepUserId", Message: "must reference an existing admin account"}}
			}
			if err := repo.ApplyAuthChangeDowngrade(r.Context(), tx, keep.ID); err != nil {
				return err
			}
		}

		if target == "singlepass" {
			// A submitted password always wins when present — found via
			// live verification, not assumed: an earlier draft only used
			// it when the remaining account (id=1) had no password_hash
			// yet, which is right for the single-account case but wrong
			// here for a real, if narrow, sequence — singlepass, then
			// upgraded to oidc (id=1's old hash survives dormant, never
			// cleared by a claim), then downgraded back — where id=1
			// secretly already has one left over. GET /api/config's own
			// NeedsPassword is deliberately conservative for a
			// multi-account downgrade (always true, since almost every
			// real case has none), so the frontend already asks and the
			// user already typed one — silently discarding it because of
			// a leftover hash nobody but the DB remembers would be a
			// confusing, undocumented surprise. A password is only
			// skippable when genuinely not submitted at all, and only
			// then does an existing hash cover for it.
			if req.Password != nil && *req.Password != "" {
				if len(*req.Password) < minSinglepassPasswordLength {
					return api.ValidationErrors{{Field: "password", Message: "must be at least 8 characters"}}
				}
				hash, err := auth.HashPassword(*req.Password)
				if err != nil {
					return err
				}
				if err := repo.SetUserPasswordHash(r.Context(), tx, 1, &hash); err != nil {
					return err
				}
			} else {
				remaining, err := repo.GetUserByID(r.Context(), tx, 1)
				if err != nil {
					return err
				}
				if remaining.PasswordHash == nil {
					return api.ValidationErrors{{Field: "password", Message: "required, at least 8 characters"}}
				}
			}
		}

		return repo.SetLastActiveAuthMethod(r.Context(), tx, target)
	})
	if err != nil {
		s.writeError(w, err)
		return
	}

	api.WriteData(w, http.StatusOK, map[string]bool{"ok": true})
}
