package repo_test

import (
	"context"
	"database/sql"
	"testing"

	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

func ftsMatchCount(t *testing.T, dbConn *sql.DB, term string) int {
	t.Helper()
	var count int
	if err := dbConn.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM pieces_fts WHERE pieces_fts MATCH ?`, term,
	).Scan(&count); err != nil {
		t.Fatalf("counting FTS matches for %q: %v", term, err)
	}
	return count
}

// TestSearchIndex_FindsInheritedComposer is the correctness test CLAUDE.md
// calls out: searching for a composer that only exists on the piece's
// source Book (never copied onto the Piece row) must still find the piece,
// or the search index would silently diverge from what's displayed.
func TestSearchIndex_FindsInheritedComposer(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	bookID, err := repo.CreateBook(ctx, dbConn, &models.Book{
		BookTitle:        "Six Symphonies",
		OriginalFilename: strPtr("widor.pdf"),
		FilePath:         strPtr("/data/library/books/widor.pdf"),
		FileHash:         strPtr("widor-hash"),
	})
	if err != nil {
		t.Fatalf("CreateBook: %v", err)
	}
	widor, err := repo.FindOrCreatePerson(ctx, dbConn, "Charles-Marie Widor")
	if err != nil {
		t.Fatalf("FindOrCreatePerson: %v", err)
	}
	if err := repo.SetBookComposers(ctx, dbConn, bookID, []int64{widor}); err != nil {
		t.Fatalf("SetBookComposers: %v", err)
	}

	pieceID, err := repo.CreatePiece(ctx, dbConn, &models.Piece{
		Title:        "Toccata",
		SourceBookID: &bookID,
		FilePath:     "/data/library/pieces/toccata.pdf",
		FileHash:     "toccata-hash",
	})
	if err != nil {
		t.Fatalf("CreatePiece: %v", err)
	}

	if err := repo.ResyncSearchIndex(ctx, dbConn, pieceID); err != nil {
		t.Fatalf("ResyncSearchIndex: %v", err)
	}

	if count := ftsMatchCount(t, dbConn, "Widor"); count != 1 {
		t.Errorf("FTS match count for inherited composer %q = %d, want 1", "Widor", count)
	}
}

// TestSearchIndex_BookEditFansOutToAllPieces verifies design doc §16's
// requirement: editing a Book field must resync every piece that inherits
// it, not just leave stale data in pieces_fts.
func TestSearchIndex_BookEditFansOutToAllPieces(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	bookID, err := repo.CreateBook(ctx, dbConn, &models.Book{
		BookTitle:        "Anthology",
		OriginalFilename: strPtr("anthology.pdf"),
		FilePath:         strPtr("/data/library/books/anthology.pdf"),
		FileHash:         strPtr("anthology-hash"),
	})
	if err != nil {
		t.Fatalf("CreateBook: %v", err)
	}
	originalComposer, err := repo.FindOrCreatePerson(ctx, dbConn, "Original Composer")
	if err != nil {
		t.Fatalf("FindOrCreatePerson: %v", err)
	}
	if err := repo.SetBookComposers(ctx, dbConn, bookID, []int64{originalComposer}); err != nil {
		t.Fatalf("SetBookComposers: %v", err)
	}

	var pieceIDs []int64
	for i := 0; i < 2; i++ {
		id, err := repo.CreatePiece(ctx, dbConn, &models.Piece{
			Title:        "Movement",
			SourceBookID: &bookID,
			FilePath:     "/data/library/pieces/movement.pdf",
			FileHash:     "movement-hash",
		})
		if err != nil {
			t.Fatalf("CreatePiece: %v", err)
		}
		if err := repo.ResyncSearchIndex(ctx, dbConn, id); err != nil {
			t.Fatalf("ResyncSearchIndex: %v", err)
		}
		pieceIDs = append(pieceIDs, id)
	}

	if count := ftsMatchCount(t, dbConn, "Original"); count != 2 {
		t.Fatalf("pre-edit FTS match count = %d, want 2", count)
	}

	renamedComposer, err := repo.FindOrCreatePerson(ctx, dbConn, "Renamed Composer")
	if err != nil {
		t.Fatalf("FindOrCreatePerson: %v", err)
	}
	if err := repo.SetBookComposers(ctx, dbConn, bookID, []int64{renamedComposer}); err != nil {
		t.Fatalf("SetBookComposers: %v", err)
	}
	if err := repo.ResyncSearchIndexForBook(ctx, dbConn, bookID); err != nil {
		t.Fatalf("ResyncSearchIndexForBook: %v", err)
	}

	if count := ftsMatchCount(t, dbConn, "Original"); count != 0 {
		t.Errorf("post-edit FTS match count for old composer = %d, want 0", count)
	}
	if count := ftsMatchCount(t, dbConn, "Renamed"); count != 2 {
		t.Errorf("post-edit FTS match count for new composer = %d, want 2 (both pieces)", count)
	}
}

// TestSearchIndex_ResyncAfterDeleteRemovesRow confirms the delete path:
// resyncing a piece ID that no longer exists just clears its FTS row,
// rather than erroring.
func TestSearchIndex_ResyncAfterDeleteRemovesRow(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	pieceID, err := repo.CreatePiece(ctx, dbConn, &models.Piece{
		Title:    "Ephemeral",
		FilePath: "/data/library/pieces/ephemeral.pdf",
		FileHash: "ephemeral-hash",
	})
	if err != nil {
		t.Fatalf("CreatePiece: %v", err)
	}
	if err := repo.ResyncSearchIndex(ctx, dbConn, pieceID); err != nil {
		t.Fatalf("ResyncSearchIndex: %v", err)
	}
	if count := ftsMatchCount(t, dbConn, "Ephemeral"); count != 1 {
		t.Fatalf("pre-delete FTS match count = %d, want 1", count)
	}

	if err := repo.DeletePiece(ctx, dbConn, pieceID); err != nil {
		t.Fatalf("DeletePiece: %v", err)
	}
	if err := repo.ResyncSearchIndex(ctx, dbConn, pieceID); err != nil {
		t.Fatalf("ResyncSearchIndex after delete: %v", err)
	}

	if count := ftsMatchCount(t, dbConn, "Ephemeral"); count != 0 {
		t.Errorf("post-delete FTS match count = %d, want 0", count)
	}
}
