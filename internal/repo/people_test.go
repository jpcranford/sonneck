package repo_test

import (
	"context"
	"testing"

	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

// TestPeopleByIDs_PreservesOrder is the regression test for the one
// genuine novelty over Instruments' own order-blind TagsByIDs: composer/
// arranger credit order is meaningful, so `WHERE id IN (...)`'s lack of
// argument-order guarantee has to be corrected in Go — mirrors
// TestKeysByIDs-style coverage this codebase already has for the
// identical KeysByIDs pattern.
func TestPeopleByIDs_PreservesOrder(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	// Created in reverse of the order we'll request them, so a naive
	// unordered SELECT would come back id-ascending (wrong order) rather
	// than matching the requested slice.
	zebra, err := repo.FindOrCreatePerson(ctx, dbConn, "Zebra Person")
	if err != nil {
		t.Fatalf("FindOrCreatePerson: %v", err)
	}
	apple, err := repo.FindOrCreatePerson(ctx, dbConn, "Apple Person")
	if err != nil {
		t.Fatalf("FindOrCreatePerson: %v", err)
	}

	got, err := repo.PeopleByIDs(ctx, dbConn, []int64{zebra, apple})
	if err != nil {
		t.Fatalf("PeopleByIDs: %v", err)
	}
	if len(got) != 2 || got[0].Name != "Zebra Person" || got[1].Name != "Apple Person" {
		t.Errorf("PeopleByIDs = %+v, want [Zebra Person, Apple Person] in that exact order", got)
	}
}

// TestFindOrCreatePerson_ReusesExistingByName mirrors the same guarantee
// FindOrCreateInstrument/Key/SheetType already have — a second call with
// the same name returns the same id, not a duplicate row.
func TestFindOrCreatePerson_ReusesExistingByName(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	first, err := repo.FindOrCreatePerson(ctx, dbConn, "Clara Schumann")
	if err != nil {
		t.Fatalf("FindOrCreatePerson: %v", err)
	}
	second, err := repo.FindOrCreatePerson(ctx, dbConn, "Clara Schumann")
	if err != nil {
		t.Fatalf("FindOrCreatePerson: %v", err)
	}
	if first != second {
		t.Errorf("FindOrCreatePerson called twice with the same name returned different ids: %d, %d", first, second)
	}
}

// TestSplitPerson_SplicesInReplacementsAtTheOriginalPosition covers Split
// People's own core contract: a piece crediting [A, target, B] becomes
// [A, replacement1, replacement2, B] — replacements land exactly where the
// split person was, not appended at the end — and the original person's
// own row survives with zero credits (not deleted).
func TestSplitPerson_SplicesInReplacementsAtTheOriginalPosition(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	before, err := repo.FindOrCreatePerson(ctx, dbConn, "Before")
	if err != nil {
		t.Fatalf("FindOrCreatePerson: %v", err)
	}
	target, err := repo.FindOrCreatePerson(ctx, dbConn, "Target")
	if err != nil {
		t.Fatalf("FindOrCreatePerson: %v", err)
	}
	after, err := repo.FindOrCreatePerson(ctx, dbConn, "After")
	if err != nil {
		t.Fatalf("FindOrCreatePerson: %v", err)
	}
	replacement1, err := repo.FindOrCreatePerson(ctx, dbConn, "Replacement 1")
	if err != nil {
		t.Fatalf("FindOrCreatePerson: %v", err)
	}
	replacement2, err := repo.FindOrCreatePerson(ctx, dbConn, "Replacement 2")
	if err != nil {
		t.Fatalf("FindOrCreatePerson: %v", err)
	}

	pieceID, err := repo.CreatePiece(ctx, dbConn, &models.Piece{
		Title:    "Collaboration",
		FilePath: "/data/library/pieces/collab.pdf",
		FileHash: "collab-hash",
	})
	if err != nil {
		t.Fatalf("CreatePiece: %v", err)
	}
	if err := repo.SetPieceComposers(ctx, dbConn, pieceID, []int64{before, target, after}); err != nil {
		t.Fatalf("SetPieceComposers: %v", err)
	}

	affected, err := repo.SplitPerson(ctx, dbConn, target, []int64{replacement1, replacement2})
	if err != nil {
		t.Fatalf("SplitPerson: %v", err)
	}
	if len(affected) != 1 || affected[0] != pieceID {
		t.Errorf("affected piece ids = %v, want exactly [%d]", affected, pieceID)
	}

	piece, err := repo.GetPieceByID(ctx, dbConn, pieceID)
	if err != nil {
		t.Fatalf("GetPieceByID: %v", err)
	}
	want := []int64{before, replacement1, replacement2, after}
	if len(piece.ComposerIDs) != len(want) {
		t.Fatalf("composer ids = %v, want %v", piece.ComposerIDs, want)
	}
	for i, id := range want {
		if piece.ComposerIDs[i] != id {
			t.Errorf("composer ids = %v, want %v (mismatch at index %d)", piece.ComposerIDs, want, i)
		}
	}

	// The original person's own row must still exist — Split People is
	// explicitly not a delete.
	stillExists, err := repo.GetPersonByID(ctx, dbConn, target)
	if err != nil {
		t.Fatalf("GetPersonByID after split: %v", err)
	}
	if stillExists.Name != "Target" {
		t.Errorf("split person's own row = %+v, want it to still exist unchanged", stillExists)
	}
	count, err := repo.CountPiecesForPerson(ctx, dbConn, target)
	if err != nil {
		t.Fatalf("CountPiecesForPerson: %v", err)
	}
	if count != 0 {
		t.Errorf("split person's own pieceCount = %d, want 0 (all credits reassigned)", count)
	}
}

// TestAffectedPieceIDsForPerson_IncludesPiecesInheritingFromABook covers
// the "before a destructive change, find every piece that could be
// affected" helper delete/split both rely on — a piece with no composer of
// its own that inherits from a book crediting the person must be included.
func TestAffectedPieceIDsForPerson_IncludesPiecesInheritingFromABook(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	bookID, err := repo.CreateBook(ctx, dbConn, &models.Book{
		BookTitle:        "Anthology",
		OriginalFilename: strPtr("anthology.pdf"),
		FilePath:         strPtr("/data/library/books/anthology.pdf"),
		FileHash:         strPtr("anthology-affected-hash"),
	})
	if err != nil {
		t.Fatalf("CreateBook: %v", err)
	}
	composer, err := repo.FindOrCreatePerson(ctx, dbConn, "Book Composer")
	if err != nil {
		t.Fatalf("FindOrCreatePerson: %v", err)
	}
	if err := repo.SetBookComposers(ctx, dbConn, bookID, []int64{composer}); err != nil {
		t.Fatalf("SetBookComposers: %v", err)
	}

	pieceID, err := repo.CreatePiece(ctx, dbConn, &models.Piece{
		Title:        "Inherits",
		SourceBookID: &bookID,
		FilePath:     "/data/library/pieces/inherits.pdf",
		FileHash:     "inherits-hash",
	})
	if err != nil {
		t.Fatalf("CreatePiece: %v", err)
	}

	affected, err := repo.AffectedPieceIDsForPerson(ctx, dbConn, composer)
	if err != nil {
		t.Fatalf("AffectedPieceIDsForPerson: %v", err)
	}
	if len(affected) != 1 || affected[0] != pieceID {
		t.Errorf("affected = %v, want exactly [%d] (the inheriting piece)", affected, pieceID)
	}
}
