package repo

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// ServerSettings is the id=1 singleton row backing the first-time launch
// flow, and eventually the rest of the multi-user auth-method
// configuration — see CLAUDE.md > Config's "server_settings" deviation
// from "no settings table in v1" once that section is updated (memory
// project_multiuser_build.md).
type ServerSettings struct {
	AuthMethod             *string
	FirstLaunchCompletedAt *time.Time
}

// GetServerSettings reads the singleton row — always exists, seeded by
// migration 00024, never deleted.
func GetServerSettings(ctx context.Context, q Queryer) (*ServerSettings, error) {
	s := &ServerSettings{}
	err := q.QueryRowContext(ctx, `
		SELECT auth_method, first_launch_completed_at FROM server_settings WHERE id = 1`,
	).Scan(&s.AuthMethod, &s.FirstLaunchCompletedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return s, nil
}

// CompleteFirstLaunch persists the first-time launch flow's Security step
// and marks setup done — the real backend slice that flow needs (Phase 3
// of memory project_multiuser_build.md). Real login-wall enforcement
// (sessions, requirePermission) is a later phase, not this one.
// passwordHash is nil for "none"/"oidc", set for "singlepass" — passing
// nil also clears any password set by an earlier run of this flow (e.g.
// after a DB restore), rather than leaving a stale hash behind.
func CompleteFirstLaunch(ctx context.Context, q Queryer, authMethod string, passwordHash *string) error {
	if _, err := q.ExecContext(ctx, `
		UPDATE server_settings SET auth_method = ?, first_launch_completed_at = CURRENT_TIMESTAMP WHERE id = 1`,
		authMethod,
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
// introducing for no benefit).
func UpdateAuthMethod(ctx context.Context, q Queryer, authMethod string) error {
	_, err := q.ExecContext(ctx, `UPDATE server_settings SET auth_method = ? WHERE id = 1`, authMethod)
	return err
}

// ResolveAuthMethod is the one shared implementation of the env-var-wins
// resolution order (master plan's Auth methods table): cfgAuthMethod (from
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
