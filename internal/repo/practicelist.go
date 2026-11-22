package repo

import (
	"context"
	"database/sql"
	"errors"
	"slices"
)

// The Sheet Viewer's Practice List (migration 00033): one ordered queue of
// pieces per user, each piece at most once.

// ErrPracticeListOrder is a reorder that doesn't name exactly the pieces
// on the list.
var ErrPracticeListOrder = errors.New("practice list order must list every piece on it exactly once")

// ListPracticeList returns userID's Practice List as piece ids, in order.
func ListPracticeList(ctx context.Context, q Queryer, userID int64) ([]int64, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT piece_id FROM practice_list_entries WHERE owner_user_id = ? ORDER BY position, added_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// AddToPracticeList appends pieceIDs to the end of userID's list, in the
// order given, skipping any already on it. Returns how many were added.
func AddToPracticeList(ctx context.Context, q Queryer, userID int64, pieceIDs []int64) (int, error) {
	var next int
	if err := q.QueryRowContext(ctx,
		`SELECT COALESCE(MAX(position) + 1, 0) FROM practice_list_entries WHERE owner_user_id = ?`, userID,
	).Scan(&next); err != nil {
		return 0, err
	}
	added := 0
	for _, id := range pieceIDs {
		res, err := q.ExecContext(ctx, `
			INSERT INTO practice_list_entries (owner_user_id, piece_id, position) VALUES (?, ?, ?)
			ON CONFLICT (owner_user_id, piece_id) DO NOTHING`, userID, id, next)
		if err != nil {
			return added, err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			added++
			next++
		}
	}
	return added, nil
}

// RemoveFromPracticeList takes pieceID off userID's list (a no-op if it
// isn't there).
func RemoveFromPracticeList(ctx context.Context, q Queryer, userID, pieceID int64) error {
	_, err := q.ExecContext(ctx,
		`DELETE FROM practice_list_entries WHERE owner_user_id = ? AND piece_id = ?`, userID, pieceID)
	return err
}

// ReorderPracticeList rewrites userID's list order to pieceIDs, which must
// be exactly the pieces on it (ErrPracticeListOrder otherwise).
func ReorderPracticeList(ctx context.Context, q Queryer, userID int64, pieceIDs []int64) error {
	current, err := ListPracticeList(ctx, q, userID)
	if err != nil {
		return err
	}
	sortedNew := slices.Clone(pieceIDs)
	slices.Sort(sortedNew)
	slices.Sort(current)
	if !slices.Equal(current, sortedNew) {
		return ErrPracticeListOrder
	}
	for i, id := range pieceIDs {
		if _, err := q.ExecContext(ctx,
			`UPDATE practice_list_entries SET position = ? WHERE owner_user_id = ? AND piece_id = ?`,
			i, userID, id); err != nil {
			return err
		}
	}
	return nil
}

// PracticedOn returns, for each of pieceIDs that has a row for day, whether
// it's marked practiced (true) or explicitly unmarked (false); a piece with
// no row that day is left out.
func PracticedOn(ctx context.Context, q Queryer, userID int64, day string, pieceIDs []int64) (map[int64]bool, error) {
	marks := map[int64]bool{}
	for _, id := range pieceIDs {
		var practiced bool
		err := q.QueryRowContext(ctx,
			`SELECT practiced FROM piece_practice_days WHERE user_id = ? AND piece_id = ? AND day = ?`,
			userID, id, day).Scan(&practiced)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		marks[id] = practiced
	}
	return marks, nil
}

// SetPracticed marks pieceID practiced (or, false, explicitly unmarked) on
// day for userID.
func SetPracticed(ctx context.Context, q Queryer, userID, pieceID int64, day string, practiced bool) error {
	_, err := q.ExecContext(ctx, `
		INSERT INTO piece_practice_days (user_id, piece_id, day, practiced) VALUES (?, ?, ?, ?)
		ON CONFLICT (user_id, piece_id, day) DO UPDATE SET practiced = excluded.practiced`,
		userID, pieceID, day, practiced)
	return err
}

// LearningAfterDays is how many days practiced, within the last four
// weeks and not all in one week, move a piece the user hadn't started (no
// status, or Want to Learn) to Learning.
const LearningAfterDays = 3

// PromoteToLearning moves userID's pieceID to their Learning status when
// it has been practiced on at least LearningAfterDays days within the last
// four weeks (the day just marked and the 27 before it), at least one of
// them in an earlier week than the marked day (7 to 27 days before it).
// Weeks roll back from the marked day rather than following the calendar,
// so a Sunday and the next Monday don't count as two weeks, and no
// week-start setting is needed. Only a piece with no status, or Want to
// Learn, moves (statuses are matched by icon key, which survives
// renaming); any other status is left alone, as is a user without a
// Learning status. It's checked when a day is marked practiced, so it
// reports whether it changed anything.
func PromoteToLearning(ctx context.Context, q Queryer, userID, pieceID int64, day string) (bool, error) {
	var days, earlierWeeks int
	if err := q.QueryRowContext(ctx, `
		SELECT COUNT(*), COALESCE(SUM(day <= date(?, '-7 days')), 0) FROM piece_practice_days
		WHERE user_id = ? AND piece_id = ? AND practiced = 1
			AND day BETWEEN date(?, '-27 days') AND ?`,
		day, userID, pieceID, day, day,
	).Scan(&days, &earlierWeeks); err != nil {
		return false, err
	}
	if days < LearningAfterDays || earlierWeeks == 0 {
		return false, nil
	}
	var current sql.NullString
	err := q.QueryRowContext(ctx, `
		SELECT ps.icon_key FROM piece_practice_status pps
		JOIN practice_statuses ps ON ps.id = pps.status_id
		WHERE pps.user_id = ? AND pps.piece_id = ?`, userID, pieceID).Scan(&current)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return false, err
	}
	if err == nil && current.String != "want_to_learn" {
		return false, nil
	}
	var learning int64
	err = q.QueryRowContext(ctx,
		`SELECT id FROM practice_statuses WHERE owner_user_id = ? AND icon_key = 'learning'`,
		userID).Scan(&learning)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := SetUserPracticeStatus(ctx, q, userID, pieceID, &learning); err != nil {
		return false, err
	}
	return true, nil
}

// LastPracticed returns the latest day userID practiced pieceID, or nil.
func LastPracticed(ctx context.Context, q Queryer, userID, pieceID int64) (*string, error) {
	var day sql.NullString
	if err := q.QueryRowContext(ctx,
		`SELECT MAX(day) FROM piece_practice_days WHERE user_id = ? AND piece_id = ? AND practiced = 1`,
		userID, pieceID).Scan(&day); err != nil {
		return nil, err
	}
	if !day.Valid {
		return nil, nil
	}
	return &day.String, nil
}
