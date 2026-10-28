package db

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/pressly/goose/v3"
)

// Migration 00034 turns a piece's notes-banner choice three-way: a stored
// "shown" stays shown, a stored "hidden" becomes "not chosen" (the same
// while the new default is off), and a row left holding only defaults goes.
func TestMigration00034NotesBar(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.sqlite")
	conn, err := sql.Open("sqlite", fmt.Sprintf("file:%s", path))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetMaxOpenConns(1)

	goose.SetBaseFS(migrationsFS)
	if err := goose.SetDialect("sqlite3"); err != nil {
		t.Fatal(err)
	}
	if err := goose.UpTo(conn, "migrations", 33); err != nil {
		t.Fatalf("migrating to v33: %v", err)
	}
	// Foreign keys off: the rows below stand alone, without pieces or users.
	if _, err := conn.Exec(`PRAGMA foreign_keys = OFF`); err != nil {
		t.Fatal(err)
	}
	for _, row := range []string{
		// Shown, otherwise defaults.
		`INSERT INTO piece_practice_settings (user_id, piece_id, notes_bar_shown) VALUES (1, 1, 1)`,
		// Brighter, banner never touched.
		`INSERT INTO piece_practice_settings (user_id, piece_id, brightness) VALUES (1, 2, 120)`,
		// Defaults only (a stored hidden banner with nothing else).
		`INSERT INTO piece_practice_settings (user_id, piece_id) VALUES (1, 3)`,
	} {
		if _, err := conn.Exec(row); err != nil {
			t.Fatalf("seeding %q: %v", row, err)
		}
	}
	if err := goose.UpTo(conn, "migrations", 34); err != nil {
		t.Fatalf("migrating to v34: %v", err)
	}

	got := map[int64]sql.NullInt64{}
	rows, err := conn.Query(`SELECT piece_id, notes_bar FROM piece_practice_settings`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var bar sql.NullInt64
		if err := rows.Scan(&id, &bar); err != nil {
			t.Fatal(err)
		}
		got[id] = bar
	}
	if bar, ok := got[1]; !ok || !bar.Valid || bar.Int64 != 1 {
		t.Errorf("piece 1 (shown): notes_bar = %v, present %v; want 1", bar, ok)
	}
	if bar, ok := got[2]; !ok || bar.Valid {
		t.Errorf("piece 2 (brighter, banner untouched): notes_bar = %v, present %v; want NULL", bar, ok)
	}
	if _, ok := got[3]; ok {
		t.Error("piece 3 (defaults only): row kept, want it removed")
	}
}
