package repo

import (
	"context"
	"strconv"
	"strings"

	"github.com/jpcranford/sonneck/internal/models"
)

// EffectiveField is a book-inheritable string field resolved to its
// effective value: the piece's own value if non-empty, else the book's.
// JSON-tagged so API handlers can return it directly — this is the wire
// shape the frontend uses to render "Inherited from book" (design doc §15).
type EffectiveField struct {
	Value     string `json:"value"`
	Inherited bool   `json:"inherited"` // true if Value came from the book, not the piece itself
}

// EffectiveIDField is the same fallback for a single-value FK field
// (sheetType).
type EffectiveIDField struct {
	Value     *int64 `json:"value"`
	Inherited bool   `json:"inherited"`
}

// EffectiveTagsField is the same fallback for a many-to-many field
// (instruments): "empty" means zero tags assigned, not a null/blank value.
type EffectiveTagsField struct {
	IDs       []int64 `json:"ids"`
	Inherited bool    `json:"inherited"`
}

// EffectiveIntField is the same fallback as EffectiveField for an integer
// field (Public Domain Badge feature's CopyrightYear) — nil Value means
// neither the piece nor its book has one set.
type EffectiveIntField struct {
	Value     *int `json:"value"`
	Inherited bool `json:"inherited"`
}

// EffectiveBoolField is the same fallback as EffectiveField for a boolean
// field (US renewal follow-up's CopyrightRenewed) — unlike EffectiveIntField,
// Value is a plain bool, not a pointer: "neither the piece nor its book has
// one set" resolves to false (not renewed) rather than a third null state,
// matching the confirmed product decision that an unanswered renewal toggle
// is treated the same as an explicit "no."
type EffectiveBoolField struct {
	Value     bool `json:"value"`
	Inherited bool `json:"inherited"`
}

// EffectivePiece holds every book-inheritable field (design doc §3's
// confirmed list) resolved to its effective value. This is the ONLY
// resolution logic in the app — display, validation, citation generation,
// and search indexing must all call ResolveEffective rather than reading
// Piece columns directly, or they will silently diverge from what's shown
// to the user (CLAUDE.md > Book-level soft inheritance).
type EffectivePiece struct {
	// Composer/Arranger (composer/arranger overhaul, migration 00020) are
	// ordered many-to-many fields now, not a single string — they reuse
	// EffectiveTagsField/resolveTagsField unchanged (the exact same
	// fallback shape InstrumentIDs already uses): a piece's own list wins
	// in its entirety the moment it's non-empty, never merged with the
	// book's. See CLAUDE.md's Book-level inheritance note for the full
	// "all-or-nothing per field, independently" semantics.
	Composer       EffectiveTagsField
	Arranger       EffectiveTagsField
	Publisher      EffectiveField
	PublisherID    EffectiveField
	ImslpNumber    EffectiveField
	YearWritten    EffectiveField
	WorkOpusNumber EffectiveField
	Description    EffectiveField
	SheetTypeID    EffectiveIDField
	InstrumentIDs  EffectiveTagsField

	// Public Domain Badge feature (migration 00022). CopyrightStatus here
	// is the RAW explicit pick only (piece's own non-nil value, else the
	// book's, else blank) — the same plain fallback every other
	// EffectiveField uses. It is NOT the final effective badge status:
	// that needs live computation against composer death years/region on
	// top of this, which ResolveCopyrightStatus (copyright.go, this
	// package) does separately, taking this struct as input. Kept
	// separate from ResolveEffective itself because the two other callers
	// that don't need the badge status at all (ValidatePiece,
	// ResyncSearchIndex) shouldn't have to pay for it.
	CopyrightYear   EffectiveIntField
	CopyrightHolder EffectiveField
	CopyrightSlug   EffectiveField
	CopyrightStatus EffectiveField

	// CopyrightRenewed: US renewal follow-up — only meaningful for an en-US
	// CopyrightYear in 1923-1963, but resolved unconditionally here like
	// every other book-inheritable field; ComputeLikelyPublicDomain is what
	// actually gates whether it affects anything. See
	// models.Piece.CopyrightRenewed's doc comment for the legal reasoning.
	CopyrightRenewed EffectiveBoolField

	// CopyrightYearForCalc is the year actually fed into the Likely Public
	// Domain calculation (ResolveCopyrightStatus, this package) — a longer
	// fallback chain than CopyrightYear's own piece-then-book resolution,
	// since a book/piece pair often has no explicit Copyright Year set at
	// all even when a publication year is on record. In priority order:
	// piece's own copyright year, book's copyright year, book's year
	// published, piece's own year written (checked last since it's often
	// itself just inherited display of the book's year published — see
	// resolveCopyrightYearForCalc). YearWritten/YearPublished are free-text
	// fields, so a value that doesn't parse as a clean year is skipped
	// rather than guessed at. Calculation-only: never displayed as "the"
	// copyright year and not exposed on any API response — CopyrightYear
	// above remains what's shown/edited in the UI and used by citations.
	CopyrightYearForCalc *int
}

// ResolveEffective computes p's effective values, loading its source Book
// (if any) as needed. Fields not in the book-inheritable list (title, key,
// userNotes, userTags, favorite, practiceStatus, etc.) are not part of this
// struct — read them directly off Piece, since they never fall back to
// anything.
func ResolveEffective(ctx context.Context, q Queryer, p *models.Piece) (*EffectivePiece, error) {
	var book *models.Book
	if p.SourceBookID != nil {
		b, err := GetBookByID(ctx, q, *p.SourceBookID)
		if err != nil {
			return nil, err
		}
		book = b
	}

	var bookPublisher, bookPublisherID, bookImslpNumber, bookYearPublished, bookWorkOpusNumber, bookDescription *string
	var bookSheetTypeID *int64
	var bookInstrumentIDs, bookComposerIDs, bookArrangerIDs []int64
	var bookCopyrightYear *int
	var bookCopyrightHolder, bookCopyrightSlug, bookCopyrightStatus *string
	var bookCopyrightRenewed *bool
	if book != nil {
		bookPublisher = book.Publisher
		bookPublisherID = book.PublisherID
		bookImslpNumber = book.ImslpNumber
		bookYearPublished = book.YearPublished
		bookWorkOpusNumber = book.WorkOpusNumber
		bookDescription = book.Description
		bookSheetTypeID = book.SheetTypeID
		bookInstrumentIDs = book.InstrumentIDs
		bookComposerIDs = book.ComposerIDs
		bookArrangerIDs = book.ArrangerIDs
		bookCopyrightYear = book.CopyrightYear
		bookCopyrightHolder = book.CopyrightHolder
		bookCopyrightSlug = book.CopyrightSlug
		bookCopyrightStatus = book.CopyrightStatus
		bookCopyrightRenewed = book.CopyrightRenewed
	}

	copyrightYear := resolveIntField(p.CopyrightYear, bookCopyrightYear)

	return &EffectivePiece{
		Composer:             resolveTagsField(p.ComposerIDs, bookComposerIDs),
		Arranger:             resolveTagsField(p.ArrangerIDs, bookArrangerIDs),
		Publisher:            resolveStringField(p.Publisher, bookPublisher),
		PublisherID:          resolveStringField(p.PublisherID, bookPublisherID),
		ImslpNumber:          resolveStringField(p.ImslpNumber, bookImslpNumber),
		YearWritten:          resolveYearWritten(p.YearWritten, p.CopyrightYear, bookYearPublished),
		WorkOpusNumber:       resolveStringField(p.WorkOpusNumber, bookWorkOpusNumber),
		Description:          resolveStringField(p.Description, bookDescription),
		SheetTypeID:          resolveIDField(p.SheetTypeID, bookSheetTypeID),
		InstrumentIDs:        resolveTagsField(p.InstrumentIDs, bookInstrumentIDs),
		CopyrightYear:        copyrightYear,
		CopyrightHolder:      resolveStringField(p.CopyrightHolder, bookCopyrightHolder),
		CopyrightSlug:        resolveStringField(p.CopyrightSlug, bookCopyrightSlug),
		CopyrightStatus:      resolveStringField(p.CopyrightStatus, bookCopyrightStatus),
		CopyrightRenewed:     resolveBoolField(p.CopyrightRenewed, bookCopyrightRenewed),
		CopyrightYearForCalc: resolveCopyrightYearForCalc(copyrightYear, bookYearPublished, p.YearWritten),
	}, nil
}

// resolveCopyrightYearForCalc implements CopyrightYearForCalc's own
// fallback chain — see that field's doc comment for the full reasoning.
// copyrightYear is the already-resolved piece-then-book CopyrightYear
// (covers priority 1 and 2 in one step); bookYearPublished/pieceYearWritten
// are the raw, unresolved fields, since the ordering needed here (book's
// year published before the piece's own year written) is the reverse of
// YearWritten's own piece-before-book resolution.
func resolveCopyrightYearForCalc(copyrightYear EffectiveIntField, bookYearPublished, pieceYearWritten *string) *int {
	if copyrightYear.Value != nil {
		return copyrightYear.Value
	}
	if year := parseYearInt(bookYearPublished); year != nil {
		return year
	}
	return parseYearInt(pieceYearWritten)
}

// parseYearInt reads a free-text year field (YearWritten/YearPublished
// allow arbitrary text, e.g. "c. 1908") as a clean integer, returning nil
// rather than guessing when it isn't one — matching this package's existing
// "never guess" convention (see ComputeLikelyPublicDomain's own doc
// comment).
func parseYearInt(s *string) *int {
	if s == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*s)
	if trimmed == "" {
		return nil
	}
	year, err := strconv.Atoi(trimmed)
	if err != nil {
		return nil
	}
	return &year
}

// isBlank treats whitespace-only as empty, matching how title/tag-name
// required-checks already work elsewhere (ValidatePiece, ValidateTagName)
// — a piece with composer=" " must fall back to its book's composer, not
// be treated as having "set" its own.
func isBlank(s string) bool {
	return strings.TrimSpace(s) == ""
}

// resolveYearWritten implements YearWritten's own extended fallback chain
// (direct follow-up request): the piece's own YearWritten if set, else the
// piece's own CopyrightYear (a piece can legitimately have an accurate
// copyright year on record with no separate written-year note), else the
// book's YearPublished — the original two-level fallback resolveStringField
// still handles for every other field. Both fallback steps are marked
// Inherited, same treatment, even though the CopyrightYear step isn't
// really "from the book" — a direct, deliberate simplification (reusing
// the existing "Inherited from book"/"(pub.)" UI as-is rather than adding a
// third distinct source label) rather than an oversight.
func resolveYearWritten(pieceYearWritten *string, pieceCopyrightYear *int, bookYearPublished *string) EffectiveField {
	if pieceYearWritten != nil && !isBlank(*pieceYearWritten) {
		return EffectiveField{Value: *pieceYearWritten}
	}
	if pieceCopyrightYear != nil {
		return EffectiveField{Value: strconv.Itoa(*pieceCopyrightYear), Inherited: true}
	}
	if bookYearPublished != nil && !isBlank(*bookYearPublished) {
		return EffectiveField{Value: *bookYearPublished, Inherited: true}
	}
	return EffectiveField{}
}

func resolveStringField(pieceVal, bookVal *string) EffectiveField {
	if pieceVal != nil && !isBlank(*pieceVal) {
		return EffectiveField{Value: *pieceVal}
	}
	if bookVal != nil && !isBlank(*bookVal) {
		return EffectiveField{Value: *bookVal, Inherited: true}
	}
	return EffectiveField{}
}

func resolveIntField(pieceVal, bookVal *int) EffectiveIntField {
	if pieceVal != nil {
		return EffectiveIntField{Value: pieceVal}
	}
	if bookVal != nil {
		return EffectiveIntField{Value: bookVal, Inherited: true}
	}
	return EffectiveIntField{}
}

func resolveBoolField(pieceVal, bookVal *bool) EffectiveBoolField {
	if pieceVal != nil {
		return EffectiveBoolField{Value: *pieceVal}
	}
	if bookVal != nil {
		return EffectiveBoolField{Value: *bookVal, Inherited: true}
	}
	return EffectiveBoolField{}
}

func resolveIDField(pieceVal, bookVal *int64) EffectiveIDField {
	if pieceVal != nil {
		return EffectiveIDField{Value: pieceVal}
	}
	if bookVal != nil {
		return EffectiveIDField{Value: bookVal, Inherited: true}
	}
	return EffectiveIDField{}
}

func resolveTagsField(pieceIDs, bookIDs []int64) EffectiveTagsField {
	if len(pieceIDs) > 0 {
		return EffectiveTagsField{IDs: pieceIDs}
	}
	if len(bookIDs) > 0 {
		return EffectiveTagsField{IDs: bookIDs, Inherited: true}
	}
	return EffectiveTagsField{}
}
