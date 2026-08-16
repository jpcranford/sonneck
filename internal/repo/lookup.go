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
func ListKeys(ctx context.Context, q Queryer) ([]models.Key, error) {
	rows, err := q.QueryContext(ctx, `SELECT id, name FROM musical_keys ORDER BY id`)
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

func GetKeyByID(ctx context.Context, q Queryer, id int64) (*models.Key, error) {
	var k models.Key
	err := q.QueryRowContext(ctx, `SELECT id, name FROM musical_keys WHERE id = ?`, id).Scan(&k.ID, &k.Name)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &k, nil
}

func ListSheetTypes(ctx context.Context, q Queryer) ([]models.SheetType, error) {
	rows, err := q.QueryContext(ctx, `SELECT id, name FROM sheet_types ORDER BY id`)
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
