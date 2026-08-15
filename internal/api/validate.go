package api

import (
	"context"
	"fmt"
	"strings"

	"github.com/jpcranford/picarda/internal/models"
	"github.com/jpcranford/picarda/internal/repo"
)

// MaxLineLength is the 255-char cap shared by every line-text input,
// client- and server-side (design doc §5's "General rule"). Box/multi-line
// inputs (description, userNotes) are exempt.
const MaxLineLength = 255

var validPracticeStatuses = map[string]bool{
	models.PracticeStatusWantToLearn: true,
	models.PracticeStatusLearning:    true,
	models.PracticeStatusLearned:     true,
	models.PracticeStatusStalled:     true,
	models.PracticeStatusDropped:     true,
}

// FieldError is one field-level validation failure.
type FieldError struct {
	Field   string
	Message string
}

func (e FieldError) Error() string {
	return fmt.Sprintf("%s %s", e.Field, e.Message)
}

// ValidationErrors joins into the single human-readable message the API
// contract's error envelope carries (CLAUDE.md > API response contract has
// no room for a structured per-field list, just one message string).
type ValidationErrors []FieldError

func (v ValidationErrors) Error() string {
	parts := make([]string, len(v))
	for i, e := range v {
		parts[i] = e.Error()
	}
	return strings.Join(parts, "; ")
}

// ValidatePiece checks p against design doc §5's Field validation table.
// This is the one shared validation function CLAUDE.md requires be used
// everywhere a piece's fields are edited (the wizard's per-piece fill step
// and the standalone piece edit menu) rather than duplicated per handler.
//
// The composer check needs DB access: "required" means the *effective*
// value (piece's own, falling back to the book's) must be non-empty, so
// this calls repo.ResolveEffective — the same resolver display/citation/
// search use — rather than re-deriving that fallback logic here.
//
// The returned error is a real infrastructure failure (e.g. a DB error
// resolving the source book), distinct from the returned ValidationErrors,
// which represents rejected input.
func ValidatePiece(ctx context.Context, q repo.Queryer, p *models.Piece) (ValidationErrors, error) {
	var errs ValidationErrors

	if strings.TrimSpace(p.Title) == "" {
		errs = append(errs, FieldError{"title", "is required"})
	}
	checkLineLength(&errs, "title", &p.Title)

	eff, err := repo.ResolveEffective(ctx, q, p)
	if err != nil {
		return nil, err
	}
	if eff.Composer.Value == "" {
		errs = append(errs, FieldError{"composer", "is required (set directly, or via the piece's book)"})
	}
	// Only the piece's own typed value can be too long — an inherited
	// value was already validated when the Book itself was saved.
	checkLineLength(&errs, "composer", p.Composer)

	checkLineLength(&errs, "arranger", p.Arranger)
	checkLineLength(&errs, "workOpusNumber", p.WorkOpusNumber)
	checkLineLength(&errs, "publisher", p.Publisher)
	checkLineLength(&errs, "publisherId", p.PublisherID)
	checkLineLength(&errs, "yearWritten", p.YearWritten)
	checkLineLength(&errs, "imslpNumber", p.ImslpNumber)

	if p.PracticeStatus != nil && !validPracticeStatuses[*p.PracticeStatus] {
		errs = append(errs, FieldError{"practiceStatus", "must be one of: Want to Learn, Learning, Learned, Stalled, Dropped"})
	}

	checkPositiveInt(&errs, "bpm", p.BPM)
	checkPositiveInt(&errs, "measureCount", p.MeasureCount)
	checkPositiveInt(&errs, "beatsPerMeasure", p.BeatsPerMeasure)

	return errs, nil
}

// ValidateBook checks b against design doc §16: no field is required at
// the Book level except bookTitle. No DB access needed — Book is the
// inheritance source, never itself a fallback target.
func ValidateBook(b *models.Book) ValidationErrors {
	var errs ValidationErrors

	if strings.TrimSpace(b.BookTitle) == "" {
		errs = append(errs, FieldError{"bookTitle", "is required"})
	}
	checkLineLength(&errs, "bookTitle", &b.BookTitle)
	checkLineLength(&errs, "composer", b.Composer)
	checkLineLength(&errs, "yearWritten", b.YearWritten)
	checkLineLength(&errs, "workOpusNumber", b.WorkOpusNumber)
	checkLineLength(&errs, "publisher", b.Publisher)
	checkLineLength(&errs, "publisherId", b.PublisherID)
	checkLineLength(&errs, "imslpNumber", b.ImslpNumber)

	return errs
}

// ValidateTagName checks a proposed Key/SheetType/Instrument/UserTag name
// (design doc §5: "each tag value max 255 chars") before it's passed to
// repo.FindOrCreate*.
func ValidateTagName(name string) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("tag name is required")
	}
	if len(name) > MaxLineLength {
		return fmt.Errorf("tag name must be %d characters or fewer", MaxLineLength)
	}
	return nil
}

func checkLineLength(errs *ValidationErrors, field string, val *string) {
	if val != nil && len(*val) > MaxLineLength {
		*errs = append(*errs, FieldError{field, fmt.Sprintf("must be %d characters or fewer", MaxLineLength)})
	}
}

func checkPositiveInt(errs *ValidationErrors, field string, val *int) {
	if val != nil && *val <= 0 {
		*errs = append(*errs, FieldError{field, "must be a positive integer"})
	}
}
