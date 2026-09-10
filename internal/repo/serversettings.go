package repo

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// ServerSettings is the id=1 singleton row backing the first-time launch
// flow and the rest of the multi-user auth-method configuration — see
// CLAUDE.md > Config's "server_settings" deviation from "no settings table
// in v1".
type ServerSettings struct {
	AuthMethod             *string
	FirstLaunchCompletedAt *time.Time
	// LastActiveAuthMethod (migration 00028) is the boot-time comparison
	// baseline for the Auth Change flow — nil until
	// first-launch completes, then kept in sync by every write path below
	// that changes what's actually running. See GetServerSettings's own
	// callers (handleGetConfig's authChangePending) for how the mismatch
	// itself is detected.
	LastActiveAuthMethod *string
}

// GetServerSettings reads the singleton row — always exists, seeded by
// migration 00024, never deleted.
func GetServerSettings(ctx context.Context, q Queryer) (*ServerSettings, error) {
	s := &ServerSettings{}
	err := q.QueryRowContext(ctx, `
		SELECT auth_method, first_launch_completed_at, last_active_auth_method FROM server_settings WHERE id = 1`,
	).Scan(&s.AuthMethod, &s.FirstLaunchCompletedAt, &s.LastActiveAuthMethod)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return s, nil
}

// CompleteFirstLaunch persists the first-time launch flow's Security step
// and marks setup done — the real backend slice that flow needs. Real
// login-wall enforcement (sessions, requirePermission) is handled
// elsewhere, not here.
// passwordHash is nil for "none"/"oidc", set for "singlepass" — passing
// nil also clears any password set by an earlier run of this flow (e.g.
// after a DB restore), rather than leaving a stale hash behind.
// authMethod is also written to last_active_auth_method — the
// caller (handleCompleteSetup) has already resolved any env-var override
// before calling this, so the value stored here is always the method the
// app is genuinely about to run under, not just whatever was submitted.
func CompleteFirstLaunch(ctx context.Context, q Queryer, authMethod string, passwordHash *string) error {
	if _, err := q.ExecContext(ctx, `
		UPDATE server_settings
		SET auth_method = ?, first_launch_completed_at = CURRENT_TIMESTAMP, last_active_auth_method = ?
		WHERE id = 1`,
		authMethod, authMethod,
	); err != nil {
		return err
	}
	_, err := q.ExecContext(ctx, `UPDATE users SET password_hash = ? WHERE id = 1`, passwordHash)
	return err
}

// UpdateAuthMethod persists an in-app auth-method change (POST
// /api/admin/security) — unlike CompleteFirstLaunch, this deliberately does
// NOT touch first_launch_completed_at (that timestamp means "when setup was
// first completed," not "when security was last changed"; a later security
// change re-stamping it would be a real, if minor, semantic drift with
// nothing else in this app depending on the distinction, but not worth
// introducing for no benefit). Also writes last_active_auth_method to the
// same value — an in-app change here is already fully
// consistent between stored and active, so it must never itself trigger
// the boot-time Auth Change flow on the next boot; that flow exists for
// externally-driven changes (the env var moving) this endpoint never
// causes.
func UpdateAuthMethod(ctx context.Context, q Queryer, authMethod string) error {
	_, err := q.ExecContext(ctx,
		`UPDATE server_settings SET auth_method = ?, last_active_auth_method = ? WHERE id = 1`,
		authMethod, authMethod,
	)
	return err
}

// SetLastActiveAuthMethod persists just the Auth Change flow's own
// completion (POST /api/auth-change/complete) — deliberately does NOT
// touch server_settings.auth_method (the stored first-launch/admin
// fallback): an env-var-driven transition should keep re-gating behind
// this same flow if the env var is
// later removed and resolution falls back to a stale stored choice, not
// silently start trusting a value nobody explicitly confirmed.
func SetLastActiveAuthMethod(ctx context.Context, q Queryer, authMethod string) error {
	_, err := q.ExecContext(ctx, `UPDATE server_settings SET last_active_auth_method = ? WHERE id = 1`, authMethod)
	return err
}

// ResolveAuthMethod is the one shared implementation of the env-var-wins
// resolution order: cfgAuthMethod (from
// AUTH_METHOD, "" if unset) wins if set, else settings.AuthMethod (the
// first-launch choice) if that's been made, else "none". Used by both
// GET /api/config and authMiddleware — CLAUDE.md's "one shared helper, not
// duplicated logic" convention (same reasoning as ResolveEffective).
func ResolveAuthMethod(cfgAuthMethod string, settings *ServerSettings) string {
	if cfgAuthMethod != "" {
		return cfgAuthMethod
	}
	if settings.AuthMethod != nil {
		return *settings.AuthMethod
	}
	return "none"
}
