package repo

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jpcranford/sonneck/internal/models"
)

// ListKeys, and every other List* in this package, initializes its result
// as an empty slice rather than `var x []T` — a nil slice with zero appends
// marshals as JSON `null`, and frontend callers type these as plain arrays,
// not T[] | null (a real bug: an empty musical_keys/instruments/user_tags
// table crashed the frontend before this fix).
// Ordered by sort_order (an explicit chromatic display order, migration
// 00010), not id — id order silently breaks the moment a key is inserted
// out of chromatic sequence (e.g. G♭ Major, added after every other seed
// row already existed, needs to sit next to F♯ Major, not at the end).
func ListKeys(ctx context.Context, q Queryer) ([]models.Key, error) {
	rows, err := q.QueryContext(ctx, `SELECT id, name FROM musical_keys ORDER BY sort_order`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	keys := []models.Key{}
	for rows.Next() {
		var k models.Key
		if err := rows.Scan(&k.ID, &k.Name); err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

// Ordered by sort_order (an explicit display order, migration 00013), not
// id — same reasoning as ListKeys above: id order silently breaks the
// moment a row is inserted out of its intended reading position (e.g.
// "Ensemble Piece – Part", added after every other seed row already
// existed, needs to sit next to "Ensemble Piece – Full Score", not at the
// end).
func ListSheetTypes(ctx context.Context, q Queryer) ([]models.SheetType, error) {
	rows, err := q.QueryContext(ctx, `SELECT id, name FROM sheet_types ORDER BY sort_order`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	types := []models.SheetType{}
	for rows.Next() {
		var st models.SheetType
		if err := rows.Scan(&st.ID, &st.Name); err != nil {
			return nil, err
		}
		types = append(types, st)
	}
	return types, rows.Err()
}

func GetSheetTypeByID(ctx context.Context, q Queryer, id int64) (*models.SheetType, error) {
	var st models.SheetType
	err := q.QueryRowContext(ctx, `SELECT id, name FROM sheet_types WHERE id = ?`, id).Scan(&st.ID, &st.Name)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &st, nil
}

// FindOrCreateKey and FindOrCreateSheetType implement the same
// Calibre-style "pick existing or type a new one" pattern as instruments/
// user tags (design doc §5 groups key/instruments/sheetType/userTags
// together under that rule) — the 24 seeded keys and 4 seeded sheet types
// are a starting point, not a closed enum.
func FindOrCreateKey(ctx context.Context, q Queryer, name string) (int64, error) {
	return findOrCreateTag(ctx, q, "musical_keys", name)
}

func FindOrCreateSheetType(ctx context.Context, q Queryer, name string) (int64, error) {
	return findOrCreateTag(ctx, q, "sheet_types", name)
}

// --- Admin Settings' Lookup Tables: create/rename/delete/merge for
// SheetType and Instrument (master plan's Backend architecture, locked
// 2026-09-07 per direct feedback on the Phase 9 mockup). Key is
// deliberately not included here — it never got this same create/delete/
// merge treatment in the mockup (sequenceStyle's own ordered-list nature
// makes "merge" a poor fit), so it stays rename-only via FindOrCreateKey's
// existing pick-or-type pattern.

// CreateSheetType/CreateInstrument add a new row — a plain wrapper over
// each table's own AUTOINCREMENT insert, kept separate from
// FindOrCreateSheetType/FindOrCreateInstrument (which silently reuse an
// existing row on a name match) since the admin "+" button always means
// "create a genuinely new entry," never a find-or-create. ErrDuplicateName
// (not a raw UNIQUE-constraint error) is returned on a name collision, so
// the handler can report a clean 400 rather than an opaque 500 — checked
// explicitly rather than relying on the table's own UNIQUE constraint
// alone, since a caught constraint violation from the driver isn't
// distinguished from any other write failure by writeError today.
func CreateSheetType(ctx context.Context, q Queryer, name string) (int64, error) {
	return createNamedRow(ctx, q, "sheet_types", "", name)
}

func CreateInstrument(ctx context.Context, q Queryer, name string) (int64, error) {
	return createNamedRow(ctx, q, "instruments", "", name)
}

// ErrDuplicateName is returned by the Create* functions in this file when
// name already exists (within the relevant scope — global for lookup
// tables, per-owner for user tags/practice statuses).
var ErrDuplicateName = errors.New("name already exists")

// createNamedRow is the shared "reject a duplicate name with
// ErrDuplicateName, else insert" shape behind CreateSheetType/
// CreateInstrument/CreateUserTag/CreatePracticeStatus. ownerCol/ownerID are
// empty/zero for the two global lookup tables (no owner scoping at all).
func createNamedRow(ctx context.Context, q Queryer, table, ownerCol string, name string, ownerArgs ...int64) (int64, error) {
	existsQuery := `SELECT 1 FROM ` + table + ` WHERE name = ?`
	args := []any{name}
	if ownerCol != "" {
		existsQuery += ` AND ` + ownerCol + ` = ?`
		args = append(args, ownerArgs[0])
	}
	var one int
	err := q.QueryRowContext(ctx, existsQuery, args...).Scan(&one)
	if err == nil {
		return 0, ErrDuplicateName
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}

	insertQuery := `INSERT INTO ` + table + ` (name`
	insertArgs := []any{name}
	if ownerCol != "" {
		insertQuery += `, ` + ownerCol
		insertArgs = append(insertArgs, ownerArgs[0])
	}
	insertQuery += `) VALUES (?`
	if ownerCol != "" {
		insertQuery += `, ?`
	}
	insertQuery += `)`

	res, err := q.ExecContext(ctx, insertQuery, insertArgs...)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// RenameSheetType/RenameInstrument change a row's display name in place —
// every piece/book already using it reflects the new name automatically via
// the existing FK/join relationship, not a separate fan-out write.
func RenameSheetType(ctx context.Context, q Queryer, id int64, name string) error {
	_, err := q.ExecContext(ctx, `UPDATE sheet_types SET name = ? WHERE id = ?`, name, id)
	return err
}

func RenameInstrument(ctx context.Context, q Queryer, id int64, name string) error {
	_, err := q.ExecContext(ctx, `UPDATE instruments SET name = ? WHERE id = ?`, name, id)
	return err
}

// PieceIDsUsingSheetType/PieceIDsUsingInstrument collect every piece that
// needs a search-index resync (CLAUDE.md > Search) after a lookup-table
// delete/merge/rename — both direct assignment and inheritance through the
// piece's own source Book count, since a Book's own sheet_type_id/
// instrument assignment is being rewritten by the same operation. Must be
// called BEFORE Delete*, while the old id is still the value actually
// stored — the caller passes the collected ids to repo.ResyncSearchIndex
// itself, in the same transaction as the delete/merge.
func PieceIDsUsingSheetType(ctx context.Context, q Queryer, sheetTypeID int64) ([]int64, error) {
	return queryPieceIDs(ctx, q, `
		SELECT id FROM pieces WHERE sheet_type_id = ?
		UNION
		SELECT id FROM pieces WHERE source_book_id IN (SELECT id FROM books WHERE sheet_type_id = ?)`,
		sheetTypeID, sheetTypeID)
}

func PieceIDsUsingInstrument(ctx context.Context, q Queryer, instrumentID int64) ([]int64, error) {
	return queryPieceIDs(ctx, q, `
		SELECT piece_id FROM piece_instruments WHERE instrument_id = ?
		UNION
		SELECT id FROM pieces WHERE source_book_id IN (
			SELECT book_id FROM book_instruments WHERE instrument_id = ?
		)`,
		instrumentID, instrumentID)
}

func queryPieceIDs(ctx context.Context, q Queryer, query string, args ...any) ([]int64, error) {
	rows, err := q.QueryContext(ctx, query, args...)
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

// DeleteSheetType removes sheetTypeID. mergeIntoID present means every
// piece/book referencing it is repointed to mergeIntoID first; nil means
// every piece/book referencing it simply loses that value (set to NULL) —
// pieces.sheet_type_id/books.sheet_type_id have no ON DELETE clause of
// their own (unlike Instrument's join tables below), so this must always
// explicitly clear or repoint the reference before the row itself can be
// deleted under FK enforcement, never leaving it dangling.
func DeleteSheetType(ctx context.Context, q Queryer, sheetTypeID int64, mergeIntoID *int64) error {
	var newValue any
	if mergeIntoID != nil {
		newValue = *mergeIntoID
	}
	if _, err := q.ExecContext(ctx, `UPDATE pieces SET sheet_type_id = ? WHERE sheet_type_id = ?`, newValue, sheetTypeID); err != nil {
		return err
	}
	if _, err := q.ExecContext(ctx, `UPDATE books SET sheet_type_id = ? WHERE sheet_type_id = ?`, newValue, sheetTypeID); err != nil {
		return err
	}
	_, err := q.ExecContext(ctx, `DELETE FROM sheet_types WHERE id = ?`, sheetTypeID)
	return err
}

// DeleteInstrument removes instrumentID. mergeIntoID present means every
// piece_instruments/book_instruments row pointing at it is repointed to
// mergeIntoID first (skipping any piece/book that already also has
// mergeIntoID assigned, to avoid a duplicate-PRIMARY-KEY conflict — same
// shape DeletePracticeStatus/DeleteUserTag already use); nil means the
// join rows simply cascade-delete (ON DELETE CASCADE on instrument_id,
// unlike SheetType above) once the row itself is removed.
func DeleteInstrument(ctx context.Context, q Queryer, instrumentID int64, mergeIntoID *int64) error {
	if mergeIntoID != nil {
		if _, err := q.ExecContext(ctx, `
			UPDATE piece_instruments SET instrument_id = ?
			WHERE instrument_id = ? AND piece_id NOT IN (
				SELECT piece_id FROM piece_instruments WHERE instrument_id = ?
			)`, *mergeIntoID, instrumentID, *mergeIntoID,
		); err != nil {
			return err
		}
		if _, err := q.ExecContext(ctx, `
			UPDATE book_instruments SET instrument_id = ?
			WHERE instrument_id = ? AND book_id NOT IN (
				SELECT book_id FROM book_instruments WHERE instrument_id = ?
			)`, *mergeIntoID, instrumentID, *mergeIntoID,
		); err != nil {
			return err
		}
	}
	_, err := q.ExecContext(ctx, `DELETE FROM instruments WHERE id = ?`, instrumentID)
	return err
}
