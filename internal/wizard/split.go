// Package wizard holds the import wizard's split-step logic (design doc
// §5 step 2): validating the user's marked page ranges for each
// prospective Piece.
package wizard

import "fmt"

// PageRange is an inclusive, 1-indexed page range for one prospective
// Piece. JSON-tagged so it doubles as the wire type for
// ConfirmImportRequest.Ranges directly.
type PageRange struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

// ValidateRanges checks a client-supplied list of per-piece page ranges
// against a book's actual page count. The ranges themselves are computed
// client-side (the Split screen's own tap/drag UI already does this,
// including skip pages and a page shared between two adjacent pieces) —
// this is a validator, not a deriver: it doesn't compute anything, it
// confirms what was sent is structurally sound before any PDF extraction
// happens.
//
// This is the logic CLAUDE.md > Testing calls out as non-optional: a wrong
// page range is a silent, permanent data-correctness bug nobody notices
// until they open the piece later.
//
// Rules:
//   - ranges must be non-empty
//   - every range must satisfy 1 <= Start <= End <= totalPages
//   - Start must be non-decreasing across the list, with exactly one
//     exception: two consecutive ranges may share the same Start only
//     when the earlier one is itself a single page (Start == End) — the
//     "bridge" pattern (a page immediately after a skip, marked as both
//     finishing a synthetic single-page piece and starting the next one).
//     Any other repeated or decreasing Start is rejected.
//   - beyond that, adjacent ranges may overlap by at most the single
//     shared boundary page (ranges[i].Start == ranges[i-1].End) — a page
//     shared between two pieces, design doc §5. Anything more is
//     rejected. Gaps between ranges (skipped pages) need no validation at
//     all — they're simply pages no range covers.
func ValidateRanges(totalPages int, ranges []PageRange) error {
	if totalPages < 1 {
		return fmt.Errorf("totalPages must be at least 1, got %d", totalPages)
	}
	if len(ranges) == 0 {
		return fmt.Errorf("ranges must not be empty")
	}

	for i, rg := range ranges {
		if rg.Start < 1 {
			return fmt.Errorf("range %d (start %d) must start at page 1 or later", i, rg.Start)
		}
		if rg.End > totalPages {
			return fmt.Errorf("range %d (end %d) must not exceed totalPages (%d)", i, rg.End, totalPages)
		}
		if rg.Start > rg.End {
			return fmt.Errorf("range %d (start %d, end %d) must have start <= end", i, rg.Start, rg.End)
		}
		if i == 0 {
			continue
		}
		prev := ranges[i-1]
		switch {
		case rg.Start < prev.Start:
			return fmt.Errorf("range %d (start %d) must not start before range %d (start %d)", i, rg.Start, i-1, prev.Start)
		case rg.Start == prev.Start:
			if prev.Start != prev.End {
				return fmt.Errorf("range %d (start %d) duplicates range %d's start page without range %d being a single-page bridge", i, rg.Start, i-1, i-1)
			}
		case rg.Start < prev.End:
			return fmt.Errorf("range %d (start %d) overlaps range %d (pages %d-%d) by more than the single allowed shared boundary page", i, rg.Start, i-1, prev.Start, prev.End)
		}
	}

	return nil
}
