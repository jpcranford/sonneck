package librarycheck_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/jpcranford/sonneck/internal/db"
	"github.com/jpcranford/sonneck/internal/librarycheck"
	"github.com/jpcranford/sonneck/internal/storage"
)

// Every kind of library file is checked, and only the missing ones are
// reported, in order: pieces, books, covers, portraits.
func TestCheck_ReportsOnlyMissingFiles(t *testing.T) {
	dataDir := t.TempDir()
	conn, err := db.Open(filepath.Join(dataDir, "test.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })

	present := func(path string) string {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		return path
	}
	here := present(filepath.Join(dataDir, "library", "pieces", "here.pdf"))
	gone := filepath.Join(dataDir, "library", "pieces", "gone.pdf")
	present(storage.CoverImagePath(dataDir, "coverhere"))
	present(storage.PortraitImagePath(dataDir, "portraithere"))

	for _, q := range []string{
		`INSERT INTO pieces (id, title, file_path, file_hash) VALUES (1, 'Present', '` + here + `', 'h1')`,
		`INSERT INTO pieces (id, title, file_path, file_hash) VALUES (2, 'Little Drop of Poison', '` + gone + `', 'h2')`,
		`INSERT INTO books (id, book_title, file_path, cover_image_hash) VALUES (1, 'Placeholder book', NULL, 'coverhere')`,
		`INSERT INTO books (id, book_title, file_path, cover_image_hash) VALUES (2, 'Songbook', '` + filepath.Join(dataDir, "library", "books", "gone.pdf") + `', 'covergone')`,
		`INSERT INTO people (id, name, portrait_image_hash) VALUES (1, 'Here', 'portraithere')`,
		`INSERT INTO people (id, name, portrait_image_hash) VALUES (2, 'Gone', 'portraitgone')`,
	} {
		if _, err := conn.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}

	missing, err := librarycheck.Check(context.Background(), conn, dataDir)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, m := range missing {
		got = append(got, m.Kind+" "+m.Name)
	}
	want := []string{"piece Little Drop of Poison", "book Songbook", "book cover Songbook", "portrait Gone"}
	if len(got) != len(want) {
		t.Fatalf("missing = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("missing[%d] = %q, want %q", i, got[i], want[i])
		}
	}
	if missing[0].Path != gone {
		t.Errorf("piece path = %q, want %q", missing[0].Path, gone)
	}
}
