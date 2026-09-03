package repo_test

import (
	"context"
	"database/sql"
	"testing"

	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

func TestResolveEffective_InheritsFromBook(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	bookID, err := repo.CreateBook(ctx, dbConn, &models.Book{
		BookTitle:        "Complete Organ Symphonies",
		OriginalFilename: strPtr("widor.pdf"),
		FilePath:         strPtr("/data/library/books/abc.pdf"),
		FileHash:         strPtr("abc"),
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

	if len(eff.Composer.IDs) != 1 || eff.Composer.IDs[0] != widor {
		t.Errorf("Composer.IDs = %v, want [%d]", eff.Composer.IDs, widor)
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
		OriginalFilename: strPtr("anthology.pdf"),
		FilePath:         strPtr("/data/library/books/abc.pdf"),
		FileHash:         strPtr("abc2"),
	})
	if err != nil {
		t.Fatalf("CreateBook: %v", err)
	}
	bookComposer, err := repo.FindOrCreatePerson(ctx, dbConn, "Book Composer")
	if err != nil {
		t.Fatalf("FindOrCreatePerson: %v", err)
	}
	if err := repo.SetBookComposers(ctx, dbConn, bookID, []int64{bookComposer}); err != nil {
		t.Fatalf("SetBookComposers: %v", err)
	}

	pieceID, err := repo.CreatePiece(ctx, dbConn, &models.Piece{
		Title:        "Movement I",
		SourceBookID: &bookID,
		FilePath:     "/data/library/pieces/def2.pdf",
		FileHash:     "def2",
	})
	if err != nil {
		t.Fatalf("CreatePiece: %v", err)
	}
	pieceComposer, err := repo.FindOrCreatePerson(ctx, dbConn, "Piece Composer")
	if err != nil {
		t.Fatalf("FindOrCreatePerson: %v", err)
	}
	if err := repo.SetPieceComposers(ctx, dbConn, pieceID, []int64{pieceComposer}); err != nil {
		t.Fatalf("SetPieceComposers: %v", err)
	}

	piece, err := repo.GetPieceByID(ctx, dbConn, pieceID)
	if err != nil {
		t.Fatalf("GetPieceByID: %v", err)
	}

	eff, err := repo.ResolveEffective(ctx, dbConn, piece)
	if err != nil {
		t.Fatalf("ResolveEffective: %v", err)
	}

	if len(eff.Composer.IDs) != 1 || eff.Composer.IDs[0] != pieceComposer {
		t.Errorf("Composer.IDs = %v, want [%d] (piece's own, not the book's)", eff.Composer.IDs, pieceComposer)
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

	if len(eff.Composer.IDs) != 0 || eff.Composer.Inherited {
		t.Errorf("Composer = %+v, want zero value (no book to inherit from)", eff.Composer)
	}
}

// TestResolveEffective_MultipleComposersPreserveOrder is a regression test
// for the composer/arranger overhaul's one genuine novelty over
// Instruments' own (order-blind) fallback: a piece's own ordered composer
// list must come back in the exact order it was set, not any DB-side
// order — ResolveEffective must not silently re-sort it.
func TestResolveEffective_MultipleComposersPreserveOrder(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	second, err := repo.FindOrCreatePerson(ctx, dbConn, "Second Composer")
	if err != nil {
		t.Fatalf("FindOrCreatePerson: %v", err)
	}
	first, err := repo.FindOrCreatePerson(ctx, dbConn, "First Composer")
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
	// Deliberately inserted in "first, second" order despite second's row
	// being created first (a lower id) — proves order comes from the
	// join table's own position column, not id order.
	if err := repo.SetPieceComposers(ctx, dbConn, pieceID, []int64{first, second}); err != nil {
		t.Fatalf("SetPieceComposers: %v", err)
	}

	piece, err := repo.GetPieceByID(ctx, dbConn, pieceID)
	if err != nil {
		t.Fatalf("GetPieceByID: %v", err)
	}

	eff, err := repo.ResolveEffective(ctx, dbConn, piece)
	if err != nil {
		t.Fatalf("ResolveEffective: %v", err)
	}

	if len(eff.Composer.IDs) != 2 || eff.Composer.IDs[0] != first || eff.Composer.IDs[1] != second {
		t.Errorf("Composer.IDs = %v, want [%d, %d] in that order", eff.Composer.IDs, first, second)
	}
}

// TestResolveEffective_ArrangerInheritsFromBook mirrors
// TestResolveEffective_InheritsFromBook for Arranger.
func TestResolveEffective_ArrangerInheritsFromBook(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	bookID, err := repo.CreateBook(ctx, dbConn, &models.Book{
		BookTitle:        "Anthology",
		OriginalFilename: strPtr("anthology.pdf"),
		FilePath:         strPtr("/data/library/books/arr.pdf"),
		FileHash:         strPtr("arr-hash"),
	})
	if err != nil {
		t.Fatalf("CreateBook: %v", err)
	}
	bookArranger, err := repo.FindOrCreatePerson(ctx, dbConn, "Book Arranger")
	if err != nil {
		t.Fatalf("FindOrCreatePerson: %v", err)
	}
	if err := repo.SetBookArrangers(ctx, dbConn, bookID, []int64{bookArranger}); err != nil {
		t.Fatalf("SetBookArrangers: %v", err)
	}

	pieceID, err := repo.CreatePiece(ctx, dbConn, &models.Piece{
		Title:        "Movement I",
		SourceBookID: &bookID,
		FilePath:     "/data/library/pieces/arr.pdf",
		FileHash:     "arr-piece-hash",
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

	if len(eff.Arranger.IDs) != 1 || eff.Arranger.IDs[0] != bookArranger {
		t.Errorf("Arranger.IDs = %v, want [%d]", eff.Arranger.IDs, bookArranger)
	}
	if !eff.Arranger.Inherited {
		t.Errorf("Arranger.Inherited = false, want true (piece has no arranger of its own)")
	}
}

// TestResolveEffective_ArrangerPieceOwnValueWins mirrors
// TestResolveEffective_PieceOwnValueWins for Arranger.
func TestResolveEffective_ArrangerPieceOwnValueWins(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	bookID, err := repo.CreateBook(ctx, dbConn, &models.Book{
		BookTitle:        "Anthology",
		OriginalFilename: strPtr("anthology2.pdf"),
		FilePath:         strPtr("/data/library/books/arr2.pdf"),
		FileHash:         strPtr("arr-hash-2"),
	})
	if err != nil {
		t.Fatalf("CreateBook: %v", err)
	}
	bookArranger, err := repo.FindOrCreatePerson(ctx, dbConn, "Book Arranger")
	if err != nil {
		t.Fatalf("FindOrCreatePerson: %v", err)
	}
	if err := repo.SetBookArrangers(ctx, dbConn, bookID, []int64{bookArranger}); err != nil {
		t.Fatalf("SetBookArrangers: %v", err)
	}

	pieceID, err := repo.CreatePiece(ctx, dbConn, &models.Piece{
		Title:        "Movement II",
		SourceBookID: &bookID,
		FilePath:     "/data/library/pieces/arr2.pdf",
		FileHash:     "arr-piece-hash-2",
	})
	if err != nil {
		t.Fatalf("CreatePiece: %v", err)
	}
	pieceArranger, err := repo.FindOrCreatePerson(ctx, dbConn, "Piece Arranger")
	if err != nil {
		t.Fatalf("FindOrCreatePerson: %v", err)
	}
	if err := repo.SetPieceArrangers(ctx, dbConn, pieceID, []int64{pieceArranger}); err != nil {
		t.Fatalf("SetPieceArrangers: %v", err)
	}

	piece, err := repo.GetPieceByID(ctx, dbConn, pieceID)
	if err != nil {
		t.Fatalf("GetPieceByID: %v", err)
	}

	eff, err := repo.ResolveEffective(ctx, dbConn, piece)
	if err != nil {
		t.Fatalf("ResolveEffective: %v", err)
	}

	if len(eff.Arranger.IDs) != 1 || eff.Arranger.IDs[0] != pieceArranger {
		t.Errorf("Arranger.IDs = %v, want [%d] (piece's own, not the book's)", eff.Arranger.IDs, pieceArranger)
	}
	if eff.Arranger.Inherited {
		t.Errorf("Arranger.Inherited = true, want false (piece has its own arranger)")
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

// TestResolveEffective_CopyrightYearForCalcFallbackChain covers
// CopyrightYearForCalc's own 4-level priority order (piece copyright year,
// book copyright year, book year published, piece year written) — a
// deliberate follow-up to the Public Domain Badge feature: a book/piece
// missing an explicit Copyright Year but carrying a Year Published (the
// common case for an imported book) should still get a real calculation
// instead of the calc's conservative "not likely PD" default.
func TestResolveEffective_CopyrightYearForCalcFallbackChain(t *testing.T) {
	ctx := context.Background()

	newPiece := func(t *testing.T, dbConn *sql.DB, bookID *int64, yearWritten *string, copyrightYear *int) *repo.EffectivePiece {
		t.Helper()
		pieceID, err := repo.CreatePiece(ctx, dbConn, &models.Piece{
			Title:         "Piece",
			SourceBookID:  bookID,
			FilePath:      "/data/library/pieces/" + t.Name() + ".pdf",
			FileHash:      t.Name(),
			YearWritten:   yearWritten,
			CopyrightYear: copyrightYear,
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
		return eff
	}

	newBook := func(t *testing.T, dbConn *sql.DB, yearPublished *string, copyrightYear *int) int64 {
		t.Helper()
		bookID, err := repo.CreateBook(ctx, dbConn, &models.Book{
			BookTitle:        "Book " + t.Name(),
			OriginalFilename: strPtr("book.pdf"),
			FilePath:         strPtr("/data/library/books/" + t.Name() + ".pdf"),
			FileHash:         strPtr(t.Name()),
			YearPublished:    yearPublished,
			CopyrightYear:    copyrightYear,
		})
		if err != nil {
			t.Fatalf("CreateBook: %v", err)
		}
		return bookID
	}

	t.Run("piece copyright year wins over everything", func(t *testing.T) {
		dbConn := newTestDB(t)
		bookID := newBook(t, dbConn, strPtr("1900"), intPtr(1950))
		eff := newPiece(t, dbConn, &bookID, strPtr("1980"), intPtr(1999))
		if eff.CopyrightYearForCalc == nil || *eff.CopyrightYearForCalc != 1999 {
			t.Errorf("CopyrightYearForCalc = %v, want 1999 (piece's own copyright year)", eff.CopyrightYearForCalc)
		}
	})

	t.Run("book copyright year wins when piece has none", func(t *testing.T) {
		dbConn := newTestDB(t)
		bookID := newBook(t, dbConn, strPtr("1900"), intPtr(1950))
		eff := newPiece(t, dbConn, &bookID, strPtr("1980"), nil)
		if eff.CopyrightYearForCalc == nil || *eff.CopyrightYearForCalc != 1950 {
			t.Errorf("CopyrightYearForCalc = %v, want 1950 (book's copyright year)", eff.CopyrightYearForCalc)
		}
	})

	t.Run("book year published wins when neither copyright year is set", func(t *testing.T) {
		dbConn := newTestDB(t)
		bookID := newBook(t, dbConn, strPtr("1900"), nil)
		eff := newPiece(t, dbConn, &bookID, strPtr("1980"), nil)
		if eff.CopyrightYearForCalc == nil || *eff.CopyrightYearForCalc != 1900 {
			t.Errorf("CopyrightYearForCalc = %v, want 1900 (book's year published, not the piece's own year written)", eff.CopyrightYearForCalc)
		}
	})

	t.Run("piece year written is the last resort", func(t *testing.T) {
		dbConn := newTestDB(t)
		bookID := newBook(t, dbConn, nil, nil)
		eff := newPiece(t, dbConn, &bookID, strPtr("1980"), nil)
		if eff.CopyrightYearForCalc == nil || *eff.CopyrightYearForCalc != 1980 {
			t.Errorf("CopyrightYearForCalc = %v, want 1980 (piece's own year written)", eff.CopyrightYearForCalc)
		}
	})

	t.Run("nothing usable on record resolves to nil", func(t *testing.T) {
		dbConn := newTestDB(t)
		bookID := newBook(t, dbConn, nil, nil)
		eff := newPiece(t, dbConn, &bookID, nil, nil)
		if eff.CopyrightYearForCalc != nil {
			t.Errorf("CopyrightYearForCalc = %v, want nil", eff.CopyrightYearForCalc)
		}
	})

	t.Run("free-text year that doesn't parse cleanly is skipped, not guessed", func(t *testing.T) {
		dbConn := newTestDB(t)
		bookID := newBook(t, dbConn, strPtr("c. 1900"), nil)
		eff := newPiece(t, dbConn, &bookID, strPtr("early 1980s"), nil)
		if eff.CopyrightYearForCalc != nil {
			t.Errorf("CopyrightYearForCalc = %v, want nil (neither free-text year parses as a clean integer)", eff.CopyrightYearForCalc)
		}
	})
}

// TestResolveEffective_CopyrightRenewedInheritance covers CopyrightRenewed's
// own book-inheritance resolution (US renewal follow-up) — same
// piece-wins-else-book-else-false shape every other EffectiveBoolField/
// EffectiveIntField uses, just confirming it for real given how much this
// specific field's semantics were debated (false must mean "not explicitly
// set" both when truly unset AND when explicitly set to false — a plain
// bool, not tri-state, by direct product decision).
func TestResolveEffective_CopyrightRenewedInheritance(t *testing.T) {
	ctx := context.Background()

	t.Run("piece's own true wins over book's false", func(t *testing.T) {
		dbConn := newTestDB(t)
		bookID, err := repo.CreateBook(ctx, dbConn, &models.Book{
			BookTitle:        "Book",
			OriginalFilename: strPtr("book.pdf"),
			FilePath:         strPtr("/data/library/books/renewed1.pdf"),
			FileHash:         strPtr("renewed1"),
			CopyrightRenewed: boolPtr(false),
		})
		if err != nil {
			t.Fatalf("CreateBook: %v", err)
		}
		pieceID, err := repo.CreatePiece(ctx, dbConn, &models.Piece{
			Title:            "Piece",
			SourceBookID:     &bookID,
			FilePath:         "/data/library/pieces/renewed1.pdf",
			FileHash:         "renewed1-piece",
			CopyrightRenewed: boolPtr(true),
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
		if !eff.CopyrightRenewed.Value || eff.CopyrightRenewed.Inherited {
			t.Errorf("CopyrightRenewed = %+v, want {Value: true, Inherited: false}", eff.CopyrightRenewed)
		}
	})

	t.Run("inherits book's true when piece has none", func(t *testing.T) {
		dbConn := newTestDB(t)
		bookID, err := repo.CreateBook(ctx, dbConn, &models.Book{
			BookTitle:        "Book",
			OriginalFilename: strPtr("book.pdf"),
			FilePath:         strPtr("/data/library/books/renewed2.pdf"),
			FileHash:         strPtr("renewed2"),
			CopyrightRenewed: boolPtr(true),
		})
		if err != nil {
			t.Fatalf("CreateBook: %v", err)
		}
		pieceID, err := repo.CreatePiece(ctx, dbConn, &models.Piece{
			Title:        "Piece",
			SourceBookID: &bookID,
			FilePath:     "/data/library/pieces/renewed2.pdf",
			FileHash:     "renewed2-piece",
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
		if !eff.CopyrightRenewed.Value || !eff.CopyrightRenewed.Inherited {
			t.Errorf("CopyrightRenewed = %+v, want {Value: true, Inherited: true}", eff.CopyrightRenewed)
		}
	})

	t.Run("neither set resolves to false, not inherited", func(t *testing.T) {
		dbConn := newTestDB(t)
		pieceID, err := repo.CreatePiece(ctx, dbConn, &models.Piece{
			Title:    "Standalone Piece",
			FilePath: "/data/library/pieces/renewed3.pdf",
			FileHash: "renewed3-piece",
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
		if eff.CopyrightRenewed.Value || eff.CopyrightRenewed.Inherited {
			t.Errorf("CopyrightRenewed = %+v, want {Value: false, Inherited: false}", eff.CopyrightRenewed)
		}
	})
}
