package api_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jpcranford/picarda/internal/api"
	"github.com/jpcranford/picarda/internal/db"
	"github.com/jpcranford/picarda/internal/models"
	"github.com/jpcranford/picarda/internal/repo"
)

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
func intPtr(i int) *int       { return &i }

func hasField(errs api.ValidationErrors, field string) bool {
	for _, e := range errs {
		if e.Field == field {
			return true
		}
	}
	return false
}

func TestValidatePiece_RequiresTitle(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	errs, err := api.ValidatePiece(ctx, dbConn, &models.Piece{
		Title:    "",
		Composer: strPtr("Someone"),
	})
	if err != nil {
		t.Fatalf("ValidatePiece: %v", err)
	}
	if !hasField(errs, "title") {
		t.Errorf("errs = %v, want a title error for an empty title", errs)
	}
}

func TestValidatePiece_ComposerRequiredButInheritedSatisfiesIt(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	bookID, err := repo.CreateBook(ctx, dbConn, &models.Book{
		BookTitle:        "Anthology",
		Composer:         strPtr("Book Composer"),
		OriginalFilename: "anthology.pdf",
		FilePath:         "/data/library/books/anthology.pdf",
		FileHash:         "anthology-hash",
	})
	if err != nil {
		t.Fatalf("CreateBook: %v", err)
	}

	// No composer of its own, but it belongs to a book with one — this
	// must pass, per design doc §3/§5: "required" means the effective
	// value, not literally Piece.composer.
	errs, err := api.ValidatePiece(ctx, dbConn, &models.Piece{
		Title:        "Movement I",
		SourceBookID: &bookID,
	})
	if err != nil {
		t.Fatalf("ValidatePiece: %v", err)
	}
	if hasField(errs, "composer") {
		t.Errorf("errs = %v, want no composer error (book supplies it)", errs)
	}
}

func TestValidatePiece_ComposerMissingWithNoBook(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	errs, err := api.ValidatePiece(ctx, dbConn, &models.Piece{
		Title: "Standalone",
	})
	if err != nil {
		t.Fatalf("ValidatePiece: %v", err)
	}
	if !hasField(errs, "composer") {
		t.Errorf("errs = %v, want a composer error (no book to inherit from)", errs)
	}
}

func TestValidatePiece_LineLengthCap(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	tooLong := strings.Repeat("a", 256)
	errs, err := api.ValidatePiece(ctx, dbConn, &models.Piece{
		Title:    "Fine",
		Composer: &tooLong,
	})
	if err != nil {
		t.Fatalf("ValidatePiece: %v", err)
	}
	if !hasField(errs, "composer") {
		t.Errorf("errs = %v, want a composer length error for a 256-char value", errs)
	}
}

func TestValidatePiece_PracticeStatusMustBeKnownValue(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	bogus := "Vibing"
	errs, err := api.ValidatePiece(ctx, dbConn, &models.Piece{
		Title:          "Fine",
		Composer:       strPtr("Someone"),
		PracticeStatus: &bogus,
	})
	if err != nil {
		t.Fatalf("ValidatePiece: %v", err)
	}
	if !hasField(errs, "practiceStatus") {
		t.Errorf("errs = %v, want a practiceStatus error for an unrecognized value", errs)
	}
}

func TestValidatePiece_BPMMustBePositive(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	errs, err := api.ValidatePiece(ctx, dbConn, &models.Piece{
		Title:    "Fine",
		Composer: strPtr("Someone"),
		BPM:      intPtr(0),
	})
	if err != nil {
		t.Fatalf("ValidatePiece: %v", err)
	}
	if !hasField(errs, "bpm") {
		t.Errorf("errs = %v, want a bpm error for a non-positive value", errs)
	}
}

func TestValidateBook_OnlyBookTitleRequired(t *testing.T) {
	errs := api.ValidateBook(&models.Book{BookTitle: "Just a Title"})
	if len(errs) != 0 {
		t.Errorf("errs = %v, want none (design doc §16: no field required except bookTitle)", errs)
	}
}

func TestValidateBook_RequiresBookTitle(t *testing.T) {
	errs := api.ValidateBook(&models.Book{})
	if !hasField(errs, "bookTitle") {
		t.Errorf("errs = %v, want a bookTitle error", errs)
	}
}

func TestValidateTagName_RejectsEmptyAndTooLong(t *testing.T) {
	if err := api.ValidateTagName(""); err == nil {
		t.Error("ValidateTagName(\"\") = nil, want an error")
	}
	if err := api.ValidateTagName(strings.Repeat("a", 256)); err == nil {
		t.Error("ValidateTagName(256 chars) = nil, want an error")
	}
	if err := api.ValidateTagName("Violin"); err != nil {
		t.Errorf("ValidateTagName(\"Violin\") = %v, want nil", err)
	}
}
