package repo

import (
	"context"
	"database/sql"
	"errors"
)

// UserPieceData is the per-(user,piece) data — favorite/notes/practice
// status — that used to be flat columns on Piece before migration 00025
// moved them into their own tables. Fetched/written separately from
// GetPieceByID/UpdatePiece, deliberately: most GetPieceByID callers (search
// indexing, thumbnail maintenance, CSV export, the CLI) have no
// request-scoped user at all, so this stays an explicit, opt-in call made
// only by the handlers that actually need one user's view of one piece.
type UserPieceData struct {
	Favorite       bool
	UserNotes      *string
	PracticeStatus *string // status name, resolved against practice_statuses
}

// GetUserPieceData loads userID's favorite/notes/practice-status for
// pieceID. Never errors on "no rows" for any of the three — each is
// independently optional (a piece with no favorite/notes/status row simply
// reports the zero value), so this issues three narrow queries rather than
// one row-shaped query that would need awkward outer-join NULL handling.
func GetUserPieceData(ctx context.Context, q Queryer, userID, pieceID int64) (UserPieceData, error) {
	var data UserPieceData

	err := q.QueryRowContext(ctx,
		`SELECT 1 FROM piece_favorites WHERE user_id = ? AND piece_id = ?`, userID, pieceID,
	).Scan(new(int))
	switch {
	case err == nil:
		data.Favorite = true
	case errors.Is(err, sql.ErrNoRows):
		// not favorited — zero value already correct
	default:
		return data, err
	}

	err = q.QueryRowContext(ctx,
		`SELECT notes FROM piece_user_notes WHERE user_id = ? AND piece_id = ?`, userID, pieceID,
	).Scan(&data.UserNotes)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return data, err
	}

	err = q.QueryRowContext(ctx, `
		SELECT ps.name FROM piece_practice_status pps
		JOIN practice_statuses ps ON ps.id = pps.status_id
		WHERE pps.user_id = ? AND pps.piece_id = ?`, userID, pieceID,
	).Scan(&data.PracticeStatus)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return data, err
	}

	return data, nil
}

// SetUserPieceData writes userID's favorite/notes/practice-status for
// pieceID, full-replace per field (same convention as every other setter in
// this app — the caller always supplies the field's complete new state, not
// a delta). statusID is the already-resolved practice_statuses.id for
// data.PracticeStatus (nil clears it) — resolving a status *name* to an id
// (and validating it belongs to userID) is the caller's job, done once
// up front so this function never has to fail mid-write on a bad name.
func SetUserPieceData(ctx context.Context, q Queryer, userID, pieceID int64, data UserPieceData, statusID *int64) error {
	if data.Favorite {
		if _, err := q.ExecContext(ctx,
			`INSERT INTO piece_favorites (user_id, piece_id) VALUES (?, ?)
			 ON CONFLICT (user_id, piece_id) DO NOTHING`, userID, pieceID,
		); err != nil {
			return err
		}
	} else if _, err := q.ExecContext(ctx,
		`DELETE FROM piece_favorites WHERE user_id = ? AND piece_id = ?`, userID, pieceID,
	); err != nil {
		return err
	}

	if data.UserNotes != nil && *data.UserNotes != "" {
		if _, err := q.ExecContext(ctx, `
			INSERT INTO piece_user_notes (user_id, piece_id, notes) VALUES (?, ?, ?)
			ON CONFLICT (user_id, piece_id) DO UPDATE SET notes = excluded.notes`,
			userID, pieceID, *data.UserNotes,
		); err != nil {
			return err
		}
	} else if _, err := q.ExecContext(ctx,
		`DELETE FROM piece_user_notes WHERE user_id = ? AND piece_id = ?`, userID, pieceID,
	); err != nil {
		return err
	}

	if statusID != nil {
		if _, err := q.ExecContext(ctx, `
			INSERT INTO piece_practice_status (user_id, piece_id, status_id) VALUES (?, ?, ?)
			ON CONFLICT (user_id, piece_id) DO UPDATE SET status_id = excluded.status_id`,
			userID, pieceID, *statusID,
		); err != nil {
			return err
		}
	} else if _, err := q.ExecContext(ctx,
		`DELETE FROM piece_practice_status WHERE user_id = ? AND piece_id = ?`, userID, pieceID,
	); err != nil {
		return err
	}

	return nil
}

// DeleteUserPieceData removes every per-user row for pieceID across all
// users, not just one — called from handleDeletePiece alongside DeletePiece
// itself. ON DELETE CASCADE on piece_id already covers this in principle,
// but these three tables key on pieceID a plain DELETE FROM pieces WHERE id
// = ? already cascades correctly on its own; this function exists only for
// symmetry with callers that delete a piece's per-user data without also
// deleting the piece row itself (there are none today) — kept minimal
// rather than half-built for a case that doesn't exist yet.

// PracticeStatus is a per-user practice-status row — same id+name wire
// shape as repo.Tag (JSON tags included, so this can be returned directly
// from a handler the same way Tag already is), plus IconKey (migration
// 00026) — nil for anything but the five seeded defaults, which the
// frontend's own PRACTICE_STATUS_ICON_COMPONENTS map (User Settings) keys
// by. Durable and rename-proof by construction: RenamePracticeStatus only
// ever touches `name`.
type PracticeStatus struct {
	ID      int64   `json:"id"`
	Name    string  `json:"name"`
	IconKey *string `json:"iconKey"`
}

// ListPracticeStatuses returns userID's own practice statuses, alphabetical
// — same convention ListUserTags already uses for its combobox/settings
// list.
func ListPracticeStatuses(ctx context.Context, q Queryer, userID int64) ([]PracticeStatus, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT id, name, icon_key FROM practice_statuses WHERE owner_user_id = ? ORDER BY name`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	statuses := []PracticeStatus{}
	for rows.Next() {
		var s PracticeStatus
		if err := rows.Scan(&s.ID, &s.Name, &s.IconKey); err != nil {
			return nil, err
		}
		statuses = append(statuses, s)
	}
	return statuses, rows.Err()
}

// FindPracticeStatusByName resolves a status name to its id, scoped to
// userID's own set — used both to validate a piece write's practiceStatus
// field and to resolve the merge-target id on delete. ok is false (with no
// error) when userID has no status by that name; callers treat that as a
// validation failure, not an infrastructure error.
func FindPracticeStatusByName(ctx context.Context, q Queryer, userID int64, name string) (id int64, ok bool, err error) {
	err = q.QueryRowContext(ctx,
		`SELECT id FROM practice_statuses WHERE owner_user_id = ? AND name = ?`, userID, name,
	).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	return id, true, nil
}

// CreatePracticeStatus adds a new status owned by userID — blank-name
// rejection is the caller's job (api.ValidateTagName), duplicate-name
// rejection (within that user's own set) is this function's, via
// createNamedRow (internal/repo/lookup.go), returning ErrDuplicateName
// rather than surfacing the table's own UNIQUE constraint as an opaque 500.
func CreatePracticeStatus(ctx context.Context, q Queryer, userID int64, name string) (int64, error) {
	return createNamedRow(ctx, q, "practice_statuses", "owner_user_id", name, userID)
}

// RenamePracticeStatus changes statusID's display name within userID's own
// set (User Settings' Practice Status card, master plan Phase 12) — via
// renameNamedRow (internal/repo/lookup.go), same duplicate/ownership
// guarantees as RenameUserTag. Not indexed in pieces_fts (unlike a tag
// rename), so no search-index resync is needed here.
func RenamePracticeStatus(ctx context.Context, q Queryer, userID, statusID int64, name string) error {
	return renameNamedRow(ctx, q, "practice_statuses", "owner_user_id", userID, statusID, name)
}

// DeletePracticeStatus removes statusID (already confirmed to belong to
// userID by the caller). mergeIntoID present means every piece_practice_status
// row pointing at statusID is repointed to mergeIntoID first, in the same
// transaction — same merge-then-delete shape Admin Settings' lookup-table
// delete/merge already uses; nil means delete outright, and affected pieces
// simply lose that status via ON DELETE CASCADE.
func DeletePracticeStatus(ctx context.Context, q Queryer, statusID int64, mergeIntoID *int64) error {
	if mergeIntoID != nil {
		if _, err := q.ExecContext(ctx, `
			UPDATE piece_practice_status SET status_id = ?
			WHERE status_id = ? AND piece_id NOT IN (
				SELECT piece_id FROM piece_practice_status WHERE status_id = ?
			)`, *mergeIntoID, statusID, *mergeIntoID,
		); err != nil {
			return err
		}
		// Any row left pointing at statusID at this point belongs to a piece
		// that already also had mergeIntoID set (impossible under this
		// table's own PRIMARY KEY (user_id, piece_id) — a piece can only
		// ever have one status per user — but deleted defensively rather
		// than assumed away) or the UPDATE above already moved it; either
		// way the plain DELETE TABLE below (via ON DELETE CASCADE, once
		// practice_statuses itself is deleted) cleans up whatever remains.
	}
	_, err := q.ExecContext(ctx, `DELETE FROM practice_statuses WHERE id = ?`, statusID)
	return err
}

// --- User settings ---

// UserSettings is the small fixed set of admin-screen-visible per-user
// preferences (migration 00025's user_settings table). JSON tags included
// (same convention as PracticeStatus/Tag) — GET/PATCH /api/user-settings
// (master plan Phase 12) return/accept this shape directly.
type UserSettings struct {
	ShowBooksInSidebar bool   `json:"showBooksInSidebar"`
	ThemePreference    string `json:"themePreference"`
	ContentViewMode    string `json:"contentViewMode"`
}

// GetUserSettings loads userID's settings row — always exists once the
// user does (seeded at account creation, same as practice_statuses).
func GetUserSettings(ctx context.Context, q Queryer, userID int64) (*UserSettings, error) {
	s := &UserSettings{}
	err := q.QueryRowContext(ctx, `
		SELECT show_books_in_sidebar, theme_preference, content_view_mode
		FROM user_settings WHERE user_id = ?`, userID,
	).Scan(&s.ShowBooksInSidebar, &s.ThemePreference, &s.ContentViewMode)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return s, nil
}

// UpdateUserSettings writes userID's full settings row (full-replace, same
// convention as every other settings-style write in this app).
func UpdateUserSettings(ctx context.Context, q Queryer, userID int64, s UserSettings) error {
	_, err := q.ExecContext(ctx, `
		UPDATE user_settings SET show_books_in_sidebar = ?, theme_preference = ?, content_view_mode = ?
		WHERE user_id = ?`,
		s.ShowBooksInSidebar, s.ThemePreference, s.ContentViewMode, userID,
	)
	return err
}

// SeedNewUserData creates a fresh user's practice_statuses (the same five
// defaults every existing account was seeded with) and user_settings row —
// called once at account creation (Phase 14's OIDC first-login provisioning
// will be the real caller; not exercised by none/singlepass, which never
// creates a second account).
func SeedNewUserData(ctx context.Context, q Queryer, userID int64) error {
	// sidebar_slot/icon_key (migration 00026) — same assignment the
	// migration's own backfill gives every existing account's rows, kept in
	// sync deliberately rather than shared: this is a one-time INSERT
	// literal, that migration is a one-time UPDATE, and there's no third
	// call site that would justify factoring the mapping out.
	defaults := []struct {
		name        string
		sidebarSlot *string
		iconKey     *string
	}{
		{"Want to Learn", ptr("want_to_learn"), ptr("want_to_learn")},
		{"Learning", ptr("practicing"), ptr("learning")},
		{"Stalled", ptr("practicing"), ptr("stalled")},
		{"Learned", ptr("learned"), ptr("learned")},
		{"Dropped", nil, ptr("dropped")},
	}
	for _, d := range defaults {
		if _, err := q.ExecContext(ctx,
			`INSERT INTO practice_statuses (owner_user_id, name, sidebar_slot, icon_key) VALUES (?, ?, ?, ?)`,
			userID, d.name, d.sidebarSlot, d.iconKey,
		); err != nil {
			return err
		}
	}
	_, err := q.ExecContext(ctx, `INSERT INTO user_settings (user_id) VALUES (?)`, userID)
	return err
}

func ptr(s string) *string { return &s }
