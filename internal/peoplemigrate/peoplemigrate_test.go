package peoplemigrate_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/jpcranford/sonneck/internal/db"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/peoplemigrate"
	"github.com/jpcranford/sonneck/internal/repo"
)

// TestSplitNames covers the locked migration-plan wording verbatim (memory
// project_people_composer_overhaul.md): "split into individual Person rows
// by any combination of commas/'and'/ampersands (handling a trailing
// Oxford comma)". This is exactly the class of "silent, permanent
// correctness bug" risk CLAUDE.md's Testing section calls out for
// PDF-extraction — a wrong split here corrupts real historical data with
// no visible error.
func TestSplitNames(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want []string
	}{
		{"single name, no separator", "J. Burgmüller", []string{"J. Burgmüller"}},
		{"plain and", "John Smith and Jane Doe", []string{"John Smith", "Jane Doe"}},
		{"plain comma", "John Smith, Jane Doe", []string{"John Smith", "Jane Doe"}},
		{"oxford comma and", "John Smith, Jane Doe, and Bob Lee", []string{"John Smith", "Jane Doe", "Bob Lee"}},
		{"comma then bare and (no oxford comma)", "John Smith, Jane Doe and Bob Lee", []string{"John Smith", "Jane Doe", "Bob Lee"}},
		{"ampersand", "John Smith & Jane Doe", []string{"John Smith", "Jane Doe"}},
		{"ampersand no spaces", "John Smith&Jane Doe", []string{"John Smith", "Jane Doe"}},
		{"four names, oxford comma", "A, B, C, and D", []string{"A", "B", "C", "D"}},
		{"leading/trailing whitespace", "  John Smith  ", []string{"John Smith"}},
		{"empty string", "", nil},
		{"trailing comma with nothing after", "John Smith,", []string{"John Smith"}},
		// "and" inside a name is not a separator — no surrounding
		// whitespace-bounded "and" token, so this must not split.
		{"and embedded in a name is not split", "Anderson Consort", []string{"Anderson Consort"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := peoplemigrate.SplitNames(tc.raw)
			if len(got) == 0 && len(tc.want) == 0 {
				return
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("SplitNames(%q) = %v, want %v", tc.raw, got, tc.want)
			}
		})
	}
}

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "test.sqlite"))
	if err != nil {
		t.Fatalf("opening test database: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}

func strPtr(s string) *string { return &s }

// TestRun_SplitsAndBackfillsBothPiecesAndBooks is the end-to-end
// correctness test: real pieces/books with real legacy composer/arranger
// strings (single name, multi-name), migrated via the raw SQL columns
// (queryLegacyCredits reads directly off pieces.composer/arranger, which
// no longer exist on models.Piece/Book — so this test writes them via a
// direct SQL UPDATE, standing in for "data that predates this whole
// migration").
func TestRun_SplitsAndBackfillsBothPiecesAndBooks(t *testing.T) {
	ctx := context.Background()
	conn := newTestDB(t)

	bookID, err := repo.CreateBook(ctx, conn, &models.Book{
		BookTitle:        "Anthology",
		OriginalFilename: strPtr("anthology.pdf"),
		FilePath:         strPtr("/data/library/books/anthology.pdf"),
		FileHash:         strPtr("anthology-hash"),
	})
	if err != nil {
		t.Fatalf("CreateBook: %v", err)
	}
	if _, err := conn.ExecContext(ctx, `UPDATE books SET composer = ?, arranger = ? WHERE id = ?`,
		"Robert Schumann", "Theodor Kirchner", bookID); err != nil {
		t.Fatalf("seeding legacy book composer/arranger: %v", err)
	}

	pieceID, err := repo.CreatePiece(ctx, conn, &models.Piece{
		Title:    "Movement I",
		FilePath: "/data/library/pieces/movement.pdf",
		FileHash: "movement-hash",
	})
	if err != nil {
		t.Fatalf("CreatePiece: %v", err)
	}
	if _, err := conn.ExecContext(ctx, `UPDATE pieces SET composer = ? WHERE id = ?`,
		"Gilbert and Sullivan", pieceID); err != nil {
		t.Fatalf("seeding legacy piece composer: %v", err)
	}

	result, err := peoplemigrate.Run(ctx, conn)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if result.PiecesMigrated != 1 || result.BooksMigrated != 1 {
		t.Fatalf("result = %+v, want 1 piece and 1 book migrated", result)
	}

	book, err := repo.GetBookByID(ctx, conn, bookID)
	if err != nil {
		t.Fatalf("GetBookByID: %v", err)
	}
	if len(book.ComposerIDs) != 1 || len(book.ArrangerIDs) != 1 {
		t.Errorf("book credits = composers:%v arrangers:%v, want exactly one each", book.ComposerIDs, book.ArrangerIDs)
	}
	bookComposerNames, err := repo.PeopleByIDs(ctx, conn, book.ComposerIDs)
	if err != nil {
		t.Fatalf("PeopleByIDs: %v", err)
	}
	if len(bookComposerNames) != 1 || bookComposerNames[0].Name != "Robert Schumann" {
		t.Errorf("book composer = %+v, want [Robert Schumann]", bookComposerNames)
	}

	piece, err := repo.GetPieceByID(ctx, conn, pieceID)
	if err != nil {
		t.Fatalf("GetPieceByID: %v", err)
	}
	if len(piece.ComposerIDs) != 2 {
		t.Fatalf("piece composer count = %d, want 2 (Gilbert and Sullivan split into two people)", len(piece.ComposerIDs))
	}
	pieceComposerNames, err := repo.PeopleByIDs(ctx, conn, piece.ComposerIDs)
	if err != nil {
		t.Fatalf("PeopleByIDs: %v", err)
	}
	if pieceComposerNames[0].Name != "Gilbert" || pieceComposerNames[1].Name != "Sullivan" {
		t.Errorf("piece composers = %+v, want [Gilbert, Sullivan] in that order", pieceComposerNames)
	}

	// Re-running must be a no-op — both rows already have real credits now,
	// so Pending reports nothing left to do and Run short-circuits before
	// even scanning, returning a zero Result rather than counting either
	// row as "skipped".
	second, err := peoplemigrate.Run(ctx, conn)
	if err != nil {
		t.Fatalf("second Run: %v", err)
	}
	if second != (peoplemigrate.Result{}) {
		t.Errorf("second run result = %+v, want a zero Result (short-circuited, nothing pending)", second)
	}
}

// TestRun_SkipsAlreadyMigratedRows confirms the idempotency guard directly:
// a piece already carrying a real composer credit (set through the normal
// repo API, not the legacy column) must not be touched, even if its legacy
// column also happens to hold different data. Pending's own "already has a
// credit" check treats this piece as not-pending, so Run short-circuits
// before ever inspecting it — the strongest form of "left untouched".
func TestRun_SkipsAlreadyMigratedRows(t *testing.T) {
	ctx := context.Background()
	conn := newTestDB(t)

	pieceID, err := repo.CreatePiece(ctx, conn, &models.Piece{
		Title:    "Already Migrated",
		FilePath: "/data/library/pieces/already.pdf",
		FileHash: "already-hash",
	})
	if err != nil {
		t.Fatalf("CreatePiece: %v", err)
	}
	realComposer, err := repo.FindOrCreatePerson(ctx, conn, "Real Composer")
	if err != nil {
		t.Fatalf("FindOrCreatePerson: %v", err)
	}
	if err := repo.SetPieceComposers(ctx, conn, pieceID, []int64{realComposer}); err != nil {
		t.Fatalf("SetPieceComposers: %v", err)
	}
	// Stale legacy value that must be ignored, not merged in.
	if _, err := conn.ExecContext(ctx, `UPDATE pieces SET composer = ? WHERE id = ?`, "Stale Legacy Name", pieceID); err != nil {
		t.Fatalf("seeding stale legacy composer: %v", err)
	}

	result, err := peoplemigrate.Run(ctx, conn)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if result != (peoplemigrate.Result{}) {
		t.Errorf("result = %+v, want a zero Result (Pending correctly reports nothing to do)", result)
	}

	piece, err := repo.GetPieceByID(ctx, conn, pieceID)
	if err != nil {
		t.Fatalf("GetPieceByID: %v", err)
	}
	if len(piece.ComposerIDs) != 1 || piece.ComposerIDs[0] != realComposer {
		t.Errorf("composer ids = %v, want unchanged [%d] (stale legacy value must not be merged in)", piece.ComposerIDs, realComposer)
	}
}

// TestPending covers every case Run's automatic-startup short-circuit
// actually depends on: an empty library and a library with only blank
// legacy strings must both report false (nothing to scan for), a real
// unmigrated legacy string must report true, and a row that already has a
// real credit must report false even while its legacy TEXT column still
// holds a different, stale value — Pending's "already migrated" condition
// has to agree with Run's own per-row skip condition, or the two would
// disagree about whether a row needs work.
func TestPending(t *testing.T) {
	ctx := context.Background()

	t.Run("empty library", func(t *testing.T) {
		conn := newTestDB(t)
		pending, err := peoplemigrate.Pending(ctx, conn)
		if err != nil {
			t.Fatalf("Pending: %v", err)
		}
		if pending {
			t.Error("Pending = true, want false for an empty library")
		}
	})

	t.Run("blank legacy strings", func(t *testing.T) {
		conn := newTestDB(t)
		if _, err := repo.CreatePiece(ctx, conn, &models.Piece{
			Title:    "No Composer Yet",
			FilePath: "/data/library/pieces/blank.pdf",
			FileHash: "blank-hash",
		}); err != nil {
			t.Fatalf("CreatePiece: %v", err)
		}
		pending, err := peoplemigrate.Pending(ctx, conn)
		if err != nil {
			t.Fatalf("Pending: %v", err)
		}
		if pending {
			t.Error("Pending = true, want false when composer/arranger are both blank")
		}
	})

	t.Run("real unmigrated legacy string", func(t *testing.T) {
		conn := newTestDB(t)
		pieceID, err := repo.CreatePiece(ctx, conn, &models.Piece{
			Title:    "Needs Migrating",
			FilePath: "/data/library/pieces/needs.pdf",
			FileHash: "needs-hash",
		})
		if err != nil {
			t.Fatalf("CreatePiece: %v", err)
		}
		if _, err := conn.ExecContext(ctx, `UPDATE pieces SET composer = ? WHERE id = ?`, "Someone", pieceID); err != nil {
			t.Fatalf("seeding legacy composer: %v", err)
		}
		pending, err := peoplemigrate.Pending(ctx, conn)
		if err != nil {
			t.Fatalf("Pending: %v", err)
		}
		if !pending {
			t.Error("Pending = false, want true when a piece has a legacy composer string and no join-table credit yet")
		}
	})

	t.Run("already migrated, stale legacy string left behind", func(t *testing.T) {
		conn := newTestDB(t)
		pieceID, err := repo.CreatePiece(ctx, conn, &models.Piece{
			Title:    "Already Migrated",
			FilePath: "/data/library/pieces/already-pending.pdf",
			FileHash: "already-pending-hash",
		})
		if err != nil {
			t.Fatalf("CreatePiece: %v", err)
		}
		personID, err := repo.FindOrCreatePerson(ctx, conn, "Real Composer")
		if err != nil {
			t.Fatalf("FindOrCreatePerson: %v", err)
		}
		if err := repo.SetPieceComposers(ctx, conn, pieceID, []int64{personID}); err != nil {
			t.Fatalf("SetPieceComposers: %v", err)
		}
		if _, err := conn.ExecContext(ctx, `UPDATE pieces SET composer = ? WHERE id = ?`, "Stale Legacy Name", pieceID); err != nil {
			t.Fatalf("seeding stale legacy composer: %v", err)
		}
		pending, err := peoplemigrate.Pending(ctx, conn)
		if err != nil {
			t.Fatalf("Pending: %v", err)
		}
		if pending {
			t.Error("Pending = true, want false — the piece already has a real credit, so its stale legacy TEXT must not count as pending work")
		}
	})
}
