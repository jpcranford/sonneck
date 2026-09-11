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
	// CopyrightRenewed: US renewal follow-up — book-inheritable, same
	// EffectiveBoolField shape every other Piece-level boolean-ish field
	// would use. Only ever meaningful (shown/edited) client-side for an
	// en-US CopyrightYear in 1923-1963 — see COPYRIGHT_REGION's own
	// /api/config exposure and repo.EffectiveBoolField's doc comment.
	CopyrightRenewed repo.EffectiveBoolField `json:"copyrightRenewed"`
	CreatedAt        time.Time               `json:"createdAt"`
	UpdatedAt        time.Time               `json:"updatedAt"`
}

// BuildPieceResponse resolves p's effective values and every referenced
// tag's display name, in the fewest queries reasonable for v1's scale.
// region (Public Domain Badge feature) is the validated COPYRIGHT_REGION
// config value — every caller is a handler method with s.Cfg in scope.
// userID (multi-user support, migration 00025) scopes the now-per-user
// favorite/userNotes/practiceStatus fields, and which of the piece's own
// UserTags are visible at all (repo.UserTagsByIDsForUser) — every caller is
// a handler method with the request's authenticated user in scope.
func BuildPieceResponse(ctx context.Context, q repo.Queryer, p *models.Piece, region string, userID int64) (*PieceResponse, error) {
	eff, err := repo.ResolveEffective(ctx, q, p)
	if err != nil {
		return nil, err
	}
	copyrightEffective, copyrightExpiryYear, _, err := repo.ResolveCopyrightStatus(ctx, q, eff, region)
	if err != nil {
		return nil, err
	}
	userData, err := repo.GetUserPieceData(ctx, q, userID, p.ID)
	if err != nil {
		return nil, err
	}

	resp := &PieceResponse{
		ID:              p.ID,
		Title:           p.Title,
		Favorite:        userData.Favorite,
		WorkOpusNumber:  eff.WorkOpusNumber,
		Publisher:       eff.Publisher,
		PublisherID:     eff.PublisherID,
		YearWritten:     eff.YearWritten,
		Description:     eff.Description,
		UserNotes:       userData.UserNotes,
		PracticeStatus:  userData.PracticeStatus,
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
		CopyrightRenewed: eff.CopyrightRenewed,
		Duration:         p.Duration,
		BPM:              p.BPM,
		MeasureCount:     p.MeasureCount,
		BeatsPerMeasure:  p.BeatsPerMeasure,
		FileHash:         p.FileHash,
		PageCount:        p.PageCount,
		ThumbnailPage:    p.ThumbnailPage,
		CreatedAt:        p.CreatedAt,
		UpdatedAt:        p.UpdatedAt,
		Keys:             []repo.Tag{},
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

	// UserTagsByIDsForUser, not the generic TagsByIDs every other tag field
	// uses — user_tags became a private per-user vocabulary (migration
	// 00025), so a piece's own UserTagIDs can legitimately include another
	// user's private tag (piece_user_tags itself carries no user_id column
	// of its own); those must never surface in a response built for anyone
	// but that tag's own owner.
	resp.UserTags = []repo.Tag{}
	if len(p.UserTagIDs) > 0 {
		tags, err := repo.UserTagsByIDsForUser(ctx, q, userID, p.UserTagIDs)
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
	// CopyrightRenewed: US renewal follow-up — plain nullable bool, same
	// "no Effective* wrapper" treatment as the four fields above (Book is
	// the inheritance root). nil means "not explicitly set here," same
	// meaning as every other nullable Book field, not "confirmed not
	// renewed" — see models.Book.CopyrightRenewed's own doc comment.
	CopyrightRenewed *bool `json:"copyrightRenewed"`
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
		CopyrightRenewed: b.CopyrightRenewed,
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
	// CopyrightRenewed: US renewal follow-up — full-replace like every
	// other field here, book-inheritable.
	CopyrightRenewed *bool `json:"copyrightRenewed"`
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
	// CopyrightRenewed: US renewal follow-up — full-replace like every
	// other field here.
	CopyrightRenewed *bool `json:"copyrightRenewed"`
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

// ConfigResponse is GET /api/config's shape — a deliberately narrow slice
// of server config the frontend needs at runtime (CLAUDE.md > Config).
// AuthMethod is already resolved (env var wins, else the stored
// first-launch choice, else "none" — the frontend never re-derives this
// order itself); AuthMethodSetByEnv tells the Security step whether to
// show the picker at all or a locked "set by environment variable" state,
// same convention the Admin Settings screen's own env-var-shadowed fields
// use. DataDir is only ever populated while first-launch hasn't
// completed yet — the Library Folder step's own confirmation display, not
// exposed once setup is done and there's no more reason for an unauthenticated
// endpoint to keep announcing a host filesystem path.
type ConfigResponse struct {
	CopyrightRegion      string  `json:"copyrightRegion"`
	AuthMethod           string  `json:"authMethod"`
	AuthMethodSetByEnv   bool    `json:"authMethodSetByEnv"`
	FirstLaunchCompleted bool    `json:"firstLaunchCompleted"`
	DataDir              *string `json:"dataDir,omitempty"`
	// BuildTarget — "docker" or "native", ldflags-injected at build time
	// exactly like BuildSHA/BuildDate (project_wails_native_app_investigation
	// memory's Phase 3, locked 2026-09-11) — the one signal every
	// native-only UI branch (First Launch's real folder picker, Admin
	// Settings' Share on Network / reset-library-location) gates on.
	BuildTarget string `json:"buildTarget"`
	// OIDCProviderName — only meaningful when AuthMethod is
	// "oidc"; drives LoginScreen.tsx's "Sign in with {name}" button text.
	OIDCProviderName *string `json:"oidcProviderName,omitempty"`
	// AuthChangePending — non-nil means the resolved auth
	// method no longer matches what the app last ran under (an operator
	// changed AUTH_METHOD since the previous boot). App.tsx gates on this
	// exactly parallel to FirstLaunchCompleted, rendering AuthChangeFlow
	// instead of the normal routes until it's resolved.
	AuthChangePending *AuthChangePendingResponse `json:"authChangePending"`
}

// AuthChangePendingResponse carries enough for the frontend to render the
// right step sequence upfront (AuthChangeFlow.tsx's own computeSteps, a
// direct port of AuthChangeFlowMockup.tsx's), without a round trip just to
// find out — NeedsPassword/MultiAccount are cheap to compute alongside the
// mismatch check itself (handleGetConfig).
type AuthChangePendingResponse struct {
	From string `json:"from"`
	To   string `json:"to"`
	// NeedsPassword is true when To is "singlepass" and no account that
	// could remain already has a password set — with more than one
	// existing account this is conservatively always true (almost every
	// real case, since an OIDC-sourced account never has one), and the
	// completion endpoint simply won't use a submitted password if it
	// turns out the actual survivor already had one.
	NeedsPassword bool `json:"needsPassword"`
	// MultiAccount is true when downgrading away from oidc with more than
	// one existing account — gates whether the choose-admin/confirm-delete
	// steps apply at all.
	MultiAccount bool `json:"multiAccount"`
}

// AuthChangeCandidateResponse is one entry in GET /api/auth-change/
// candidates' list — despite the name, every existing account, not just
// the admin-eligible ones: the choose-admin step's own radio list still
// only offers whichever entries have IsAdmin true, but confirm-delete
// needs the complete account list to correctly report *everyone* who's
// actually about to be deleted (repo.ApplyAuthChangeDowngrade's own
// `DELETE FROM users WHERE id != 1` has no admin-only carve-out — a
// non-admin household member's account is just as gone). Filtering this
// response to admins-only server-side was the original shape and a real
// bug: confirm-delete's own "following N accounts will be deleted" count
// silently excluded every non-admin account, capable of reading as "0
// accounts" when only one admin existed among several total accounts. No
// email/avatar field — unlike the AuthChangeFlowMockup.tsx reference this
// ports, models.User carries no email at all, and the survivor's avatar is
// cleared during the downgrade regardless (repo.ApplyAuthChangeDowngrade),
// so it wouldn't outlive the choice anyway.
type AuthChangeCandidateResponse struct {
	ID          int64  `json:"id"`
	DisplayName string `json:"displayName"`
	IsAdmin     bool   `json:"isAdmin"`
}

// AuthChangeCompleteRequest is POST /api/auth-change/complete's body.
// Password is required only when the pending transition's target is
// singlepass and the account that will remain has no password_hash yet;
// KeepUserID is required only when more than one account currently exists
// and the target is none/singlepass. The handler re-derives which fields
// are actually needed from server-side state — it never trusts the client
// to have sent only what applies.
type AuthChangeCompleteRequest struct {
	Password   *string `json:"password"`
	KeepUserID *int64  `json:"keepUserId"`
}

// SetupCompleteRequest is the first-time launch flow's Security step
// submission shape. Password is required (and validated) only when
// AuthMethod is "singlepass" — nil otherwise.
type SetupCompleteRequest struct {
	AuthMethod string  `json:"authMethod"`
	Password   *string `json:"password"`
}

// LoginRequest is POST /api/auth/login's body — singlepass mode's only
// login UI (`none` has no login, `oidc` redirects to the IdP instead).
type LoginRequest struct {
	Password string `json:"password"`
}

// AuthMeResponse is GET /api/auth/me's shape — the frontend's one source of
// truth for "who am I, what can I do, how is this server configured for
// login" (route guards, the sidebar user menu).
type AuthMeResponse struct {
	ID          int64    `json:"id"`
	DisplayName string   `json:"displayName"`
	Permissions []string `json:"permissions"`
	AuthMethod  string   `json:"authMethod"`
	// AvatarURL — nil for none/singlepass, and for an OIDC
	// account whose IdP never supplied a "picture" claim.
	AvatarURL *string `json:"avatarUrl"`
}

// AdminUserResponse is one row in Admin Settings' Users screen.
// IsLastAdmin drives the frontend's own lock on removing this user's admin
// permission or deleting them outright — the same guard the backend itself
// enforces server-side (never trust the client to have actually respected
// the disabled UI state).
type AdminUserResponse struct {
	ID          int64    `json:"id"`
	DisplayName string   `json:"displayName"`
	Permissions []string `json:"permissions"`
	IsLastAdmin bool     `json:"isLastAdmin"`
}

// SetUserPermissionsRequest is PATCH /api/admin/users/{id}'s body — a full
// replace of the permission set (an independent multi-select checklist,
// not incremental add/remove).
type SetUserPermissionsRequest struct {
	Permissions []string `json:"permissions"`
}

// AdminSecurityRequest is POST /api/admin/security's body — see that
// endpoint's own doc comment (internal/handlers/admin.go) for the full
// none/singlepass-only scope this reaches.
type AdminSecurityRequest struct {
	AuthMethod string  `json:"authMethod"`
	Password   *string `json:"password"`
}

// LookupCreateRequest/LookupRenameRequest are the admin Lookup Tables'
// (Sheet Types/Instruments) create/rename bodies — both just a name, same
// shape as the user-scoped Tags/Practice Status equivalents below.
type LookupCreateRequest struct {
	Name string `json:"name"`
}

type LookupRenameRequest struct {
	Name string `json:"name"`
}

// LookupDeleteRequest is every merge-or-delete-outright endpoint's shared
// body shape (admin Lookup Tables, user Tags, user Practice Status) —
// MergeIntoID present means reassign-then-delete, absent means delete
// outright.
type LookupDeleteRequest struct {
	MergeIntoID *int64 `json:"mergeIntoId"`
}

// UpdateMeRequest is PATCH /api/auth/me's body — User Settings' Account
// card self-rename. No permission beyond being
// authenticated is needed; a user can only ever rename themselves.
type UpdateMeRequest struct {
	DisplayName string `json:"displayName"`
}

// ChangePasswordRequest is POST /api/auth/change-password's body — User
// Settings' Account card "Change Password" action, singlepass only.
// Distinct from AdminSecurityRequest's admin-only set-or-clear: this
// always requires the caller's own CurrentPassword, since it's
// self-service rather than an admin acting on someone else's account.
type ChangePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

// LibraryCountsResponse backs Admin Settings' "Library" stat cards.
type LibraryCountsResponse struct {
	Pieces int `json:"pieces"`
	Books  int `json:"books"`
	People int `json:"people"`
}

// LibrarySettingsResponse/UpdateLibrarySettingsRequest back Admin Settings'
// "Library Settings" card — a second deliberate exception to CLAUDE.md >
// Config's "no settings table in v1" (server_settings/auth_method was the
// first): these 4 fields persist to DATA_DIR/config.yml
// (internal/libraryconfig) instead, not SQLite. Each field's own *SetByEnv
// flag drives the frontend's "Set by environment variable" pill — same
// convention GET /api/config's AuthMethodSetByEnv already established.
// UpdateLibrarySettingsRequest is a full-replace body (this app's usual
// PATCH convention) — a field currently env-set is accepted only if its
// submitted value matches what's already in effect (the frontend never
// renders that field as editable, so it always just echoes the current
// value back); a genuine attempted change to an env-locked field is a 409.
type LibrarySettingsResponse struct {
	BackupCron                  string `json:"backupCron"`
	BackupCronSetByEnv          bool   `json:"backupCronSetByEnv"`
	BackupRetentionDays         int    `json:"backupRetentionDays"`
	BackupRetentionDaysSetByEnv bool   `json:"backupRetentionDaysSetByEnv"`
	LogLevel                    string `json:"logLevel"`
	LogLevelSetByEnv            bool   `json:"logLevelSetByEnv"`
	CopyrightRegion             string `json:"copyrightRegion"`
	CopyrightRegionSetByEnv     bool   `json:"copyrightRegionSetByEnv"`
}

type UpdateLibrarySettingsRequest struct {
	BackupCron          string `json:"backupCron"`
	BackupRetentionDays int    `json:"backupRetentionDays"`
	LogLevel            string `json:"logLevel"`
	CopyrightRegion     string `json:"copyrightRegion"`
}

// VersionResponse backs Admin Settings' Version section.
// MatchedRelease/CheckStatus/AvailableVersion/CheckedAt
// are all nil until a check has actually run this process's lifetime (a
// background check kicks one off lazily on the first real page view, and
// "Check for updates" forces a fresh one when the cache is stale) — the
// frontend shows the honest SHA-only "Dev build, from commit..." fallback
// until then, never a guessed result.
//
// RunningFromSource is true when this binary has no injected build
// identity at all — running via `go run`/a plain `go build` straight from
// the repo (every session's own dev-loop, not just a hypothetical), rather
// than the Docker image's ldflags-injected commit SHA. No GitHub check
// ever runs in this case (there's no real commit to compare), and the
// frontend shows plain "Running from source" copy instead of a
// nonsensical "Dev build, from commit dev on unknown" line.
type VersionResponse struct {
	RunningSHA        string  `json:"runningSHA"`
	RunningDate       string  `json:"runningDate"`
	RunningFromSource bool    `json:"runningFromSource"`
	MatchedRelease    *string `json:"matchedRelease"`
	CheckStatus       *string `json:"checkStatus"`
	AvailableVersion  *string `json:"availableVersion,omitempty"`
	CheckedAt         *string `json:"checkedAt,omitempty"`
}

// BuildAuthMeResponse has no DB access of its own (unlike BuildPieceResponse)
// — user already carries everything needed (GetUserByID loads permissions
// alongside the row), so this is a pure mapping, not a resolver. Kept as a
// function rather than inlined at each of handleLogin/handleGetMe's two call
// sites so the shape can't drift between them. err is always nil today;
// returned for symmetry with this file's other Build* functions and in case
// a future field needs a query.
func BuildAuthMeResponse(user *models.User, authMethod string) (*AuthMeResponse, error) {
	perms := user.Permissions
	if perms == nil {
		perms = []string{}
	}
	return &AuthMeResponse{
		ID:          user.ID,
		DisplayName: user.DisplayName,
		Permissions: perms,
		AuthMethod:  authMethod,
		AvatarURL:   user.AvatarURL,
	}, nil
}

// NativeSettingsResponse backs Admin Settings' "Share on Network"/"Library
// location" cards on a native build only (project_wails_native_app_
// investigation memory's Phase 7) — GET 404s outright on Docker
// (BuildTarget != "native"), since none of this is meaningful there.
//
// ShareOnNetwork/LibraryPath are the *persisted* choice (nativeconfig.json,
// what a restart will apply); AppliedShareOnNetwork/AppliedLibraryPath are
// what this running process actually booted with — a real restart is the
// only thing that ever moves the Applied* pair, mirroring the already-
// locked "restart required, not live-rebind" decision (Phase 4). The
// frontend diffs the two pairs itself to render the same restart-pending
// banner/status-pill honesty the approved mockup already built.
// PendingLibraryPath is non-empty exactly when a library-location change
// is waiting on a restart to actually move/repoint (nil once applied).
type NativeSettingsResponse struct {
	ShareOnNetwork        bool     `json:"shareOnNetwork"`
	AppliedShareOnNetwork bool     `json:"appliedShareOnNetwork"`
	LibraryPath           string   `json:"libraryPath"`
	PendingLibraryPath    *string  `json:"pendingLibraryPath,omitempty"`
	Port                  string   `json:"port"`
	LocalIPs              []string `json:"localIPs"`
}

// UpdateNativeSettingsRequest is a partial-update body (unlike this app's
// usual full-replace PATCH convention) — Share on Network and Library
// location are two independent controls on the page that never submit
// together, and Share on Network specifically must persist on every single
// toggle click regardless of whether Library location has ever been
// touched (Phase 4's locked design: persisting is decoupled from
// applying). LibraryPath/MoveExisting only take effect together — setting
// LibraryPath without MoveExisting means "just point there," matching the
// approved mockup's own two-choice modal.
type UpdateNativeSettingsRequest struct {
	ShareOnNetwork *bool   `json:"shareOnNetwork,omitempty"`
	LibraryPath    *string `json:"libraryPath,omitempty"`
	MoveExisting   bool    `json:"moveExisting,omitempty"`
}

// ChooseFolderResponse is empty-Path (not an error) when the user cancels
// the native OS folder dialog — a cancel is a normal, expected outcome, not
// a failure.
type ChooseFolderResponse struct {
	Path string `json:"path"`
}
