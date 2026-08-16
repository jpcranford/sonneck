package repo

import (
	"context"
	"database/sql"
	"errors"
)

// FindOrCreateInstrument implements the Calibre-style "pick existing or
// type a new one" tag pattern (design doc §5) for the free-form,
// user-extensible instrument list.
func FindOrCreateInstrument(ctx context.Context, q Queryer, name string) (int64, error) {
	return findOrCreateTag(ctx, q, "instruments", name)
}

// FindOrCreateUserTag is the same pattern for user-authored tags.
func FindOrCreateUserTag(ctx context.Context, q Queryer, name string) (int64, error) {
	return findOrCreateTag(ctx, q, "user_tags", name)
}

func findOrCreateTag(ctx context.Context, q Queryer, table, name string) (int64, error) {
	var id int64
	err := q.QueryRowContext(ctx, `SELECT id FROM `+table+` WHERE name = ?`, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}

	res, err := q.ExecContext(ctx, `INSERT INTO `+table+` (name) VALUES (?)`, name)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// SetPieceKeys replaces the full set of keys on a piece with keyIDs — a
// piece can genuinely be written in more than one key (e.g. a piece that
// modulates, or a medley), so this is many-to-many like instruments/user
// tags, not a single nullable column (migration 00008). Callers are
// responsible for resyncing the search index in the same transaction.
func SetPieceKeys(ctx context.Context, q Queryer, pieceID int64, keyIDs []int64) error {
	return replaceJoinRows(ctx, q, "piece_keys", "piece_id", "key_id", pieceID, keyIDs)
}

// SetPieceInstruments replaces the full set of instrument tags on a piece
// with instrumentIDs. Callers are responsible for resyncing the search
// index (ResyncSearchIndex) in the same transaction, per CLAUDE.md > Search.
func SetPieceInstruments(ctx context.Context, q Queryer, pieceID int64, instrumentIDs []int64) error {
	return replaceJoinRows(ctx, q, "piece_instruments", "piece_id", "instrument_id", pieceID, instrumentIDs)
}

// SetPieceUserTags replaces the full set of user tags on a piece.
func SetPieceUserTags(ctx context.Context, q Queryer, pieceID int64, tagIDs []int64) error {
	return replaceJoinRows(ctx, q, "piece_user_tags", "piece_id", "tag_id", pieceID, tagIDs)
}

// SetBookInstruments replaces the full set of instrument tags on a book.
func SetBookInstruments(ctx context.Context, q Queryer, bookID int64, instrumentIDs []int64) error {
	return replaceJoinRows(ctx, q, "book_instruments", "book_id", "instrument_id", bookID, instrumentIDs)
}

func replaceJoinRows(ctx context.Context, q Queryer, table, ownerCol, tagCol string, ownerID int64, tagIDs []int64) error {
	if _, err := q.ExecContext(ctx, `DELETE FROM `+table+` WHERE `+ownerCol+` = ?`, ownerID); err != nil {
		return err
	}
	for _, tagID := range tagIDs {
		if _, err := q.ExecContext(ctx,
			`INSERT INTO `+table+` (`+ownerCol+`, `+tagCol+`) VALUES (?, ?)`,
			ownerID, tagID,
		); err != nil {
			return err
		}
	}
	return nil
}

func getPieceKeyIDs(ctx context.Context, q Queryer, pieceID int64) ([]int64, error) {
	return getJoinedIDs(ctx, q, `SELECT key_id FROM piece_keys WHERE piece_id = ? ORDER BY key_id`, pieceID)
}

func getPieceInstrumentIDs(ctx context.Context, q Queryer, pieceID int64) ([]int64, error) {
	return getJoinedIDs(ctx, q, `SELECT instrument_id FROM piece_instruments WHERE piece_id = ? ORDER BY instrument_id`, pieceID)
}

func getPieceUserTagIDs(ctx context.Context, q Queryer, pieceID int64) ([]int64, error) {
	return getJoinedIDs(ctx, q, `SELECT tag_id FROM piece_user_tags WHERE piece_id = ? ORDER BY tag_id`, pieceID)
}

func getBookInstrumentIDs(ctx context.Context, q Queryer, bookID int64) ([]int64, error) {
	return getJoinedIDs(ctx, q, `SELECT instrument_id FROM book_instruments WHERE book_id = ? ORDER BY instrument_id`, bookID)
}

func getJoinedIDs(ctx context.Context, q Queryer, query string, arg int64) ([]int64, error) {
	rows, err := q.QueryContext(ctx, query, arg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// namesByIDs looks up display names for a set of tag IDs from the given
// lookup table, in no particular order — used when flattening tags into
// the pieces_fts row. A thin wrapper over TagsByIDs rather than its own
// query, so the IN-clause construction exists in exactly one place.
func namesByIDs(ctx context.Context, q Queryer, table string, ids []int64) ([]string, error) {
	tags, err := TagsByIDs(ctx, q, table, ids)
	if err != nil {
		return nil, err
	}
	if len(tags) == 0 {
		return nil, nil
	}
	names := make([]string, len(tags))
	for i, t := range tags {
		names[i] = t.Name
	}
	return names, nil
}

// Tag is an id+name pair shared across every lookup/tag table (Key,
// SheetType, Instrument, UserTag). JSON-tagged so API handlers can return
// it directly rather than mapping into a duplicate response type.
type Tag struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// ListInstruments and ListUserTags return every existing tag in each
// free-form table, for the frontend's combobox to suggest matches before
// falling back to "create new" (design doc §10/§15).
func ListInstruments(ctx context.Context, q Queryer) ([]Tag, error) {
	return listTags(ctx, q, "instruments")
}

func ListUserTags(ctx context.Context, q Queryer) ([]Tag, error) {
	return listTags(ctx, q, "user_tags")
}

func listTags(ctx context.Context, q Queryer, table string) ([]Tag, error) {
	rows, err := q.QueryContext(ctx, `SELECT id, name FROM `+table+` ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tags := []Tag{} // empty, not nil — see ListKeys' comment on why
	for rows.Next() {
		var t Tag
		if err := rows.Scan(&t.ID, &t.Name); err != nil {
			return nil, err
		}
		tags = append(tags, t)
	}
	return tags, rows.Err()
}

// TagsByIDs looks up id+name pairs for a set of tag IDs from the given
// lookup table — the API response counterpart to namesByIDs (which only
// needs flattened names for the search index).
func TagsByIDs(ctx context.Context, q Queryer, table string, ids []int64) ([]Tag, error) {
	if len(ids) == 0 {
		return []Tag{}, nil
	}
	placeholders := make([]byte, 0, len(ids)*2)
	args := make([]any, len(ids))
	for i, id := range ids {
		if i > 0 {
			placeholders = append(placeholders, ',')
		}
		placeholders = append(placeholders, '?')
		args[i] = id
	}

	rows, err := q.QueryContext(ctx, `SELECT id, name FROM `+table+` WHERE id IN (`+string(placeholders)+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tags := []Tag{} // empty, not nil — see ListKeys' comment on why
	for rows.Next() {
		var t Tag
		if err := rows.Scan(&t.ID, &t.Name); err != nil {
			return nil, err
		}
		tags = append(tags, t)
	}
	return tags, rows.Err()
}
