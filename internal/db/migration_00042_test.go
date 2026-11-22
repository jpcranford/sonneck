package db

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/pressly/goose/v3"
)

// Migration 00042 rewrites Go's time.Time text (any zone, with or without a
// fraction or a monotonic reading) as UTC "YYYY-MM-DD HH:MM:SS", and the ISO
// status-change time as the same layout with its milliseconds; a value
// already in the standard format is left exactly as it was.
func TestMigration00042StandardTimestamps(t *testing.T) {
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
	if err := goose.UpTo(conn, "migrations", 41); err != nil {
		t.Fatalf("migrating to v41: %v", err)
	}
	if _, err := conn.Exec(`PRAGMA foreign_keys = OFF`); err != nil {
		t.Fatal(err)
	}

	pieces := []struct{ stored, want string }{
		{"2026-08-21 00:58:10.080045 +0000 UTC", "2026-08-21 00:58:10"},
		{"2026-09-03 19:09:10.5762 +0000 UTC", "2026-09-03 19:09:10"},
		{"2026-08-21 00:58:10 +0000 UTC", "2026-08-21 00:58:10"},
		// A local zone: 19:30 at -05:00 is 00:30 UTC the next day.
		{"2026-11-21 19:30:00.25 -0500 EST m=+12.000000001", "2026-11-22 00:30:00"},
		// A half-hour zone ahead of UTC.
		{"2026-11-22 05:45:00 +0530 IST", "2026-11-22 00:15:00"},
		// Already standard: untouched, a fraction included.
		{"2026-08-20 18:09:22", "2026-08-20 18:09:22"},
		{"2026-08-20 18:09:22.5", "2026-08-20 18:09:22.5"},
	}
	for i, p := range pieces {
		if _, err := conn.Exec(`INSERT INTO pieces (id, title, file_path, file_hash, updated_at) VALUES (?, ?, ?, ?, ?)`,
			i+1, fmt.Sprintf("p%d", i), fmt.Sprintf("p%d.pdf", i), fmt.Sprintf("h%d", i), p.stored); err != nil {
			t.Fatal(err)
		}
	}
	sessions := []struct{ token, stored, want string }{
		{"a", "2026-12-21 19:30:00.123456 -0500 EST m=+2592000.000000001", "2026-12-22 00:30:00"},
		{"b", "2026-12-22 08:00:00 +0000 UTC", "2026-12-22 08:00:00"},
		{"c", "2026-12-22 09:00:00", "2026-12-22 09:00:00"},
	}
	for _, s := range sessions {
		if _, err := conn.Exec(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, 1, ?)`, s.token, s.stored); err != nil {
			t.Fatal(err)
		}
	}
	statuses := []struct {
		piece  int
		stored any
		want   any
	}{
		{1, "2026-11-19T10:00:00.123Z", "2026-11-19 10:00:00.123"},
		{2, nil, nil},
		{3, "2026-11-19 10:00:00.456", "2026-11-19 10:00:00.456"},
	}
	for _, s := range statuses {
		if _, err := conn.Exec(`INSERT INTO piece_practice_status (user_id, piece_id, status_id, updated_at) VALUES (1, ?, 1, ?)`, s.piece, s.stored); err != nil {
			t.Fatal(err)
		}
	}

	if err := goose.UpTo(conn, "migrations", 42); err != nil {
		t.Fatalf("migrating to v42: %v", err)
	}

	// The driver turns a timestamp column it reads into a time and back, so
	// each read appends '' to see the stored text itself.
	for i, p := range pieces {
		var got string
		if err := conn.QueryRow(`SELECT updated_at || '' FROM pieces WHERE id = ?`, i+1).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != p.want {
			t.Errorf("piece updated_at %q → %q, want %q", p.stored, got, p.want)
		}
	}
	for _, s := range sessions {
		var got string
		if err := conn.QueryRow(`SELECT expires_at || '' FROM sessions WHERE token = ?`, s.token).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != s.want {
			t.Errorf("session expires_at %q → %q, want %q", s.stored, got, s.want)
		}
	}
	for _, s := range statuses {
		var got sql.NullString
		if err := conn.QueryRow(`SELECT updated_at || '' FROM piece_practice_status WHERE piece_id = ?`, s.piece).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if s.want == nil {
			if got.Valid {
				t.Errorf("status updated_at NULL → %q, want NULL", got.String)
			}
		} else if got.String != s.want {
			t.Errorf("status updated_at %v → %q, want %v", s.stored, got.String, s.want)
		}
	}
}
