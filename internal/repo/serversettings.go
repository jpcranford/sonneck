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
