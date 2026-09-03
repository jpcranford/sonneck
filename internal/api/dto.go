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

// CopyrightStatusResponse (Public Domain Badge feature, migration 00022)
// can't reuse plain EffectiveField like CopyrightHolder/CopyrightSlug do,
// because the badge's displayed status is never just "the piece's own
// pick, else the book's" — it's that pick corrected forward by a live
// calculation (repo.ResolveCopyrightStatus). Value/Inherited are the raw
// explicit pick (same shape/meaning as every other EffectiveField — what
// the Edit Piece dropdown should show as "currently selected" before
// considering the calculation); Effective is the final status the badge
// and citation actually use, always one of the four real values, never
// blank; ExpiryYear is the algorithm's own computed term-expiry year (for
// the "as of {year}" tooltip), nil when not computable.
type CopyrightStatusResponse struct {
	Value      string `json:"value"`
	Inherited  bool   `json:"inherited"`
	Effective  string `json:"effective"`
	ExpiryYear *int   `json:"expiryYear"`
}

// PieceResponse is the wire shape for a Piece. Every book-inheritable field
// is an effective-value object ({value, inherited}) built via
// repo.ResolveEffective — never a raw Piece column — per CLAUDE.md > Book-
// level soft inheritance: display must go through the same resolver as
// validation/citation/search, or it would silently diverge from them.
type PieceResponse struct {
	ID    int64  `json:"id"`
	Title string `json:"title"`
	// Composer/Arranger (composer/arranger overhaul, migration 00020) are
	// ordered many-to-many now — same EffectiveTagRefs wire shape
	// Instruments already uses, not a plain EffectiveField string.
	Composer        EffectiveTagRefs    `json:"composer"`
	Arranger        EffectiveTagRefs    `json:"arranger"`
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
	// CopyrightYear/CopyrightHolder/CopyrightSlug (Public Domain Badge
	// feature, migration 00022) are book-inheritable, same EffectiveField
	// shape as every other such field. CopyrightStatus carries both the
	// raw explicit pick (value/inherited, same shape) AND the final
	// computed/overridden badge status + its expiry year — see
	// CopyrightStatusResponse's own doc comment for why these can't share
	// one plain EffectiveField the way the other three do.
	CopyrightYear   repo.EffectiveIntField  `json:"copyrightYear"`
	CopyrightHolder repo.EffectiveField     `json:"copyrightHolder"`
	CopyrightSlug   repo.EffectiveField     `json:"copyrightSlug"`
	CopyrightStatus CopyrightStatusResponse `json:"copyrightStatus"`
	CreatedAt       time.Time               `json:"createdAt"`
	UpdatedAt       time.Time               `json:"updatedAt"`
}

// BuildPieceResponse resolves p's effective values and every referenced
// tag's display name, in the fewest queries reasonable for v1's scale.
// region (Public Domain Badge feature) is the validated COPYRIGHT_REGION
// config value — every caller is a handler method with s.Cfg in scope.
func BuildPieceResponse(ctx context.Context, q repo.Queryer, p *models.Piece, region string) (*PieceResponse, error) {
	eff, err := repo.ResolveEffective(ctx, q, p)
	if err != nil {
		return nil, err
	}
	copyrightEffective, copyrightExpiryYear, _, err := repo.ResolveCopyrightStatus(ctx, q, eff, region)
	if err != nil {
		return nil, err
	}

	resp := &PieceResponse{
		ID:              p.ID,
		Title:           p.Title,
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
		CopyrightYear:   eff.CopyrightYear,
		CopyrightHolder: eff.CopyrightHolder,
		CopyrightSlug:   eff.CopyrightSlug,
		CopyrightStatus: CopyrightStatusResponse{
			Value:      eff.CopyrightStatus.Value,
			Inherited:  eff.CopyrightStatus.Inherited,
			Effective:  copyrightEffective,
			ExpiryYear: copyrightExpiryYear,
		},
		Duration:        p.Duration,
		BPM:             p.BPM,
		MeasureCount:    p.MeasureCount,
		BeatsPerMeasure: p.BeatsPerMeasure,
		FileHash:        p.FileHash,
		PageCount:       p.PageCount,
		ThumbnailPage:   p.ThumbnailPage,
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

	// Composer/Arranger (migration 00020): resolved via PeopleByIDs, not
	// TagsByIDs — order is meaningful (credit order), and only PeopleByIDs
	// preserves the id list's own order the way KeysByIDs already does for
	// a piece's key sequence.
	resp.Composer = EffectiveTagRefs{Values: []repo.Tag{}, Inherited: eff.Composer.Inherited}
	if len(eff.Composer.IDs) > 0 {
		people, err := repo.PeopleByIDs(ctx, q, eff.Composer.IDs)
		if err != nil {
			return nil, err
		}
		resp.Composer.Values = people
	}
	resp.Arranger = EffectiveTagRefs{Values: []repo.Tag{}, Inherited: eff.Arranger.Inherited}
	if len(eff.Arranger.IDs) > 0 {
		people, err := repo.PeopleByIDs(ctx, q, eff.Arranger.IDs)
		if err != nil {
			return nil, err
		}
		resp.Arranger.Values = people
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
	ID        int64  `json:"id"`
	BookTitle string `json:"bookTitle"`
	// Composer/Arranger (composer/arranger overhaul, migration 00020):
	// ordered, plain []repo.Tag — no Effective* wrapper, since Book is the
	// top of the inheritance chain (nothing to fall back to), matching how
	// Instruments below already works for Book.
	Composer []repo.Tag `json:"composer"`
	Arranger []repo.Tag `json:"arranger"`
	// YearPublished (renamed from YearWritten, migration 00022, Public
	// Domain Badge feature) — when this edition was published, not when
	// the piece was composed.
	YearPublished  *string   `json:"yearPublished"`
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
	// CopyrightYear/CopyrightHolder/CopyrightSlug/CopyrightStatus (Public
	// Domain Badge feature, migration 00022) — plain Book columns, no
	// Effective* wrapper (Book is the inheritance root, same as
	// Composer/Arranger/Instruments above). CopyrightStatus is one of
	// 'publicDomain'/'copyleft'/'likelyPublicDomain'/'inCopyright', or nil
	// — a Book has no live-computed default to fall back to for display
	// (see repo.ResolveCopyrightStatus's own comment), so unlike Piece
	// there's no separate "effective" status to also expose here.
	CopyrightYear   *int    `json:"copyrightYear"`
	CopyrightHolder *string `json:"copyrightHolder"`
	CopyrightSlug   *string `json:"copyrightSlug"`
	CopyrightStatus *string `json:"copyrightStatus"`
}

func BuildBookResponse(ctx context.Context, q repo.Queryer, b *models.Book) (*BookResponse, error) {
	resp := &BookResponse{
		ID:               b.ID,
		BookTitle:        b.BookTitle,
		Composer:         []repo.Tag{},
		Arranger:         []repo.Tag{},
		YearPublished:    b.YearPublished,
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
		CopyrightYear:    b.CopyrightYear,
		CopyrightHolder:  b.CopyrightHolder,
		CopyrightSlug:    b.CopyrightSlug,
		CopyrightStatus:  b.CopyrightStatus,
	}

	if len(b.ComposerIDs) > 0 {
		people, err := repo.PeopleByIDs(ctx, q, b.ComposerIDs)
		if err != nil {
			return nil, err
		}
		resp.Composer = people
	}
	if len(b.ArrangerIDs) > 0 {
		people, err := repo.PeopleByIDs(ctx, q, b.ArrangerIDs)
		if err != nil {
			return nil, err
		}
		resp.Arranger = people
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
	Title string `json:"title"`
	// Composers/Arrangers (composer/arranger overhaul, migration 00020):
	// ordered names, same full-replace-by-name convention as Keys/
	// Instruments/UserTags below — resolved server-side via
	// repo.FindOrCreatePerson, preserving submission order as credit order.
	Composers      []string `json:"composers"`
	Arrangers      []string `json:"arrangers"`
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
	// CopyrightYear/CopyrightHolder/CopyrightSlug/CopyrightStatus (Public
	// Domain Badge feature, migration 00022) — full-replace like every
	// other field here, book-inheritable. CopyrightStatus is validated
	// against the same four-value CHECK constraint the DB enforces
	// (checkCopyrightStatus, validate.go).
	CopyrightYear   *int    `json:"copyrightYear"`
	CopyrightHolder *string `json:"copyrightHolder"`
	CopyrightSlug   *string `json:"copyrightSlug"`
	CopyrightStatus *string `json:"copyrightStatus"`
}

// BookCreateRequest is the Books library view's "New Book" button
// submission shape — creating a Book with no underlying file, distinct
// from the upload/import wizard's POST /api/books (which always requires
// a real PDF). Deliberately narrower than BookWriteRequest: only the
// fields a book can meaningfully have before any pieces exist to classify
// it by (no sheet type/instruments/opus/IMSLP/description/ISBN here).
// Arrangers is included alongside Composers, unlike those others — since
// ValidateBook now requires one of the two, leaving arranger out here would
// make that requirement satisfiable only via composer at creation time.
type BookCreateRequest struct {
	BookTitle     string   `json:"bookTitle"`
	Composers     []string `json:"composers"`
	Arrangers     []string `json:"arrangers"`
	Publisher     *string  `json:"publisher"`
	YearPublished *string  `json:"yearPublished"`
}

// BookWriteRequest is the Book Properties Edit Menu's submission shape
// (design doc §16). BookTitle is required, and so is one of
// Composers/Arrangers (ValidateBook) — no other field is.
type BookWriteRequest struct {
	BookTitle      string   `json:"bookTitle"`
	Composers      []string `json:"composers"`
	Arrangers      []string `json:"arrangers"`
	YearPublished  *string  `json:"yearPublished"`
	WorkOpusNumber *string  `json:"workOpusNumber"`
	SheetTypeName  *string  `json:"sheetTypeName"`
	Publisher      *string  `json:"publisher"`
	PublisherID    *string  `json:"publisherId"`
	Description    *string  `json:"description"`
	ImslpNumber    *string  `json:"imslpNumber"`
	// ISBN follows the same normalize-on-write treatment as IMSLP number's
	// prefix (handleUpdateBook's normalizeISBN) — plain digits stored,
	// whatever punctuation/label the user typed.
	ISBN        *string  `json:"isbn"`
	Instruments []string `json:"instruments"`
	// CopyrightYear/CopyrightHolder/CopyrightSlug/CopyrightStatus (Public
	// Domain Badge feature, migration 00022) — full-replace like every
	// other field here. CopyrightStatus is validated against the same
	// four-value CHECK constraint the DB enforces (checkCopyrightStatus,
	// validate.go).
	CopyrightYear   *int    `json:"copyrightYear"`
	CopyrightHolder *string `json:"copyrightHolder"`
	CopyrightSlug   *string `json:"copyrightSlug"`
	CopyrightStatus *string `json:"copyrightStatus"`
}

// PersonResponse is the wire shape for a Person (composer/arranger
// overhaul, migration 00020) — "should be very minimal" per the original
// brief: Name, Bio, BirthYear, DeathYear, plus an optional custom portrait
// (mirrors Book's own HasCustomCover/CoverImageHash pair exactly) and a
// PieceCount for the People Library's own listing and its default
// >2-piece filter.
type PersonResponse struct {
	ID                int64     `json:"id"`
	Name              string    `json:"name"`
	Bio               *string   `json:"bio"`
	BirthYear         *int      `json:"birthYear"`
	DeathYear         *int      `json:"deathYear"`
	HasCustomPortrait bool      `json:"hasCustomPortrait"`
	PortraitImageHash *string   `json:"portraitImageHash"`
	PieceCount        int       `json:"pieceCount"`
	CreatedAt         time.Time `json:"createdAt"`
}

func BuildPersonResponse(ctx context.Context, q repo.Queryer, p *models.Person) (*PersonResponse, error) {
	count, err := repo.CountPiecesForPerson(ctx, q, p.ID)
	if err != nil {
		return nil, err
	}
	return &PersonResponse{
		ID:                p.ID,
		Name:              p.Name,
		Bio:               p.Bio,
		BirthYear:         p.BirthYear,
		DeathYear:         p.DeathYear,
		HasCustomPortrait: p.PortraitImageHash != nil,
		PortraitImageHash: p.PortraitImageHash,
		PieceCount:        count,
		CreatedAt:         p.CreatedAt,
	}, nil
}

// PersonCreateRequest is the People Library's "New Person" button
// submission shape — deliberately narrower than PersonWriteRequest (no
// Bio), same "New Book" convention as BookCreateRequest vs.
// BookWriteRequest: only what's needed before real content exists.
type PersonCreateRequest struct {
	Name      string `json:"name"`
	BirthYear *int   `json:"birthYear"`
	DeathYear *int   `json:"deathYear"`
}

// PersonWriteRequest is the Edit Person modal's submission shape — full
// replace, same convention as every other edit-menu write request in this
// app.
type PersonWriteRequest struct {
	Name      string  `json:"name"`
	Bio       *string `json:"bio"`
	BirthYear *int    `json:"birthYear"`
	DeathYear *int    `json:"deathYear"`
}

// PersonSplitRequest is Split People's submission shape — an ordered list
// of replacement names (Calibre-style pick-existing-or-type-new, resolved
// server-side via repo.FindOrCreatePerson, same as every other tag-like
// field). At least one name is required — checked in the handler, not
// here, since an empty list isn't really a "bad request" so much as
// "nothing to do."
type PersonSplitRequest struct {
	ReplacementNames []string `json:"replacementNames"`
}
