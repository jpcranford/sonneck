package export_test

import (
	"context"
	"encoding/csv"
	"os"
	"path/filepath"
	"testing"

	"github.com/jpcranford/sonneck/internal/db"
	"github.com/jpcranford/sonneck/internal/export"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

func readCSV(t *testing.T, path string) [][]string {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("opening %s: %v", path, err)
	}
	defer f.Close()
	records, err := csv.NewReader(f).ReadAll()
	if err != nil {
		t.Fatalf("reading %s as CSV: %v", path, err)
	}
	return records
}

func TestRunCSV_ExportsRealDataTablesWithSeededRows(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()

	conn, err := db.Open(filepath.Join(dir, "sonneck.sqlite"))
	if err != nil {
		t.Fatalf("opening database: %v", err)
	}
	defer conn.Close()

	if _, err := repo.CreatePiece(ctx, conn, &models.Piece{
		Title:    "Exported Piece",
		FilePath: "/data/library/pieces/x.pdf",
		FileHash: "x",
	}); err != nil {
		t.Fatalf("seeding piece: %v", err)
	}

	outDir, err := export.RunCSV(ctx, conn, filepath.Join(dir, "export"))
	if err != nil {
		t.Fatalf("RunCSV: %v", err)
	}

	records := readCSV(t, filepath.Join(outDir, "pieces.csv"))
	if len(records) != 2 {
		t.Fatalf("pieces.csv has %d records, want 2 (header + 1 row)", len(records))
	}
	header, row := records[0], records[1]

	colIndex := func(name string) int {
		for i, c := range header {
			if c == name {
				return i
			}
		}
		t.Fatalf("column %q not found in header %v", name, header)
		return -1
	}

	if got := row[colIndex("title")]; got != "Exported Piece" {
		t.Errorf("title = %q, want %q", got, "Exported Piece")
	}
	// composer was never set on the seeded piece — must round-trip as NULL,
	// which this export renders as an empty field, not the literal "<nil>"
	// fmt.Sprintf("%v", nil) would otherwise produce.
	if got := row[colIndex("composer")]; got != "" {
		t.Errorf("composer = %q, want empty (NULL)", got)
	}
}

func TestRunCSV_ExcludesInternalAndDerivedTables(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()

	conn, err := db.Open(filepath.Join(dir, "sonneck.sqlite"))
	if err != nil {
		t.Fatalf("opening database: %v", err)
	}
	defer conn.Close()

	outDir, err := export.RunCSV(ctx, conn, filepath.Join(dir, "export"))
	if err != nil {
		t.Fatalf("RunCSV: %v", err)
	}

	for _, excluded := range []string{
		"goose_db_version.csv",
		"sqlite_sequence.csv",
		"pieces_fts.csv",
		"pieces_fts_data.csv",
		"pieces_fts_idx.csv",
		"pieces_fts_content.csv",
		"pieces_fts_docsize.csv",
		"pieces_fts_config.csv",
		// pieces_fts_trigram (migration 00019) — a real gap this covers:
		// the exclusion list used to be hardcoded per table name, so
		// adding this second FTS5 table silently slipped six new "tables"
		// into the export until listTables started discovering FTS5
		// virtual tables (and their shadow tables) from sqlite_master
		// itself instead.
		"pieces_fts_trigram.csv",
		"pieces_fts_trigram_data.csv",
		"pieces_fts_trigram_idx.csv",
		"pieces_fts_trigram_content.csv",
		"pieces_fts_trigram_docsize.csv",
		"pieces_fts_trigram_config.csv",
	} {
		if _, err := os.Stat(filepath.Join(outDir, excluded)); !os.IsNotExist(err) {
			t.Errorf("%s was exported, want it excluded (internal/derived table)", excluded)
		}
	}

	// Real, always-present lookup tables (seeded by migrations) should
	// still be there even with no library data at all.
	for _, want := range []string{"books.csv", "pieces.csv", "musical_keys.csv", "sheet_types.csv"} {
		if _, err := os.Stat(filepath.Join(outDir, want)); err != nil {
			t.Errorf("%s missing from export: %v", want, err)
		}
	}
}

// Same trade-off backup.Run makes deliberately (CLAUDE.md-documented: "a
// second backup on the same UTC day... replaces the first rather than
// erroring") — a second export within the same clock-second lands in the
// same timestamped directory rather than failing. Not asserting
// distinctness here since that's not a guarantee RunCSV makes.
func TestRunCSV_CanRunRepeatedlyWithoutError(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()

	conn, err := db.Open(filepath.Join(dir, "sonneck.sqlite"))
	if err != nil {
		t.Fatalf("opening database: %v", err)
	}
	defer conn.Close()

	exportDir := filepath.Join(dir, "export")
	if _, err := export.RunCSV(ctx, conn, exportDir); err != nil {
		t.Fatalf("first RunCSV: %v", err)
	}
	if _, err := export.RunCSV(ctx, conn, exportDir); err != nil {
		t.Fatalf("second RunCSV: %v", err)
	}
}
