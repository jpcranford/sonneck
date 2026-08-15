// Package wizard holds the import wizard's split-step logic (design doc
// §5 step 2): turning the user's marked split points into each prospective
// Piece's page range.
package wizard

import "fmt"

// PageRange is an inclusive, 1-indexed page range for one prospective
// Piece.
type PageRange struct {
	Start int
	End   int
}

// ComputePieceRanges turns split points into page ranges. boundaries is the
// last page number of every piece except the final one, in ascending order
// — e.g. totalPages=10, boundaries=[3,7] produces pieces [1,3], [4,7],
// [8,10]. An empty boundaries list produces a single piece spanning the
// whole book (the common case: most books in this app aren't split at
// all).
//
// This is the logic CLAUDE.md > Testing calls out as non-optional: a wrong
// page range is a silent, permanent data-correctness bug nobody notices
// until they open the piece later.
func ComputePieceRanges(totalPages int, boundaries []int) ([]PageRange, error) {
	if totalPages < 1 {
		return nil, fmt.Errorf("totalPages must be at least 1, got %d", totalPages)
	}

	prev := 0
	for i, b := range boundaries {
		if b <= prev {
			return nil, fmt.Errorf("boundary %d (page %d) must be greater than the previous boundary (page %d)", i, b, prev)
		}
		if b >= totalPages {
			return nil, fmt.Errorf("boundary %d (page %d) must be less than totalPages (%d) — the last piece always includes the final page", i, b, totalPages)
		}
		prev = b
	}

	ranges := make([]PageRange, 0, len(boundaries)+1)
	start := 1
	for _, b := range boundaries {
		ranges = append(ranges, PageRange{Start: start, End: b})
		start = b + 1
	}
	ranges = append(ranges, PageRange{Start: start, End: totalPages})

	return ranges, nil
}
