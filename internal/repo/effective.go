package repo

import (
	"context"
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

// EffectivePiece holds every book-inheritable field (design doc §3's
// confirmed list) resolved to its effective value. This is the ONLY
// resolution logic in the app — display, validation, citation generation,
// and search indexing must all call ResolveEffective rather than reading
// Piece columns directly, or they will silently diverge from what's shown
// to the user (CLAUDE.md > Book-level soft inheritance).
type EffectivePiece struct {
	Composer       EffectiveField
	Publisher      EffectiveField
	PublisherID    EffectiveField
	ImslpNumber    EffectiveField
	YearWritten    EffectiveField
	WorkOpusNumber EffectiveField
	Description    EffectiveField
	SheetTypeID    EffectiveIDField
	InstrumentIDs  EffectiveTagsField
}

// ResolveEffective computes p's effective values, loading its source Book
// (if any) as needed. Fields not in the book-inheritable list (title, key,
// arranger, userNotes, userTags, favorite, practiceStatus, etc.) are not
// part of this struct — read them directly off Piece, since they never
// fall back to anything.
func ResolveEffective(ctx context.Context, q Queryer, p *models.Piece) (*EffectivePiece, error) {
	var book *models.Book
	if p.SourceBookID != nil {
		b, err := GetBookByID(ctx, q, *p.SourceBookID)
		if err != nil {
			return nil, err
		}
		book = b
	}

	var bookComposer, bookPublisher, bookPublisherID, bookImslpNumber, bookYearWritten, bookWorkOpusNumber, bookDescription *string
	var bookSheetTypeID *int64
	var bookInstrumentIDs []int64
	if book != nil {
		bookComposer = book.Composer
		bookPublisher = book.Publisher
		bookPublisherID = book.PublisherID
		bookImslpNumber = book.ImslpNumber
		bookYearWritten = book.YearWritten
		bookWorkOpusNumber = book.WorkOpusNumber
		bookDescription = book.Description
		bookSheetTypeID = book.SheetTypeID
		bookInstrumentIDs = book.InstrumentIDs
	}

	return &EffectivePiece{
		Composer:       resolveStringField(p.Composer, bookComposer),
		Publisher:      resolveStringField(p.Publisher, bookPublisher),
		PublisherID:    resolveStringField(p.PublisherID, bookPublisherID),
		ImslpNumber:    resolveStringField(p.ImslpNumber, bookImslpNumber),
		YearWritten:    resolveStringField(p.YearWritten, bookYearWritten),
		WorkOpusNumber: resolveStringField(p.WorkOpusNumber, bookWorkOpusNumber),
		Description:    resolveStringField(p.Description, bookDescription),
		SheetTypeID:    resolveIDField(p.SheetTypeID, bookSheetTypeID),
		InstrumentIDs:  resolveTagsField(p.InstrumentIDs, bookInstrumentIDs),
	}, nil
}

// isBlank treats whitespace-only as empty, matching how title/tag-name
// required-checks already work elsewhere (ValidatePiece, ValidateTagName)
// — a piece with composer=" " must fall back to its book's composer, not
// be treated as having "set" its own.
func isBlank(s string) bool {
	return strings.TrimSpace(s) == ""
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
