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
		Composer:         strPtr("Charles-Marie Widor"),
		OriginalFilename: strPtr("widor.pdf"),
		FilePath:         strPtr("/data/library/books/widor.pdf"),
		FileHash:         strPtr("widor-hash"),
	})
	if err != nil {
		t.Fatalf("CreateBook: %v", err)
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
		Composer:         strPtr("Original Composer"),
		OriginalFilename: strPtr("anthology.pdf"),
		FilePath:         strPtr("/data/library/books/anthology.pdf"),
		FileHash:         strPtr("anthology-hash"),
	})
	if err != nil {
		t.Fatalf("CreateBook: %v", err)
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

	book, err := repo.GetBookByID(ctx, dbConn, bookID)
	if err != nil {
		t.Fatalf("GetBookByID: %v", err)
	}
	book.Composer = strPtr("Renamed Composer")
	if err := repo.UpdateBook(ctx, dbConn, book); err != nil {
		t.Fatalf("UpdateBook: %v", err)
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
