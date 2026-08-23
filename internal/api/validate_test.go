package api_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/db"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
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
		OriginalFilename: strPtr("anthology.pdf"),
		FilePath:         strPtr("/data/library/books/anthology.pdf"),
		FileHash:         strPtr("anthology-hash"),
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

// TestValidatePiece_ArrangerAloneSatisfiesRequirement covers the
// composer-OR-arranger rule: a piece crediting only an arranger — a
// traditional/folk tune with no named composer, for instance — is
// legitimate, not missing data.
func TestValidatePiece_ArrangerAloneSatisfiesRequirement(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	errs, err := api.ValidatePiece(ctx, dbConn, &models.Piece{
		Title:    "Traditional Tune",
		Arranger: strPtr("J. Someone"),
	})
	if err != nil {
		t.Fatalf("ValidatePiece: %v", err)
	}
	if hasField(errs, "composer") {
		t.Errorf("errs = %v, want no composer error (arranger alone satisfies the requirement)", errs)
	}
}

// TestValidatePiece_InheritedArrangerSatisfiesRequirement covers the same
// rule via book inheritance, mirroring
// TestValidatePiece_ComposerRequiredButInheritedSatisfiesIt.
func TestValidatePiece_InheritedArrangerSatisfiesRequirement(t *testing.T) {
	ctx := context.Background()
	dbConn := newTestDB(t)

	bookID, err := repo.CreateBook(ctx, dbConn, &models.Book{
		BookTitle:        "Anthology",
		Arranger:         strPtr("Book Arranger"),
		OriginalFilename: strPtr("anthology3.pdf"),
		FilePath:         strPtr("/data/library/books/anthology3.pdf"),
		FileHash:         strPtr("anthology3-hash"),
	})
	if err != nil {
		t.Fatalf("CreateBook: %v", err)
	}

	errs, err := api.ValidatePiece(ctx, dbConn, &models.Piece{
		Title:        "Movement I",
		SourceBookID: &bookID,
	})
	if err != nil {
		t.Fatalf("ValidatePiece: %v", err)
	}
	if hasField(errs, "composer") {
		t.Errorf("errs = %v, want no composer error (book supplies an arranger)", errs)
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

func TestValidateBook_RequiresBookTitle(t *testing.T) {
	errs := api.ValidateBook(&models.Book{Composer: strPtr("Someone")})
	if !hasField(errs, "bookTitle") {
		t.Errorf("errs = %v, want a bookTitle error", errs)
	}
}

func TestValidateBook_ComposerOrArrangerOrPublisherRequired(t *testing.T) {
	errs := api.ValidateBook(&models.Book{BookTitle: "Just a Title"})
	if !hasField(errs, "composer") {
		t.Errorf("errs = %v, want a composer error (none of composer/arranger/publisher is set)", errs)
	}
}

func TestValidateBook_ComposerAloneSatisfiesRequirement(t *testing.T) {
	errs := api.ValidateBook(&models.Book{BookTitle: "Just a Title", Composer: strPtr("Someone")})
	if hasField(errs, "composer") {
		t.Errorf("errs = %v, want no composer error", errs)
	}
}

func TestValidateBook_ArrangerAloneSatisfiesRequirement(t *testing.T) {
	errs := api.ValidateBook(&models.Book{BookTitle: "Just a Title", Arranger: strPtr("Someone")})
	if hasField(errs, "composer") {
		t.Errorf("errs = %v, want no composer error (arranger alone satisfies the requirement)", errs)
	}
}

func TestValidateBook_PublisherAloneSatisfiesRequirement(t *testing.T) {
	errs := api.ValidateBook(&models.Book{BookTitle: "Just a Title", Publisher: strPtr("Someone Music Co.")})
	if hasField(errs, "composer") {
		t.Errorf("errs = %v, want no composer error (publisher alone satisfies the requirement)", errs)
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
