package api

import (
	"context"
	"time"

	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/repo"
)

// EffectiveTagRef and EffectiveTagRefs are the tag-shaped counterparts to
// repo.EffectiveIDField/EffectiveTagsField, carrying the resolved Tag
// (id+name) instead of a bare ID so the frontend never has to make a
// second round trip to show "Inherited from book" (design doc §15).
type EffectiveTagRef struct {
	Value     *repo.Tag `json:"value"`
	Inherited bool      `json:"inherited"`
}

type EffectiveTagRefs struct {
	Values    []repo.Tag `json:"values"`
	Inherited bool       `json:"inherited"`
}

// PieceResponse is the wire shape for a Piece. Every book-inheritable field
// is an effective-value object ({value, inherited}) built via
// repo.ResolveEffective — never a raw Piece column — per CLAUDE.md > Book-
// level soft inheritance: display must go through the same resolver as
// validation/citation/search, or it would silently diverge from them.
type PieceResponse struct {
	ID              int64               `json:"id"`
	Title           string              `json:"title"`
	Composer        repo.EffectiveField `json:"composer"`
	Arranger        repo.EffectiveField `json:"arranger"`
	Favorite        bool                `json:"favorite"`
	WorkOpusNumber  repo.EffectiveField `json:"workOpusNumber"`
	Keys            []repo.Tag          `json:"keys"`
	SheetType       EffectiveTagRef     `json:"sheetType"`
	Publisher       repo.EffectiveField `json:"publisher"`
	PublisherID     repo.EffectiveField `json:"publisherId"`
	YearWritten     repo.EffectiveField `json:"yearWritten"`
	Description     repo.EffectiveField `json:"description"`
	UserNotes       *string             `json:"userNotes"`
	UserTags        []repo.Tag          `json:"userTags"`
	PracticeStatus  *string             `json:"practiceStatus"`
	ImslpNumber     repo.EffectiveField `json:"imslpNumber"`
	Instruments     EffectiveTagRefs    `json:"instruments"`
	SourceBookID    *int64              `json:"sourceBookId"`
	SourceBookTitle *string             `json:"sourceBookTitle,omitempty"`
	SourcePageStart *int                `json:"sourcePageStart"`
	SourcePageEnd   *int                `json:"sourcePageEnd"`
	Duration        *int                `json:"duration"`
	BPM             *int                `json:"bpm"`
	MeasureCount    *int                `json:"measureCount"`
	BeatsPerMeasure *int                `json:"beatsPerMeasure"`
	FileHash        string              `json:"fileHash"`
	PageCount       int                 `json:"pageCount"`
	ThumbnailPage   int                 `json:"thumbnailPage"`
	CopyrightYear   *int                `json:"copyrightYear"`
	PublicDomain    bool                `json:"publicDomain"`
	CreatedAt       time.Time           `json:"createdAt"`
	UpdatedAt       time.Time           `json:"updatedAt"`
}

// BuildPieceResponse resolves p's effective values and every referenced
// tag's display name, in the fewest queries reasonable for v1's scale.
func BuildPieceResponse(ctx context.Context, q repo.Queryer, p *models.Piece) (*PieceResponse, error) {
	eff, err := repo.ResolveEffective(ctx, q, p)
	if err != nil {
		return nil, err
	}

	resp := &PieceResponse{
		ID:              p.ID,
		Title:           p.Title,
		Composer:        eff.Composer,
		Arranger:        eff.Arranger,
		Favorite:        p.Favorite,
		WorkOpusNumber:  eff.WorkOpusNumber,
		Publisher:       eff.Publisher,
		PublisherID:     eff.PublisherID,
		YearWritten:     eff.YearWritten,
		Description:     eff.Description,
		UserNotes:       p.UserNotes,
		PracticeStatus:  p.PracticeStatus,
		ImslpNumber:     eff.ImslpNumber,
		SourceBookID:    p.SourceBookID,
		SourcePageStart: p.SourcePageStart,
		SourcePageEnd:   p.SourcePageEnd,
		Duration:        p.Duration,
		BPM:             p.BPM,
		MeasureCount:    p.MeasureCount,
		BeatsPerMeasure: p.BeatsPerMeasure,
		FileHash:        p.FileHash,
		PageCount:       p.PageCount,
		ThumbnailPage:   p.ThumbnailPage,
		CopyrightYear:   p.CopyrightYear,
		PublicDomain:    p.PublicDomain,
		CreatedAt:       p.CreatedAt,
		UpdatedAt:       p.UpdatedAt,
		Keys:            []repo.Tag{},
	}

	if len(p.KeyIDs) > 0 {
		keys, err := repo.KeysByIDs(ctx, q, p.KeyIDs)
		if err != nil {
			return nil, err
		}
		resp.Keys = keys
	}

	resp.SheetType = EffectiveTagRef{Inherited: eff.SheetTypeID.Inherited}
	if eff.SheetTypeID.Value != nil {
		st, err := repo.GetSheetTypeByID(ctx, q, *eff.SheetTypeID.Value)
		if err != nil {
			return nil, err
		}
		resp.SheetType.Value = &repo.Tag{ID: st.ID, Name: st.Name}
	}

	// Array fields default to an empty slice, never left nil — encoding/json
	// marshals a nil slice as `null`, and every frontend consumer types
	// these as plain arrays (e.g. Piece.userTags: Tag[]), not Tag[] | null.
	resp.Instruments = EffectiveTagRefs{Values: []repo.Tag{}, Inherited: eff.InstrumentIDs.Inherited}
	if len(eff.InstrumentIDs.IDs) > 0 {
		tags, err := repo.TagsByIDs(ctx, q, "instruments", eff.InstrumentIDs.IDs)
		if err != nil {
			return nil, err
		}
		resp.Instruments.Values = tags
	}

	resp.UserTags = []repo.Tag{}
	if len(p.UserTagIDs) > 0 {
		tags, err := repo.TagsByIDs(ctx, q, "user_tags", p.UserTagIDs)
		if err != nil {
			return nil, err
		}
		resp.UserTags = tags
	}

	if p.SourceBookID != nil {
		book, err := repo.GetBookByID(ctx, q, *p.SourceBookID)
		if err != nil {
			return nil, err
		}
		resp.SourceBookTitle = &book.BookTitle
	}

	return resp, nil
}

// BookResponse is the wire shape for a Book (design doc §16's edit menu
// surface). PieceCount backs the "this affects N pieces" UI note called
// for when editing book-level fields. OriginalFilename/FileHash are
// nullable (migration 00014) — a manually created Book (Books library
// view's "New Book" button) has no underlying file.
type BookResponse struct {
	ID             int64     `json:"id"`
	BookTitle      string    `json:"bookTitle"`
	Composer       *string   `json:"composer"`
	Arranger       *string   `json:"arranger"`
	YearWritten    *string   `json:"yearWritten"`
	WorkOpusNumber *string   `json:"workOpusNumber"`
	SheetType      *repo.Tag `json:"sheetType"`
	Publisher      *string   `json:"publisher"`
	PublisherID    *string   `json:"publisherId"`
	Description    *string   `json:"description"`
	ImslpNumber    *string   `json:"imslpNumber"`
	// ISBN (migration 00017): plain digits, no hyphens — see models.Book's
	// own doc comment. The frontend hyphenates for display.
	ISBN             *string    `json:"isbn"`
	Instruments      []repo.Tag `json:"instruments"`
	OriginalFilename *string    `json:"originalFilename"`
	FileHash         *string    `json:"fileHash"`
	// HasCustomCover (migration 00018): true when a manually uploaded cover
	// image overrides the derived first-page-of-PDF thumbnail. The frontend
	// always fetches the actual image from GET /api/books/{id}/cover (which
	// resolves the fallback chain itself) — this field exists only so the
	// frontend can decide whether to render an <img> at all (custom cover OR
	// a real file) vs. the "No-File Cover" placeholder, and whether a
	// "Remove Cover Image" action has anything to do.
	HasCustomCover bool `json:"hasCustomCover"`
	// CoverImageHash: exposed (same precedent as FileHash) so the frontend
	// can cache-bust getBookCoverUrl — that URL is otherwise the same
	// string before and after a cover upload/replace/removal, and neither
	// React (unchanged src prop) nor the browser has any other signal that
	// the underlying image actually changed. nil when there's no custom
	// cover (the frontend falls back to FileHash as the version key then,
	// since that's what drives the derived thumbnail changing instead).
	CoverImageHash *string   `json:"coverImageHash"`
	ImportedAt     time.Time `json:"importedAt"`
	PieceCount     int       `json:"pieceCount"`
}

func BuildBookResponse(ctx context.Context, q repo.Queryer, b *models.Book) (*BookResponse, error) {
	resp := &BookResponse{
		ID:               b.ID,
		BookTitle:        b.BookTitle,
		Composer:         b.Composer,
		Arranger:         b.Arranger,
		YearWritten:      b.YearWritten,
		WorkOpusNumber:   b.WorkOpusNumber,
		Publisher:        b.Publisher,
		PublisherID:      b.PublisherID,
		Description:      b.Description,
		ImslpNumber:      b.ImslpNumber,
		ISBN:             b.ISBN,
		Instruments:      []repo.Tag{},
		OriginalFilename: b.OriginalFilename,
		FileHash:         b.FileHash,
		HasCustomCover:   b.CoverImageHash != nil,
		CoverImageHash:   b.CoverImageHash,
		ImportedAt:       b.ImportedAt,
	}

	if b.SheetTypeID != nil {
		st, err := repo.GetSheetTypeByID(ctx, q, *b.SheetTypeID)
		if err != nil {
			return nil, err
		}
		resp.SheetType = &repo.Tag{ID: st.ID, Name: st.Name}
	}

	if len(b.InstrumentIDs) > 0 {
		tags, err := repo.TagsByIDs(ctx, q, "instruments", b.InstrumentIDs)
		if err != nil {
			return nil, err
		}
		resp.Instruments = tags
	}

	count, err := repo.CountPiecesForBook(ctx, q, b.ID)
	if err != nil {
		return nil, err
	}
	resp.PieceCount = count

	return resp, nil
}

// PieceWriteRequest is the full-form submission shape for both the
// wizard's per-piece fill step and the standalone piece edit menu (design
// doc §5, §15) — react-hook-form submits the whole form each time, so this
// is a wholesale replace, not a sparse PATCH: a nil/empty field means
// "cleared", not "leave unchanged". Tag fields are names, not IDs
// (Calibre-style pick-existing-or-type-new — resolved server-side via
// repo.FindOrCreate*).
type PieceWriteRequest struct {
	Title          string   `json:"title"`
	Composer       *string  `json:"composer"`
	Arranger       *string  `json:"arranger"`
	Favorite       bool     `json:"favorite"`
	WorkOpusNumber *string  `json:"workOpusNumber"`
	Keys           []string `json:"keys"`
	SheetTypeName  *string  `json:"sheetTypeName"`
	Publisher      *string  `json:"publisher"`
	PublisherID    *string  `json:"publisherId"`
	YearWritten    *string  `json:"yearWritten"`
	Description    *string  `json:"description"`
	UserNotes      *string  `json:"userNotes"`
	Instruments    []string `json:"instruments"`
	UserTags       []string `json:"userTags"`
	PracticeStatus *string  `json:"practiceStatus"`
	ImslpNumber    *string  `json:"imslpNumber"`
	// SourceBookID lets the Piece Properties Edit Menu (design doc §15)
	// re-match a piece to a different existing Book, or clear it to none
	// (nil, full-replace like every other field here). Must reference a
	// real Book — applyPieceWriteRequest checks this explicitly and
	// returns a validation error rather than letting a bad id surface as
	// an opaque 500 from repo.ResolveEffective later in the request.
	SourceBookID    *int64 `json:"sourceBookId"`
	SourcePageStart *int   `json:"sourcePageStart"`
	SourcePageEnd   *int   `json:"sourcePageEnd"`
	Duration        *int   `json:"duration"`
	BPM             *int   `json:"bpm"`
	MeasureCount    *int   `json:"measureCount"`
	BeatsPerMeasure *int   `json:"beatsPerMeasure"`
}

// BookCreateRequest is the Books library view's "New Book" button
// submission shape — creating a Book with no underlying file, distinct
// from the upload/import wizard's POST /api/books (which always requires
// a real PDF). Deliberately narrower than BookWriteRequest: only the
// fields a book can meaningfully have before any pieces exist to classify
// it by (no sheet type/instruments/opus/IMSLP/description/ISBN here).
// Arranger is included alongside Composer, unlike those others — since
// ValidateBook now requires one of the two, leaving arranger out here would
// make that requirement satisfiable only via composer at creation time.
type BookCreateRequest struct {
	BookTitle   string  `json:"bookTitle"`
	Composer    *string `json:"composer"`
	Arranger    *string `json:"arranger"`
	Publisher   *string `json:"publisher"`
	YearWritten *string `json:"yearWritten"`
}

// BookWriteRequest is the Book Properties Edit Menu's submission shape
// (design doc §16). BookTitle is required, and so is one of
// Composer/Arranger (ValidateBook) — no other field is.
type BookWriteRequest struct {
	BookTitle      string  `json:"bookTitle"`
	Composer       *string `json:"composer"`
	Arranger       *string `json:"arranger"`
	YearWritten    *string `json:"yearWritten"`
	WorkOpusNumber *string `json:"workOpusNumber"`
	SheetTypeName  *string `json:"sheetTypeName"`
	Publisher      *string `json:"publisher"`
	PublisherID    *string `json:"publisherId"`
	Description    *string `json:"description"`
	ImslpNumber    *string `json:"imslpNumber"`
	// ISBN follows the same normalize-on-write treatment as IMSLP number's
	// prefix (handleUpdateBook's normalizeISBN) — plain digits stored,
	// whatever punctuation/label the user typed.
	ISBN        *string  `json:"isbn"`
	Instruments []string `json:"instruments"`
}
