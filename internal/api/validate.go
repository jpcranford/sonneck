package api

import (
	"context"
	"fmt"
	"strings"

	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
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
// The composer/arranger check needs DB access: "required" means the
// *effective* value (piece's own, falling back to the book's) must be
// non-empty, so this calls repo.ResolveEffective — the same resolver
// display/citation/search use — rather than re-deriving that fallback
// logic here.
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
	// Composer OR arranger, not composer alone — a piece crediting only an
	// arranger (no named composer) is a real, legitimate case (e.g. a
	// traditional/folk tune), not missing data. Both are book-inheritable,
	// so either one supplied by the piece's book satisfies this too.
	if eff.Composer.Value == "" && eff.Arranger.Value == "" {
		// Field/Message capitalized here specifically (unlike every other
		// FieldError's lowercase field-name prefix, e.g. "title is
		// required") — Composer and Arranger read as the app's own field
		// labels in this sentence, not a generic identifier prefix.
		errs = append(errs, FieldError{"Composer", "or Arranger is required (set directly, or via the piece's book)"})
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

	checkPositiveInt(&errs, "duration", p.Duration)
	checkPositiveInt(&errs, "bpm", p.BPM)
	checkPositiveInt(&errs, "measureCount", p.MeasureCount)
	checkPositiveInt(&errs, "beatsPerMeasure", p.BeatsPerMeasure)

	return errs, nil
}

// ValidateBook checks b against design doc §16: bookTitle is required, and
// so is one of composer/arranger/publisher — a Book with none of the
// three is missing the one piece of attribution every other bibliographic
// field on it is meant to be attached to (CLAUDE.md > Book-level soft
// inheritance covers why these three specifically). No DB access needed —
// Book is the inheritance source, never itself a fallback target, so
// unlike ValidatePiece this never needs to resolve an effective value.
func ValidateBook(b *models.Book) ValidationErrors {
	var errs ValidationErrors

	if strings.TrimSpace(b.BookTitle) == "" {
		errs = append(errs, FieldError{"bookTitle", "is required"})
	}
	if isBlankOptional(b.Composer) && isBlankOptional(b.Arranger) && isBlankOptional(b.Publisher) {
		// Capitalized for the same reason as ValidatePiece's identical
		// composer-or-arranger message above — these read as field labels
		// in this sentence, not a generic lowercase field-name prefix.
		errs = append(errs, FieldError{"Composer", "or Arranger or Publisher is required"})
	}
	checkLineLength(&errs, "bookTitle", &b.BookTitle)
	checkLineLength(&errs, "composer", b.Composer)
	checkLineLength(&errs, "arranger", b.Arranger)
	checkLineLength(&errs, "yearWritten", b.YearWritten)
	checkLineLength(&errs, "workOpusNumber", b.WorkOpusNumber)
	checkLineLength(&errs, "publisher", b.Publisher)
	checkLineLength(&errs, "publisherId", b.PublisherID)
	checkLineLength(&errs, "imslpNumber", b.ImslpNumber)
	checkLineLength(&errs, "isbn", b.ISBN)

	return errs
}

// isBlankOptional treats a nil pointer the same as a whitespace-only value
// — both count as "not really set" for the composer-or-arranger check
// above, same convention as ResolveEffective's own isBlank.
func isBlankOptional(s *string) bool {
	return s == nil || strings.TrimSpace(*s) == ""
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
