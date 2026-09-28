// Package setlistpdf generates the "Download Set PDF" export for a
// Setlist — a cover page, a table of contents, one generated stand-in page
// per custom (non-piece) entry, and a colophon, concatenated with each
// piece entry's own real PDF pages into one merged document.
//
// The four generated page types are drawn via codeberg.org/go-pdf/fpdf
// (the maintained continuation of the archived jung-kurt/gofpdf). Merging
// those generated pages with each piece's own real PDF file is done via
// poppler's pdfunite (internal/pdf.Merge), not an in-process PDF-import
// library — an earlier version used fpdf's own contrib/gofpdi sub-package
// to import a piece's pages directly, and that panicked on an entirely
// ordinary real-world PDF (see CLAUDE.md > Setlists and this project's
// plan file for the full story); pdfunite handles real-world files far
// more robustly and, since poppler-utils is already a dependency this app
// bundles everywhere, cost nothing new to add.
package setlistpdf

// Shape is the physical page size used for the four generated page
// types — a real piece's own imported PDF pages keep their own original
// size untouched regardless of this setting.
type Shape string

const (
	ShapeLetter Shape = "Letter"
	ShapeA4     Shape = "A4"
)

// ShapeForRegion maps a library's configured copyright region to the page
// shape the design pass locked: Letter for en-US/ca, A4 for eu-generic/
// en-GB. An unrecognized region falls back to Letter rather than erroring
// — this is a read-only export, not a place to fail a request over a
// cosmetic default.
func ShapeForRegion(region string) Shape {
	switch region {
	case "eu-generic", "en-GB":
		return ShapeA4
	default:
		return ShapeLetter
	}
}

// Entry is one resolved row of a setlist's program — either a real piece
// (FilePath/PageCount describe its own real PDF pages to import verbatim)
// or a custom, non-piece entry (drawn as a single generated stand-in
// page). Exactly one of the piece/custom field groups is meaningful,
// mirroring the DB's own XOR constraint on setlist_entries.
type Entry struct {
	IsPiece       bool
	DisplayNumber *int // nil for a non-counting entry (renders "–" in the TOC)

	// Piece fields, meaningful only when IsPiece is true.
	PieceTitle     string
	PieceRole      *string  // the entry's own role label, e.g. "Anthem"
	PieceKeys      []string // e.g. ["Eb"]; more than one for a modulating piece
	PieceDuration  *int     // seconds
	PieceFilePath  string
	PiecePageCount int

	// Custom fields, meaningful only when IsPiece is false.
	CustomName            string
	CustomRole            *string
	CustomDurationSeconds *int
	CustomNotes           *string
}

// Layout is the deterministic page plan for one export, computed once
// before any drawing happens: every generated page's place in the packet,
// and — critically — the page each program entry's own content begins
// on, which the table of contents has to already know before it's drawn.
type Layout struct {
	TOCPageCount   int
	EntryStartPage []int // parallel to the entries slice; 1-indexed, packet-wide
	ColophonPage   int
	TotalPages     int
}

// ComputeLayout walks entries in order and returns the full page plan for
// a table of contents tocPages long (measured by planTOC — see Paginate).
// Page 1 is always the cover; TOC pages follow; then each entry consumes
// either its own real PageCount (a piece) or exactly one page (a custom
// entry, generated); the colophon is the final page.
func ComputeLayout(entries []Entry, tocPages int) Layout {
	tocPages = max(tocPages, 1)

	starts := make([]int, len(entries))
	page := 1 + tocPages // last page number consumed by cover + TOC
	for i, e := range entries {
		page++
		starts[i] = page
		if e.IsPiece && e.PiecePageCount > 1 {
			page += e.PiecePageCount - 1
		}
	}

	colophon := page + 1
	return Layout{
		TOCPageCount:   tocPages,
		EntryStartPage: starts,
		ColophonPage:   colophon,
		TotalPages:     colophon,
	}
}

// TotalDurationSeconds sums every entry's own duration (piece or custom)
// that's actually set. Returns nil — never a misleading 0 — when no entry
// anywhere in the program has one, matching this app's own established
// "omit, don't fake a zero" convention for this exact stat elsewhere in
// the Setlists feature (see CLAUDE.md > Setlists).
func TotalDurationSeconds(entries []Entry) *int {
	total := 0
	any := false
	for _, e := range entries {
		var d *int
		if e.IsPiece {
			d = e.PieceDuration
		} else {
			d = e.CustomDurationSeconds
		}
		if d != nil {
			total += *d
			any = true
		}
	}
	if !any {
		return nil
	}
	return &total
}

// TotalPageCount sums only piece entries' own real page counts — matches
// this app's established "pages of music" convention (CLAUDE.md >
// Setlists), which a custom entry's own single generated page is
// deliberately excluded from, distinct from Layout.TotalPages (every page
// in the actual merged packet, generated pages included).
func TotalPageCount(entries []Entry) int {
	total := 0
	for _, e := range entries {
		if e.IsPiece {
			total += e.PiecePageCount
		}
	}
	return total
}
