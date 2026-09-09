package repo

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"time"

	"github.com/jpcranford/sonneck/internal/models"
)

// GetUserByID loads a user row and its permission set. Used by
// authMiddleware (resolving the request's user) and the admin Users screen.
func GetUserByID(ctx context.Context, q Queryer, id int64) (*models.User, error) {
	u := &models.User{}
	err := q.QueryRowContext(ctx, `
		SELECT id, display_name, password_hash, oidc_subject, avatar_url, created_at FROM users WHERE id = ?`, id,
	).Scan(&u.ID, &u.DisplayName, &u.PasswordHash, &u.OIDCSubject, &u.AvatarURL, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	perms, err := getUserPermissions(ctx, q, id)
	if err != nil {
		return nil, err
	}
	u.Permissions = perms
	return u, nil
}

// getUserByOIDCSubject loads a user row by its IdP subject, or ErrNotFound
// if no such row is linked yet — the OIDC callback's first lookup.
func getUserByOIDCSubject(ctx context.Context, q Queryer, subject string) (*models.User, error) {
	u := &models.User{}
	err := q.QueryRowContext(ctx, `
		SELECT id, display_name, password_hash, oidc_subject, avatar_url, created_at
		FROM users WHERE oidc_subject = ?`, subject,
	).Scan(&u.ID, &u.DisplayName, &u.PasswordHash, &u.OIDCSubject, &u.AvatarURL, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	perms, err := getUserPermissions(ctx, q, u.ID)
	if err != nil {
		return nil, err
	}
	u.Permissions = perms
	return u, nil
}

// ListUsers returns every account, each with its permission set loaded —
// the Admin Settings Users screen's one source of truth. In none/singlepass
// mode this is always exactly the one seeded row; OIDC (Phase 14) is the
// only mode that ever adds more.
func ListUsers(ctx context.Context, q Queryer) ([]*models.User, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT id, display_name, password_hash, oidc_subject, avatar_url, created_at FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []*models.User
	for rows.Next() {
		u := &models.User{}
		if err := rows.Scan(&u.ID, &u.DisplayName, &u.PasswordHash, &u.OIDCSubject, &u.AvatarURL, &u.CreatedAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for _, u := range users {
		perms, err := getUserPermissions(ctx, q, u.ID)
		if err != nil {
			return nil, err
		}
		u.Permissions = perms
	}
	return users, nil
}

func getUserPermissions(ctx context.Context, q Queryer, userID int64) ([]string, error) {
	rows, err := q.QueryContext(ctx, `SELECT permission FROM user_permissions WHERE user_id = ? ORDER BY permission`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	perms := []string{}
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		perms = append(perms, p)
	}
	return perms, rows.Err()
}

// SetUserPermissions replaces user_id's full permission set — same
// full-replace convention every other join-table setter in this app uses
// (SetPieceKeys, SetPieceInstruments, ...), not an incremental add/remove.
func SetUserPermissions(ctx context.Context, q Queryer, userID int64, perms []string) error {
	if _, err := q.ExecContext(ctx, `DELETE FROM user_permissions WHERE user_id = ?`, userID); err != nil {
		return err
	}
	for _, p := range perms {
		if _, err := q.ExecContext(ctx,
			`INSERT INTO user_permissions (user_id, permission) VALUES (?, ?)`, userID, p,
		); err != nil {
			return err
		}
	}
	return nil
}

// CountAdmins reports how many users currently hold the admin permission —
// the guard every "remove the last admin" check (permission edit, user
// delete) is built on.
func CountAdmins(ctx context.Context, q Queryer) (int, error) {
	var count int
	err := q.QueryRowContext(ctx,
		`SELECT COUNT(DISTINCT user_id) FROM user_permissions WHERE permission = 'admin'`,
	).Scan(&count)
	return count, err
}

// SetUserPasswordHash sets (or clears, passing nil) a user's password_hash
// — used by POST /api/admin/security and the reset-password CLI subcommand.
func SetUserPasswordHash(ctx context.Context, q Queryer, userID int64, hash *string) error {
	_, err := q.ExecContext(ctx, `UPDATE users SET password_hash = ? WHERE id = ?`, hash, userID)
	return err
}

// UpdateDisplayName renames userID's own account — User Settings' Account
// card (master plan Phase 12), PATCH /api/auth/me. No uniqueness constraint
// on display_name (unlike a tag/lookup name) — two accounts sharing a
// display name is a cosmetic collision, not a data-integrity concern.
func UpdateDisplayName(ctx context.Context, q Queryer, userID int64, displayName string) error {
	_, err := q.ExecContext(ctx, `UPDATE users SET display_name = ? WHERE id = ?`, displayName, userID)
	return err
}

// ErrOIDCRegistrationDisabled is returned by ClaimOrProvisionOIDCUser when a
// login's subject matches no existing row, id=1 is already claimed by
// someone else, and OIDC_ALLOW_REGISTRATION is false — the operator wants
// accounts pre-provisioned (link-oidc-account CLI) rather than
// auto-created.
var ErrOIDCRegistrationDisabled = errors.New("oidc registration disabled")

// ClaimOrProvisionOIDCUser is the OIDC callback's one piece of account
// resolution logic (master plan Phase 14), run inside the caller's own
// transaction (q is expected to be a *sql.Tx):
//
//  1. subject already linked to a row → log them in. avatarURL and
//     displayName are both re-synced from this login's fresh claims (an
//     OIDC identity's name/picture are the IdP's to own, not locally
//     editable — UserSettingsPage.tsx's Account field is disabled
//     accordingly), not just set once at creation.
//  2. No such row, and id=1 (the seeded local admin) has never been
//     claimed by any OIDC login yet → claim it. This condition *is* "the
//     very first OIDC login" (master plan's Auth methods table) — no
//     separate counter needed. Existing permissions/favorites/tags/notes
//     on that row are untouched.
//  3. No such row, id=1 already claimed by someone else → auto-provision a
//     new row (display_name/avatar_url/oidc_subject from the claim,
//     user_permissions from defaultPermissions, practice_statuses/
//     user_settings seeded via SeedNewUserData) if allowRegistration,
//     else ErrOIDCRegistrationDisabled.
func ClaimOrProvisionOIDCUser(
	ctx context.Context, q Queryer,
	subject, displayName string, avatarURL *string,
	defaultPermissions []string, allowRegistration bool,
) (*models.User, error) {
	if existing, err := getUserByOIDCSubject(ctx, q, subject); err == nil {
		if _, err := q.ExecContext(ctx,
			`UPDATE users SET display_name = ?, avatar_url = ? WHERE id = ?`,
			displayName, avatarURL, existing.ID,
		); err != nil {
			return nil, err
		}
		existing.DisplayName = displayName
		existing.AvatarURL = avatarURL
		return existing, nil
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	claimResult, err := q.ExecContext(ctx,
		`UPDATE users SET oidc_subject = ?, display_name = ?, avatar_url = ? WHERE id = 1 AND oidc_subject IS NULL`,
		subject, displayName, avatarURL,
	)
	if err != nil {
		return nil, err
	}
	if claimed, err := claimResult.RowsAffected(); err != nil {
		return nil, err
	} else if claimed == 1 {
		return GetUserByID(ctx, q, 1)
	}

	if !allowRegistration {
		return nil, ErrOIDCRegistrationDisabled
	}

	insertResult, err := q.ExecContext(ctx,
		`INSERT INTO users (display_name, oidc_subject, avatar_url) VALUES (?, ?, ?)`,
		displayName, subject, avatarURL,
	)
	if err != nil {
		return nil, err
	}
	newID, err := insertResult.LastInsertId()
	if err != nil {
		return nil, err
	}
	if err := SetUserPermissions(ctx, q, newID, defaultPermissions); err != nil {
		return nil, err
	}
	if err := SeedNewUserData(ctx, q, newID); err != nil {
		return nil, err
	}
	return GetUserByID(ctx, q, newID)
}

// FindUserByIDOrDisplayName resolves the link-oidc-account CLI subcommand's
// target argument — a numeric string is tried as an id first (matching
// GetUserByID's own not-found behavior if it doesn't exist), otherwise an
// exact display_name match (first match if somehow non-unique — display
// names aren't required to be unique, see UpdateDisplayName's own comment).
func FindUserByIDOrDisplayName(ctx context.Context, q Queryer, idOrName string) (*models.User, error) {
	if id, err := strconv.ParseInt(idOrName, 10, 64); err == nil {
		return GetUserByID(ctx, q, id)
	}
	var id int64
	err := q.QueryRowContext(ctx, `SELECT id FROM users WHERE display_name = ? LIMIT 1`, idOrName).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return GetUserByID(ctx, q, id)
}

// SetOIDCSubject links userID to subject directly — the link-oidc-account
// CLI subcommand's own write, for cases the automatic first-login claim in
// ClaimOrProvisionOIDCUser doesn't cover (re-linking after a subject needs
// correcting, or deliberately attaching a pre-provisioned account before
// its owner ever logs in). Fails with ErrDuplicateName if subject is
// already linked to a *different* row — checked explicitly rather than
// relying on the unique index's own constraint violation, same convention
// createNamedRow (lookup.go) already uses for name collisions.
func SetOIDCSubject(ctx context.Context, q Queryer, userID int64, subject string) error {
	var existingID int64
	err := q.QueryRowContext(ctx, `SELECT id FROM users WHERE oidc_subject = ?`, subject).Scan(&existingID)
	if err == nil && existingID != userID {
		return ErrDuplicateName
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	_, err = q.ExecContext(ctx, `UPDATE users SET oidc_subject = ? WHERE id = ?`, subject, userID)
	return err
}

// DeleteUser removes only this app's own users row — cascades via
// ON DELETE CASCADE to user_permissions/sessions/piece_favorites/
// piece_practice_status/piece_user_notes/user_settings, and to any
// user_tags/practice_statuses row it owns. Callers are responsible for the
// "can't delete the last admin" guard (business rule, not a DB constraint —
// same "handler enforces, repo executes" convention as every other
// guarded mutation in this app).
func DeleteUser(ctx context.Context, q Queryer, id int64) error {
	_, err := q.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, id)
	return err
}

// --- Sessions ---

// CreateSession inserts a new session row. token is expected to already be
// a cryptographically random string (internal/auth generates it) — this is
// a pure persistence step, no token generation here.
func CreateSession(ctx context.Context, q Queryer, token string, userID int64, expiresAt time.Time) error {
	_, err := q.ExecContext(ctx,
		`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`, token, userID, expiresAt,
	)
	return err
}

// GetSessionUserID looks up the user a still-valid session token belongs
// to. Returns ErrNotFound for a missing OR expired token — authMiddleware
// treats both identically (an expired session is, for every practical
// purpose, not a session).
func GetSessionUserID(ctx context.Context, q Queryer, token string) (int64, error) {
	var userID int64
	err := q.QueryRowContext(ctx,
		`SELECT user_id FROM sessions WHERE token = ? AND expires_at > CURRENT_TIMESTAMP`, token,
	).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	return userID, err
}

// DeleteSession removes one session (log out). Deleting an already-gone
// token is a no-op, not an error — logging out twice should never fail.
func DeleteSession(ctx context.Context, q Queryer, token string) error {
	_, err := q.ExecContext(ctx, `DELETE FROM sessions WHERE token = ?`, token)
	return err
}
