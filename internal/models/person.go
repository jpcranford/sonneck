package models

import "time"

// Person is a composer/arranger credit, shared across Piece and Book
// (composer/arranger overhaul — see CLAUDE.md's "Open items" note).
// "Should be very minimal" per the original brief: name plus an optional
// bio/birth/death year and an optional custom portrait, nothing else.
type Person struct {
	ID   int64
	Name string

	Bio       *string
	BirthYear *int
	DeathYear *int
	CreatedAt time.Time

	// PortraitImageHash/PortraitImageContentType: a manually uploaded
	// custom portrait, mirroring Book.CoverImageHash/CoverImageContentType
	// exactly (migration 00018) — both nil together means "no custom
	// portrait," the common case, falling back to an initials/bust
	// placeholder on the frontend.
	PortraitImageHash        *string
	PortraitImageContentType *string
}
