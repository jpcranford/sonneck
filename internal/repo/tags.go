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

// FindOrCreateUserTag is the same pattern for user-authored tags, scoped to
// ownerUserID — user_tags became a private per-user vocabulary in migration
// 00025 (CLAUDE.md > Concurrency's own forward note), so "find existing"
// only ever matches a tag this same user already owns; two different users
// typing the identical tag name each get their own row, never share one.
func FindOrCreateUserTag(ctx context.Context, q Queryer, ownerUserID int64, name string) (int64, error) {
	var id int64
	err := q.QueryRowContext(ctx,
		`SELECT id FROM user_tags WHERE owner_user_id = ? AND name = ?`, ownerUserID, name,
	).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}

	res, err := q.ExecContext(ctx,
		`INSERT INTO user_tags (owner_user_id, name) VALUES (?, ?)`, ownerUserID, name,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
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
//
// Unlike the other join tables, key order is meaningful — a piece's key
// pills must display in the order the user selected them, not any
// alphabetical/chromatic one (migration 00011) — so this doesn't use the
// generic order-blind replaceJoinRows; keyIDs' slice order is persisted
// directly as an explicit position column.
func SetPieceKeys(ctx context.Context, q Queryer, pieceID int64, keyIDs []int64) error {
	if _, err := q.ExecContext(ctx, `DELETE FROM piece_keys WHERE piece_id = ?`, pieceID); err != nil {
		return err
	}
	for position, keyID := range keyIDs {
		if _, err := q.ExecContext(ctx,
			`INSERT INTO piece_keys (piece_id, key_id, position) VALUES (?, ?, ?)`,
			pieceID, keyID, position,
		); err != nil {
			return err
		}
	}
	return nil
}

// SetPieceInstruments replaces the full set of instrument tags on a piece
// with instrumentIDs. Callers are responsible for resyncing the search
// index (ResyncSearchIndex) in the same transaction, per CLAUDE.md > Search.
func SetPieceInstruments(ctx context.Context, q Queryer, pieceID int64, instrumentIDs []int64) error {
	return replaceJoinRows(ctx, q, "piece_instruments", "piece_id", "instrument_id", pieceID, instrumentIDs)
}

// SetPieceUserTags replaces ownerUserID's own tag assignments on pieceID —
// deliberately NOT the generic replaceJoinRows shape every other Set*
// function here uses, and NOT a plain "delete every row for this piece_id"
// the way that shape would imply. piece_user_tags carries no user_id column
// of its own (multiple users' private tags on the same piece coexist in the
// same join table, per migration 00025's own design), so an unscoped delete
// would silently wipe every OTHER user's tag associations on this piece too
// — a real cross-account data-loss bug, caught live: user A tags a piece,
// user B then edits the SAME piece's tags (even to set their own, unrelated
// tags), and user A's own tags vanished. Fixed by scoping the delete to
// only rows whose tag_id is owned by ownerUserID before inserting the new
// list — every other user's own rows on this same piece are left untouched.
func SetPieceUserTags(ctx context.Context, q Queryer, pieceID, ownerUserID int64, tagIDs []int64) error {
	if _, err := q.ExecContext(ctx, `
		DELETE FROM piece_user_tags
		WHERE piece_id = ? AND tag_id IN (SELECT id FROM user_tags WHERE owner_user_id = ?)`,
		pieceID, ownerUserID,
	); err != nil {
		return err
	}
	for _, tagID := range tagIDs {
		if _, err := q.ExecContext(ctx,
			`INSERT INTO piece_user_tags (piece_id, tag_id) VALUES (?, ?)`, pieceID, tagID,
		); err != nil {
			return err
		}
	}
	return nil
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
	return getJoinedIDs(ctx, q, `SELECT key_id FROM piece_keys WHERE piece_id = ? ORDER BY position`, pieceID)
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

// CreateUserTag adds a new tag owned by ownerUserID — unlike
// FindOrCreateUserTag (silently reuses an existing name match, used by
// piece writes), this is a genuine create for User Settings' own "+"
// button: ErrDuplicateName on a name already in that user's own set,
// checked via createNamedRow (internal/repo/lookup.go).
func CreateUserTag(ctx context.Context, q Queryer, ownerUserID int64, name string) (int64, error) {
	return createNamedRow(ctx, q, "user_tags", "owner_user_id", name, ownerUserID)
}

// RenameUserTag changes tagID's display name within ownerUserID's own
// vocabulary (User Settings' Your Tags card) — via renameNamedRow
// (internal/repo/lookup.go), so a duplicate name within that
// same owner's set reports ErrDuplicateName, and a tagID belonging to a
// different owner reports ErrNotFound rather than silently renaming
// someone else's tag.
func RenameUserTag(ctx context.Context, q Queryer, ownerUserID, tagID int64, name string) error {
	return renameNamedRow(ctx, q, "user_tags", "owner_user_id", ownerUserID, tagID, name)
}

// ListUserTags returns only ownerUserID's own tags — private per-user
// vocabulary (migration 00025), not the shared listTags/global-table
// pattern Instruments still uses.
func ListUserTags(ctx context.Context, q Queryer, ownerUserID int64) ([]Tag, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT id, name FROM user_tags WHERE owner_user_id = ? ORDER BY name`, ownerUserID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tags := []Tag{}
	for rows.Next() {
		var t Tag
		if err := rows.Scan(&t.ID, &t.Name); err != nil {
			return nil, err
		}
		tags = append(tags, t)
	}
	return tags, rows.Err()
}

// UserTagsByIDsForUser resolves a piece's tag_id list to display names,
// scoped to ownerUserID — any id in ids that belongs to a *different*
// user's private vocabulary (possible since piece_user_tags itself carries
// no user_id of its own, per migration 00025's own comment) is silently
// dropped rather than shown, since a viewer must never see another
// account's private tag names on a piece they both happen to have tagged.
func UserTagsByIDsForUser(ctx context.Context, q Queryer, ownerUserID int64, ids []int64) ([]Tag, error) {
	if len(ids) == 0 {
		return []Tag{}, nil
	}
	placeholders := make([]byte, 0, len(ids)*2)
	args := make([]any, 0, len(ids)+1)
	args = append(args, ownerUserID)
	for i, id := range ids {
		if i > 0 {
			placeholders = append(placeholders, ',')
		}
		placeholders = append(placeholders, '?')
		args = append(args, id)
	}

	rows, err := q.QueryContext(ctx,
		`SELECT id, name FROM user_tags WHERE owner_user_id = ? AND id IN (`+string(placeholders)+`)`, args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tags := []Tag{}
	for rows.Next() {
		var t Tag
		if err := rows.Scan(&t.ID, &t.Name); err != nil {
			return nil, err
		}
		tags = append(tags, t)
	}
	return tags, rows.Err()
}

// PieceIDsWithUserTag collects every piece needing a search-index resync
// after a user tag delete/merge (CLAUDE.md > Search) — direct join-table
// membership only, no book-inheritance fallback (user_tags was never
// book-inheritable). Must be called BEFORE DeleteUserTag, same "collect
// before the value moves" convention as PieceIDsUsingSheetType/
// PieceIDsUsingInstrument.
func PieceIDsWithUserTag(ctx context.Context, q Queryer, tagID int64) ([]int64, error) {
	return getJoinedIDs(ctx, q, `SELECT piece_id FROM piece_user_tags WHERE tag_id = ?`, tagID)
}

// DeleteUserTag removes tagID (already confirmed to belong to the calling
// user). mergeIntoID present means every piece_user_tags row pointing at
// tagID is repointed to mergeIntoID first — same merge-then-delete shape
// DeletePracticeStatus/the admin lookup-table delete already use.
func DeleteUserTag(ctx context.Context, q Queryer, tagID int64, mergeIntoID *int64) error {
	if mergeIntoID != nil {
		if _, err := q.ExecContext(ctx, `
			UPDATE piece_user_tags SET tag_id = ?
			WHERE tag_id = ? AND piece_id NOT IN (
				SELECT piece_id FROM piece_user_tags WHERE tag_id = ?
			)`, *mergeIntoID, tagID, *mergeIntoID,
		); err != nil {
			return err
		}
	}
	_, err := q.ExecContext(ctx, `DELETE FROM user_tags WHERE id = ?`, tagID)
	return err
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
// needs flattened names for the search index). No particular row order.
func TagsByIDs(ctx context.Context, q Queryer, table string, ids []int64) ([]Tag, error) {
	return tagsByIDsOrdered(ctx, q, table, ids, "")
}

// KeysByIDs is TagsByIDs specialized to musical_keys, preserving the exact
// order of ids rather than any DB-side order. ids is expected to already
// be in the piece's own selection order (piece_keys.position, migration
// 00011, via getPieceKeyIDs) — a piece's key pills must display in the
// order the user selected them, not musical_keys' own chromatic
// sort_order (that one's only for the picker dropdown's master list,
// ListKeys, a genuinely different concern). `WHERE id IN (...)` doesn't
// preserve argument order on its own, so this re-sorts the query result
// in Go to match ids exactly.
func KeysByIDs(ctx context.Context, q Queryer, ids []int64) ([]Tag, error) {
	unordered, err := tagsByIDsOrdered(ctx, q, "musical_keys", ids, "")
	if err != nil {
		return nil, err
	}
	byID := make(map[int64]Tag, len(unordered))
	for _, t := range unordered {
		byID[t.ID] = t
	}
	tags := make([]Tag, 0, len(ids))
	for _, id := range ids {
		if t, ok := byID[id]; ok {
			tags = append(tags, t)
		}
	}
	return tags, nil
}

func tagsByIDsOrdered(ctx context.Context, q Queryer, table string, ids []int64, orderBy string) ([]Tag, error) {
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

	query := `SELECT id, name FROM ` + table + ` WHERE id IN (` + string(placeholders) + `)`
	if orderBy != "" {
		query += ` ORDER BY ` + orderBy
	}

	rows, err := q.QueryContext(ctx, query, args...)
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
