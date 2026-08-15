package models

import "time"

// Book is an entirely optional grouping construct for pieces that share a
// source (design doc §3) — never required, and never denormalized onto
// Piece. It's the inheritance source for Piece's book-inheritable fields.
type Book struct {
	ID               int64
	BookTitle        string
	Composer         *string
	YearWritten      *string
	WorkOpusNumber   *string
	SheetTypeID      *int64
	Publisher        *string
	PublisherID      *string
	Description      *string
	ImslpNumber      *string
	OriginalFilename string
	FilePath         string
	FileHash         string
	ImportedAt       time.Time

	// Loaded separately via the book_instruments join table.
	InstrumentIDs []int64
}
