package db

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/pressly/goose/v3"
)

// TestMigrationPreservesRelationalData guards against a real incident: a
// migration that rebuilds a table (CREATE ..._new / copy / DROP / RENAME — needed
// whenever SQLite can't ALTER a UNIQUE constraint or DROP a
// CHECK-constrained column in place) while the foreign_keys pragma is on
// silently cascade-deletes every row in every OTHER table that references
// the dropped table via ON DELETE CASCADE — even though DROP TABLE is
// schema DDL, not an application DELETE. Migration 00025's own
// DROP TABLE pieces / DROP TABLE user_tags did exactly this against the
// real dev library (piece_composers/piece_arrangers/piece_keys/
// piece_instruments/piece_user_tags/piece_favorites/piece_practice_status/
// piece_user_notes all wiped to zero) before it was caught.
//
// Every other test in this codebase (internal/repo's newTestDB) migrates a
// brand-new, empty database — which never exercises this bug, since there's
// no pre-existing relational data to lose. This test instead seeds real
// rows at schema version 24 (the last version before migration 00025) and
// migrates the rest of the way forward, asserting every FK-child table's
// row count survives intact (or is deliberately, correctly transformed —
// e.g. 00025's own favorite/practice_status/user_notes backfill — never
// just zeroed). A future migration that rebuilds a shared table (pieces,
// books, people, user_tags, instruments, musical_keys, ...) without the
// PRAGMA foreign_keys = OFF / ON bracket documented in 00025's own header
// comment should fail this test.
func TestMigrationPreservesRelationalData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.sqlite")
	dsn := fmt.Sprintf(
		"file:%s?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)",
		path,
	)
	conn, err := sql.Open("sqlite", dsn)
	if err != nil {
		t.Fatalf("opening database: %v", err)
	}
	defer conn.Close()
	conn.SetMaxOpenConns(1)

	goose.SetBaseFS(migrationsFS)
	if err := goose.SetDialect("sqlite3"); err != nil {
		t.Fatalf("setting goose dialect: %v", err)
	}
	if err := goose.UpTo(conn, "migrations", 24); err != nil {
		t.Fatalf("migrating to v24: %v", err)
	}

	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := conn.Exec(query, args...); err != nil {
			t.Fatalf("seeding %q: %v", query, err)
		}
	}
	execID := func(query string, args ...any) int64 {
		t.Helper()
		res, err := conn.Exec(query, args...)
		if err != nil {
			t.Fatalf("seeding %q: %v", query, err)
		}
		id, err := res.LastInsertId()
		if err != nil {
			t.Fatalf("getting last insert id for %q: %v", query, err)
		}
		return id
	}

	// A single piece and book, each carrying one row in every table that
	// references it via ON DELETE CASCADE — the exact shape that migration
	// 00025's DROP TABLE pieces / DROP TABLE user_tags wiped.
	exec(`INSERT INTO pieces (id, title, favorite, practice_status, user_notes, file_path, file_hash)
		VALUES (1, 'Test Piece', 1, 'Learning', 'some notes', '/data/pieces/x.pdf', 'piece-hash-1')`)
	exec(`INSERT INTO people (id, name) VALUES (1, 'Test Person')`)
	exec(`INSERT INTO piece_composers (piece_id, person_id, position) VALUES (1, 1, 0)`)
	exec(`INSERT INTO piece_arrangers (piece_id, person_id, position) VALUES (1, 1, 0)`)
	exec(`INSERT INTO piece_keys (piece_id, key_id, position) VALUES (1, 1, 0)`) // key_id=1 seeded by migration 00001
	exec(`INSERT INTO instruments (id, name) VALUES (1, 'Test Instrument')`)
	exec(`INSERT INTO piece_instruments (piece_id, instrument_id) VALUES (1, 1)`)
	tagID := execID(`INSERT INTO user_tags (name) VALUES ('Test Tag')`) // migration 00009 pre-seeds starter tags, so id can't be hardcoded
	exec(`INSERT INTO piece_user_tags (piece_id, tag_id) VALUES (1, ?)`, tagID)

	exec(`INSERT INTO books (id, book_title, original_filename, file_path, file_hash)
		VALUES (1, 'Test Book', 'book.pdf', '/data/books/book.pdf', 'book-hash-1')`)
	exec(`INSERT INTO book_composers (book_id, person_id, position) VALUES (1, 1, 0)`)
	exec(`INSERT INTO book_instruments (book_id, instrument_id) VALUES (1, 1)`)

	if err := goose.Up(conn, "migrations"); err != nil {
		t.Fatalf("migrating to latest: %v", err)
	}

	count := func(table string) int {
		t.Helper()
		var n int
		if err := conn.QueryRow("SELECT count(*) FROM " + table).Scan(&n); err != nil {
			t.Fatalf("counting %s: %v", table, err)
		}
		return n
	}

	// Every row seeded above must still exist after migrating forward.
	// piece_favorites/piece_practice_status/piece_user_notes didn't exist
	// at v24 — they're migration 00025's own backfill destination for the
	// favorite/practice_status/user_notes values seeded on the piece row
	// above, so 1 is the correct post-migration count for those too, not
	// just a "did it survive" check.
	checks := map[string]int{
		"piece_composers":       1,
		"piece_arrangers":       1,
		"piece_keys":            1,
		"piece_instruments":     1,
		"piece_user_tags":       1,
		"piece_favorites":       1,
		"piece_practice_status": 1,
		"piece_user_notes":      1,
		"book_composers":        1,
		"book_instruments":      1,
	}
	for table, want := range checks {
		if got := count(table); got != want {
			t.Errorf("%s: got %d rows after migrating forward from a seeded v24 database, want %d — a migration silently dropped relational data (see this test's own doc comment)", table, got, want)
		}
	}

	rows, err := conn.Query("PRAGMA foreign_key_check")
	if err != nil {
		t.Fatalf("running foreign_key_check: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var table, fkidTable sql.NullString
		var rowid, fkid sql.NullInt64
		if err := rows.Scan(&table, &rowid, &fkidTable, &fkid); err != nil {
			t.Fatalf("scanning foreign_key_check violation: %v", err)
		}
		t.Errorf("foreign_key_check violation: table=%v rowid=%v references=%v fkid=%v — migrating left a dangling reference", table, rowid, fkidTable, fkid)
	}
}
