package db

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/pressly/goose/v3"
)

// Migration 00036 clears saved marks wholly off the page: a stroke with no
// point on it, a text mark left of or right of it or more than a size below
// it. Marks that touch the page stay, in order; a page left empty goes.
func TestMigration00036AnnotationsOffPage(t *testing.T) {
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
	if err := goose.UpTo(conn, "migrations", 35); err != nil {
		t.Fatalf("migrating to v35: %v", err)
	}
	if _, err := conn.Exec(`PRAGMA foreign_keys = OFF`); err != nil {
		t.Fatal(err)
	}
	page1 := `[
		{"id":"on","kind":"stroke","tool":"pen","layer":0,"size":0.4,"points":[[0.5,0.5,0.5]],"pressure":false},
		{"id":"off","kind":"stroke","tool":"pen","layer":0,"size":0.4,"points":[[1.2,0.5,0.5],[1.3,0.5,0.5]],"pressure":false},
		{"id":"edge","kind":"stroke","tool":"pen","layer":0,"size":0.4,"points":[[-0.2,0.5,0.5],[0.1,0.5,0.5]],"pressure":false},
		{"id":"low","kind":"text","layer":2,"x":0.2,"y":1.01,"size":1.8,"text":"still shows"},
		{"id":"below","kind":"text","layer":2,"x":0.2,"y":1.3,"size":1.8,"text":"gone"},
		{"id":"left","kind":"text","layer":2,"x":-0.1,"y":0.5,"size":1.8,"text":"gone"}
	]`
	page2 := `[{"id":"off2","kind":"stroke","tool":"pen","layer":0,"size":0.4,"points":[[0.5,-0.3,0.5]],"pressure":false}]`
	for page, marks := range map[int]string{1: page1, 2: page2} {
		if _, err := conn.Exec(`INSERT INTO piece_annotations (user_id, piece_id, page, marks) VALUES (1, 1, ?, ?)`, page, marks); err != nil {
			t.Fatal(err)
		}
	}
	if err := goose.UpTo(conn, "migrations", 36); err != nil {
		t.Fatalf("migrating to v36: %v", err)
	}

	var ids string
	if err := conn.QueryRow(`SELECT group_concat(json_extract(m.value, '$.id'), ',')
		FROM piece_annotations a, json_each(a.marks) m WHERE a.page = 1`).Scan(&ids); err != nil {
		t.Fatal(err)
	}
	if ids != "on,edge,low" {
		t.Errorf("page 1 kept %q, want on,edge,low", ids)
	}
	var rows int
	if err := conn.QueryRow(`SELECT COUNT(*) FROM piece_annotations WHERE page = 2`).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Errorf("page 2 (only an off-page mark) still has a row")
	}
}
