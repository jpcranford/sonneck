package models

import "time"

// PracticeStatus values (design doc §3) — a fixed app-level enum, not a
// relational lookup table, since there's no indication these need runtime
// editing the way Key/SheetType do.
const (
	PracticeStatusWantToLearn = "Want to Learn"
	PracticeStatusLearning    = "Learning"
	PracticeStatusLearned     = "Learned"
	PracticeStatusStalled     = "Stalled"
	PracticeStatusDropped     = "Dropped"
)

// Piece is the app's core unit (design doc §3). Fields marked
// "book-inheritable" below fall back to the source Book's value when empty —
// see ResolveEffective in this package's sibling repo package, which is the
// only place that fallback should be computed.
type Piece struct {
	ID    int64
	Title string // never book-inheritable

	Composer       *string // book-inheritable
	Arranger       *string
	Favorite       bool
	WorkOpusNumber *string // book-inheritable
	SheetTypeID    *int64  // book-inheritable
	Publisher      *string // book-inheritable
	PublisherID    *string // book-inheritable
	YearWritten    *string // book-inheritable
	Description    *string // book-inheritable
	UserNotes      *string
	PracticeStatus *string
	ImslpNumber    *string // book-inheritable

	SourceBookID    *int64
	SourcePageStart *int
	SourcePageEnd   *int

	Duration        *int
	BPM             *int
	MeasureCount    *int
	BeatsPerMeasure *int

	FilePath  string
	FileHash  string
	PageCount int // total pages in FilePath, for the Library card page-cycle control

	// Deliberate pre-build exception (CLAUDE.md > Database migrations):
	// unused until the public-domain badge feature (design doc §13) lands.
	CopyrightYear *int
	PublicDomain  bool

	CreatedAt time.Time
	UpdatedAt time.Time

	// Loaded separately via join tables, not columns on `pieces`. KeyIDs
	// (many-to-many, not book-inheritable — a piece can genuinely be
	// written in more than one key) moved here from a single KeyID column;
	// see migration 00008.
	KeyIDs        []int64
	InstrumentIDs []int64
	UserTagIDs    []int64
}
