package wizard_test

import (
	"testing"

	"github.com/jpcranford/sonneck/internal/wizard"
)

// This suite covers exactly the cases CLAUDE.md > Testing requires for the
// import wizard's split step: single-page piece, multi-page piece, first
// piece includes page 1, last piece includes the final page, off-by-one
// boundaries between adjacent pieces — plus the two new capabilities this
// validator exists for: a shared boundary page and a skip (gap).

func TestValidateRanges_SinglePagePiece(t *testing.T) {
	if err := wizard.ValidateRanges(1, []wizard.PageRange{{Start: 1, End: 1}}); err != nil {
		t.Errorf("ValidateRanges: %v", err)
	}
}

func TestValidateRanges_MultiPagePiece(t *testing.T) {
	if err := wizard.ValidateRanges(10, []wizard.PageRange{{Start: 1, End: 10}}); err != nil {
		t.Errorf("ValidateRanges: %v", err)
	}
}

func TestValidateRanges_FirstPieceMustIncludePage1(t *testing.T) {
	// Not a structural rule of the validator itself (nothing requires page
	// 1 to be covered — a book could legitimately start with a skipped
	// page), but a range that DOES start at page 1 must be accepted.
	if err := wizard.ValidateRanges(20, []wizard.PageRange{{Start: 1, End: 5}, {Start: 6, End: 20}}); err != nil {
		t.Errorf("ValidateRanges: %v", err)
	}
}

func TestValidateRanges_LastPieceMayIncludeFinalPage(t *testing.T) {
	const totalPages = 20
	if err := wizard.ValidateRanges(totalPages, []wizard.PageRange{{Start: 1, End: 12}, {Start: 13, End: 20}}); err != nil {
		t.Errorf("ValidateRanges: %v", err)
	}
}

func TestValidateRanges_OffByOneBetweenAdjacentPieces(t *testing.T) {
	// [1,3][4,7][8,10] — the boundary page (3) belongs only to the piece
	// before it, the next piece starts immediately after, not sharing it.
	err := wizard.ValidateRanges(10, []wizard.PageRange{
		{Start: 1, End: 3},
		{Start: 4, End: 7},
		{Start: 8, End: 10},
	})
	if err != nil {
		t.Errorf("ValidateRanges: %v", err)
	}
}

func TestValidateRanges_ManyAdjacentSinglePagePieces(t *testing.T) {
	err := wizard.ValidateRanges(4, []wizard.PageRange{
		{Start: 1, End: 1},
		{Start: 2, End: 2},
		{Start: 3, End: 3},
		{Start: 4, End: 4},
	})
	if err != nil {
		t.Errorf("ValidateRanges: %v", err)
	}
}

func TestValidateRanges_AcceptsSharedBoundaryPage(t *testing.T) {
	// Page 5 is both the end of piece 1 and the start of piece 2 — design
	// doc §5's "page 24 has a short piece's ending and the next piece's
	// beginning" case. This is the capability ValidateRanges exists to add
	// over the old ComputePieceRanges.
	err := wizard.ValidateRanges(10, []wizard.PageRange{
		{Start: 1, End: 5},
		{Start: 5, End: 10},
	})
	if err != nil {
		t.Errorf("ValidateRanges rejected a valid single-page shared boundary: %v", err)
	}
}

func TestValidateRanges_AcceptsGapForSkippedPages(t *testing.T) {
	// Page 4 is skipped entirely — no range covers it, and that's fine; a
	// gap needs no special representation at all.
	err := wizard.ValidateRanges(8, []wizard.PageRange{
		{Start: 1, End: 3},
		{Start: 5, End: 8},
	})
	if err != nil {
		t.Errorf("ValidateRanges rejected a valid gap: %v", err)
	}
}

func TestValidateRanges_AcceptsSkipImmediatelyBeforeASharedBoundary(t *testing.T) {
	// The "bridge" scenario: page 2 skipped, page 3 is both a synthetic
	// single-page "bridge" piece AND the start of the next piece.
	err := wizard.ValidateRanges(8, []wizard.PageRange{
		{Start: 1, End: 1},
		{Start: 3, End: 3},
		{Start: 3, End: 8},
	})
	if err != nil {
		t.Errorf("ValidateRanges rejected a valid skip-adjacent shared boundary: %v", err)
	}
}

func TestValidateRanges_RejectsInvalidTotalPages(t *testing.T) {
	if err := wizard.ValidateRanges(0, []wizard.PageRange{{Start: 1, End: 1}}); err == nil {
		t.Error("ValidateRanges(0, ...) = nil error, want an error")
	}
}

func TestValidateRanges_RejectsEmptyRanges(t *testing.T) {
	if err := wizard.ValidateRanges(10, nil); err == nil {
		t.Error("ValidateRanges with no ranges = nil error, want an error")
	}
}

func TestValidateRanges_RejectsRangePastFinalPage(t *testing.T) {
	if err := wizard.ValidateRanges(10, []wizard.PageRange{{Start: 1, End: 11}}); err == nil {
		t.Error("range ending past totalPages should be rejected")
	}
}

func TestValidateRanges_RejectsStartBeforePage1(t *testing.T) {
	if err := wizard.ValidateRanges(10, []wizard.PageRange{{Start: 0, End: 5}}); err == nil {
		t.Error("range starting before page 1 should be rejected")
	}
}

func TestValidateRanges_RejectsStartAfterEnd(t *testing.T) {
	if err := wizard.ValidateRanges(10, []wizard.PageRange{{Start: 5, End: 3}}); err == nil {
		t.Error("range with start > end should be rejected")
	}
}

func TestValidateRanges_RejectsNonIncreasingStarts(t *testing.T) {
	if err := wizard.ValidateRanges(10, []wizard.PageRange{{Start: 1, End: 5}, {Start: 5, End: 8}, {Start: 5, End: 10}}); err == nil {
		t.Error("duplicate start should be rejected")
	}
	if err := wizard.ValidateRanges(10, []wizard.PageRange{{Start: 1, End: 5}, {Start: 3, End: 10}}); err == nil {
		t.Error("decreasing start should be rejected")
	}
}

func TestValidateRanges_RejectsOverlapPastSingleSharedPage(t *testing.T) {
	// Piece 2 starts at page 4, but piece 1 extends to page 6 — a 3-page
	// overlap, not the single shared boundary page the design allows.
	err := wizard.ValidateRanges(10, []wizard.PageRange{{Start: 1, End: 6}, {Start: 4, End: 10}})
	if err == nil {
		t.Error("overlap of more than one page should be rejected")
	}
}
