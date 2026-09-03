package models

import "time"

// Book is an entirely optional grouping construct for pieces that share a
// source (design doc §3) — never required, and never denormalized onto
// Piece. It's the inheritance source for Piece's book-inheritable fields.
//
// OriginalFilename/FilePath/FileHash are all nullable (migration 00014):
// a Book usually comes from the upload/import wizard (design doc §5),
// which always has a real file, but a manually created Book (the Books
// library view's "New Book" button) has none — it's a placeholder record
// with no pieces and nothing to render a thumbnail from until/unless a
// real file is attached some other way. All three are nil together or not
// at all; there's no state where only one of them is set.
type Book struct {
	ID        int64
	BookTitle string
	// YearPublished (renamed from YearWritten, migration 00022, Public
	// Domain Badge feature): when this edition was published, not when the
	// piece itself was composed. Still book-inheritable to a Piece's own
	// YearWritten, unchanged — see CopyrightYear below for the field that
	// took over YearWritten's old inheritance-source column name's spirit.
	YearPublished  *string
	WorkOpusNumber *string
	SheetTypeID    *int64
	Publisher      *string
	PublisherID    *string
	Description    *string
	ImslpNumber    *string
	// CopyrightYear/CopyrightHolder/CopyrightSlug/CopyrightStatus
	// (migration 00022, Public Domain Badge feature) — CopyrightYear is
	// one-time backfilled from the old YearWritten value at migration time
	// (see that migration's own comment), independently editable from then
	// on. All four are the inheritance source for a Piece's own
	// same-named fields; CopyrightStatus is one of 'publicDomain' /
	// 'copyleft' / 'likelyPublicDomain' / 'inCopyright', or nil (unset —
	// see repo.ResolveCopyrightStatus for what "unset" resolves to).
	CopyrightYear   *int
	CopyrightHolder *string
	CopyrightSlug   *string
	CopyrightStatus *string
	// CopyrightRenewed: US renewal follow-up (migration 00023) — the
	// inheritance source for a Piece's own same-named field. See
	// models.Piece.CopyrightRenewed's own comment for the full reasoning.
	CopyrightRenewed *bool
	// ISBN (migration 00017): plain digits only, no hyphens — a possible
	// trailing "X" check digit (ISBN-10) is the one non-digit character it
	// can legitimately hold. Hyphenation for display is computed from this
	// at read time (frontend, and buildCitation's own formatter), never
	// stored. Book-only — there's no per-Piece ISBN or inheritance concept
	// for it, unlike composer/publisher/imslpNumber etc.
	ISBN             *string
	OriginalFilename *string
	FilePath         *string
	FileHash         *string
	// CoverImageHash/CoverImageContentType (migration 00018): a manually
	// uploaded custom cover, independent of FilePath/FileHash — set via a
	// dedicated endpoint (handleUploadBookCover), not the general Book edit
	// write path, same "separate small action endpoint" treatment as
	// Piece.ThumbnailPage. Overrides the derived first-page-of-PDF
	// thumbnail when present; both nil means "no custom cover," which is
	// the common case. Independent of FilePath being nil or not — a book
	// with no original PDF at all can still have a custom cover.
	CoverImageHash        *string
	CoverImageContentType *string
	ImportedAt            time.Time

	// Loaded separately via join tables. ComposerIDs/ArrangerIDs (ordered —
	// composer/arranger overhaul, migration 00020) moved here from plain
	// string columns; Book is the top of the inheritance chain, so these
	// are never themselves a fallback target, only a source.
	InstrumentIDs []int64
	ComposerIDs   []int64 // ordered
	ArrangerIDs   []int64 // ordered
}
