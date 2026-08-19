package repo_test

import (
	"context"
	"testing"

	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

func TestResolveEffective_InheritsFromBook(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	bookID, err := repo.CreateBook(ctx, dbConn, &models.Book{
		BookTitle:        "Complete Organ Symphonies",
		Composer:         strPtr("Charles-Marie Widor"),
		OriginalFilename: strPtr("widor.pdf"),
		FilePath:         strPtr("/data/library/books/abc.pdf"),
		FileHash:         strPtr("abc"),
	})
	if err != nil {
		t.Fatalf("CreateBook: %v", err)
	}

	pieceID, err := repo.CreatePiece(ctx, dbConn, &models.Piece{
		Title:        "Toccata",
		SourceBookID: &bookID,
		FilePath:     "/data/library/pieces/def.pdf",
		FileHash:     "def",
	})
	if err != nil {
		t.Fatalf("CreatePiece: %v", err)
	}

	piece, err := repo.GetPieceByID(ctx, dbConn, pieceID)
	if err != nil {
		t.Fatalf("GetPieceByID: %v", err)
	}

	eff, err := repo.ResolveEffective(ctx, dbConn, piece)
	if err != nil {
		t.Fatalf("ResolveEffective: %v", err)
	}

	if eff.Composer.Value != "Charles-Marie Widor" {
		t.Errorf("Composer.Value = %q, want %q", eff.Composer.Value, "Charles-Marie Widor")
	}
	if !eff.Composer.Inherited {
		t.Errorf("Composer.Inherited = false, want true (piece has no composer of its own)")
	}
}

func TestResolveEffective_PieceOwnValueWins(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	bookID, err := repo.CreateBook(ctx, dbConn, &models.Book{
		BookTitle:        "Anthology",
		Composer:         strPtr("Book Composer"),
		OriginalFilename: strPtr("anthology.pdf"),
		FilePath:         strPtr("/data/library/books/abc.pdf"),
		FileHash:         strPtr("abc2"),
	})
	if err != nil {
		t.Fatalf("CreateBook: %v", err)
	}

	pieceID, err := repo.CreatePiece(ctx, dbConn, &models.Piece{
		Title:        "Movement I",
		Composer:     strPtr("Piece Composer"),
		SourceBookID: &bookID,
		FilePath:     "/data/library/pieces/def2.pdf",
		FileHash:     "def2",
	})
	if err != nil {
		t.Fatalf("CreatePiece: %v", err)
	}

	piece, err := repo.GetPieceByID(ctx, dbConn, pieceID)
	if err != nil {
		t.Fatalf("GetPieceByID: %v", err)
	}

	eff, err := repo.ResolveEffective(ctx, dbConn, piece)
	if err != nil {
		t.Fatalf("ResolveEffective: %v", err)
	}

	if eff.Composer.Value != "Piece Composer" {
		t.Errorf("Composer.Value = %q, want %q", eff.Composer.Value, "Piece Composer")
	}
	if eff.Composer.Inherited {
		t.Errorf("Composer.Inherited = true, want false (piece has its own composer)")
	}
}

func TestResolveEffective_NoBook(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	pieceID, err := repo.CreatePiece(ctx, dbConn, &models.Piece{
		Title:    "Standalone Piece",
		FilePath: "/data/library/pieces/ghi.pdf",
		FileHash: "ghi",
	})
	if err != nil {
		t.Fatalf("CreatePiece: %v", err)
	}

	piece, err := repo.GetPieceByID(ctx, dbConn, pieceID)
	if err != nil {
		t.Fatalf("GetPieceByID: %v", err)
	}

	eff, err := repo.ResolveEffective(ctx, dbConn, piece)
	if err != nil {
		t.Fatalf("ResolveEffective: %v", err)
	}

	if eff.Composer.Value != "" || eff.Composer.Inherited {
		t.Errorf("Composer = %+v, want zero value (no book to inherit from)", eff.Composer)
	}
}

// TestResolveEffective_WhitespaceOnlyPieceValueFallsBackToBook is a
// regression test for a real bug a code review caught: a whitespace-only
// piece value (e.g. composer=" ") used to be treated as "set", masking the
// book's real value instead of falling back to it — inconsistent with how
// Title and tag names are already required to be non-blank after trimming.
func TestResolveEffective_WhitespaceOnlyPieceValueFallsBackToBook(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	bookID, err := repo.CreateBook(ctx, dbConn, &models.Book{
		BookTitle:        "Anthology",
		Composer:         strPtr("Book Composer"),
		OriginalFilename: strPtr("anthology.pdf"),
		FilePath:         strPtr("/data/library/books/whitespace.pdf"),
		FileHash:         strPtr("whitespace-hash"),
	})
	if err != nil {
		t.Fatalf("CreateBook: %v", err)
	}

	pieceID, err := repo.CreatePiece(ctx, dbConn, &models.Piece{
		Title:        "Movement",
		Composer:     strPtr("   "), // whitespace-only, not truly empty
		SourceBookID: &bookID,
		FilePath:     "/data/library/pieces/whitespace.pdf",
		FileHash:     "whitespace-piece-hash",
	})
	if err != nil {
		t.Fatalf("CreatePiece: %v", err)
	}

	piece, err := repo.GetPieceByID(ctx, dbConn, pieceID)
	if err != nil {
		t.Fatalf("GetPieceByID: %v", err)
	}

	eff, err := repo.ResolveEffective(ctx, dbConn, piece)
	if err != nil {
		t.Fatalf("ResolveEffective: %v", err)
	}

	if eff.Composer.Value != "Book Composer" || !eff.Composer.Inherited {
		t.Errorf("Composer = %+v, want it to fall back to the book (whitespace-only piece value isn't really set)", eff.Composer)
	}
}

func TestResolveEffective_InstrumentsFallBackAsWholeSet(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	violin, err := repo.FindOrCreateInstrument(ctx, dbConn, "Violin")
	if err != nil {
		t.Fatalf("FindOrCreateInstrument: %v", err)
	}
	viola, err := repo.FindOrCreateInstrument(ctx, dbConn, "Viola")
	if err != nil {
		t.Fatalf("FindOrCreateInstrument: %v", err)
	}

	bookID, err := repo.CreateBook(ctx, dbConn, &models.Book{
		BookTitle:        "Chamber Works",
		OriginalFilename: strPtr("chamber.pdf"),
		FilePath:         strPtr("/data/library/books/chamber.pdf"),
		FileHash:         strPtr("chamber-hash"),
	})
	if err != nil {
		t.Fatalf("CreateBook: %v", err)
	}
	if err := repo.SetBookInstruments(ctx, dbConn, bookID, []int64{violin, viola}); err != nil {
		t.Fatalf("SetBookInstruments: %v", err)
	}

	pieceID, err := repo.CreatePiece(ctx, dbConn, &models.Piece{
		Title:        "Duo",
		SourceBookID: &bookID,
		FilePath:     "/data/library/pieces/duo.pdf",
		FileHash:     "duo-hash",
	})
	if err != nil {
		t.Fatalf("CreatePiece: %v", err)
	}

	piece, err := repo.GetPieceByID(ctx, dbConn, pieceID)
	if err != nil {
		t.Fatalf("GetPieceByID: %v", err)
	}

	eff, err := repo.ResolveEffective(ctx, dbConn, piece)
	if err != nil {
		t.Fatalf("ResolveEffective: %v", err)
	}

	if len(eff.InstrumentIDs.IDs) != 2 || !eff.InstrumentIDs.Inherited {
		t.Errorf("InstrumentIDs = %+v, want both book instruments inherited", eff.InstrumentIDs)
	}
}
