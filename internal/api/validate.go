package api

import (
	"context"
	"fmt"
	"strings"
	"time"

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
	// Composer/Arranger are ordered lists now (migration 00020) — "empty"
	// is len==0, not a blank string; each name's own length is validated
	// earlier, at the name→id resolution step (applyPieceWriteRequest's
	// resolveTagNames, via api.ValidateTagName), not here — same treatment
	// Keys/Instruments/UserTags already get, none of which are re-checked
	// in this function either.
	if len(eff.Composer.IDs) == 0 && len(eff.Arranger.IDs) == 0 {
		// Field/Message capitalized here specifically (unlike every other
		// FieldError's lowercase field-name prefix, e.g. "title is
		// required") — Composer and Arranger read as the app's own field
		// labels in this sentence, not a generic identifier prefix.
		errs = append(errs, FieldError{"Composer", "or Arranger is required (set directly, or via the piece's book)"})
	}
	checkLineLength(&errs, "workOpusNumber", p.WorkOpusNumber)
	checkLineLength(&errs, "publisher", p.Publisher)
	checkLineLength(&errs, "publisherId", p.PublisherID)
	checkLineLength(&errs, "yearWritten", p.YearWritten)
	checkLineLength(&errs, "imslpNumber", p.ImslpNumber)
	checkLineLength(&errs, "copyrightHolder", p.CopyrightHolder)
	checkCopyrightYear(&errs, p.CopyrightYear)
	checkCopyrightStatus(&errs, p.CopyrightStatus)

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
	// Composer/Arranger are ordered lists now (migration 00020) — "empty"
	// is len==0; per-name length is validated at the name→id resolution
	// step, not here (see ValidatePiece's identical note).
	if len(b.ComposerIDs) == 0 && len(b.ArrangerIDs) == 0 && isBlankOptional(b.Publisher) {
		// Capitalized for the same reason as ValidatePiece's identical
		// composer-or-arranger message above — these read as field labels
		// in this sentence, not a generic lowercase field-name prefix.
		errs = append(errs, FieldError{"Composer", "or Arranger or Publisher is required"})
	}
	checkLineLength(&errs, "bookTitle", &b.BookTitle)
	checkLineLength(&errs, "yearPublished", b.YearPublished)
	checkLineLength(&errs, "workOpusNumber", b.WorkOpusNumber)
	checkLineLength(&errs, "publisher", b.Publisher)
	checkLineLength(&errs, "publisherId", b.PublisherID)
	checkLineLength(&errs, "imslpNumber", b.ImslpNumber)
	checkLineLength(&errs, "isbn", b.ISBN)
	checkLineLength(&errs, "copyrightHolder", b.CopyrightHolder)
	checkCopyrightYear(&errs, b.CopyrightYear)
	checkCopyrightStatus(&errs, b.CopyrightStatus)

	return errs
}

// isBlankOptional treats a nil pointer the same as a whitespace-only value
// — both count as "not really set" for the composer-or-arranger check
// above, same convention as ResolveEffective's own isBlank.
func isBlankOptional(s *string) bool {
	return s == nil || strings.TrimSpace(*s) == ""
}

// ValidatePerson checks p (composer/arranger overhaul, migration 00020) —
// "should be very minimal" per the original brief: Name is the only
// required field. Bio is a box/multi-line markdown field (same category as
// Piece.description/userNotes), so it doesn't get checkLineLength's
// 255-char cap, matching how those two are exempted too.
func ValidatePerson(p *models.Person) ValidationErrors {
	var errs ValidationErrors
	if strings.TrimSpace(p.Name) == "" {
		errs = append(errs, FieldError{"name", "is required"})
	}
	checkLineLength(&errs, "name", &p.Name)
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

// minCopyrightYear/maxCopyrightYearFuture mirror the sane-range check the
// original design doc specified for this field before the whole feature
// was deferred (design doc §13's "1400–current year+1"). 1400 is a floor,
// not tied to "this year" the way the upper bound is, so it's a plain
// constant rather than computed.
const minCopyrightYear = 1400

func checkCopyrightYear(errs *ValidationErrors, val *int) {
	if val == nil {
		return
	}
	maxYear := time.Now().Year() + 1
	if *val < minCopyrightYear || *val > maxYear {
		*errs = append(*errs, FieldError{"copyrightYear", fmt.Sprintf("must be between %d and %d", minCopyrightYear, maxYear)})
	}
}

// validCopyrightStatuses mirrors the pieces/books.copyright_status CHECK
// constraint (migration 00022) — validated at this layer too so a bad
// value surfaces as a real {error} envelope field message instead of an
// opaque 500 from the raw SQL constraint violation.
var validCopyrightStatuses = map[string]bool{
	"publicDomain":       true,
	"copyleft":           true,
	"likelyPublicDomain": true,
	"inCopyright":        true,
}

func checkCopyrightStatus(errs *ValidationErrors, val *string) {
	if val != nil && !validCopyrightStatuses[*val] {
		*errs = append(*errs, FieldError{"copyrightStatus", "must be one of: publicDomain, copyleft, likelyPublicDomain, inCopyright"})
	}
}
