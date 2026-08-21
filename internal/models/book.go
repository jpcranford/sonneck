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
	ID             int64
	BookTitle      string
	Composer       *string
	Arranger       *string
	YearWritten    *string
	WorkOpusNumber *string
	SheetTypeID    *int64
	Publisher      *string
	PublisherID    *string
	Description    *string
	ImslpNumber    *string
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
	ImportedAt       time.Time

	// Loaded separately via the book_instruments join table.
	InstrumentIDs []int64
}
