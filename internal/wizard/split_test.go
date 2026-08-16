package wizard_test

import (
	"reflect"
	"testing"

	"github.com/jpcranford/sonneck/internal/wizard"
)

// This suite covers exactly the cases CLAUDE.md > Testing requires for the
// import wizard's split step: single-page piece, multi-page piece, first
// piece includes page 1, last piece includes the final page, and off-by-one
// boundaries between adjacent pieces.

func TestComputePieceRanges_SinglePagePiece(t *testing.T) {
	got, err := wizard.ComputePieceRanges(1, nil)
	if err != nil {
		t.Fatalf("ComputePieceRanges: %v", err)
	}
	want := []wizard.PageRange{{Start: 1, End: 1}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestComputePieceRanges_MultiPagePiece(t *testing.T) {
	got, err := wizard.ComputePieceRanges(10, nil)
	if err != nil {
		t.Fatalf("ComputePieceRanges: %v", err)
	}
	want := []wizard.PageRange{{Start: 1, End: 10}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestComputePieceRanges_FirstPieceIncludesPage1(t *testing.T) {
	got, err := wizard.ComputePieceRanges(20, []int{5, 12})
	if err != nil {
		t.Fatalf("ComputePieceRanges: %v", err)
	}
	if got[0].Start != 1 {
		t.Errorf("first piece Start = %d, want 1", got[0].Start)
	}
}

func TestComputePieceRanges_LastPieceIncludesFinalPage(t *testing.T) {
	const totalPages = 20
	got, err := wizard.ComputePieceRanges(totalPages, []int{5, 12})
	if err != nil {
		t.Fatalf("ComputePieceRanges: %v", err)
	}
	last := got[len(got)-1]
	if last.End != totalPages {
		t.Errorf("last piece End = %d, want %d", last.End, totalPages)
	}
}

func TestComputePieceRanges_OffByOneBetweenAdjacentPieces(t *testing.T) {
	got, err := wizard.ComputePieceRanges(10, []int{3, 7})
	if err != nil {
		t.Fatalf("ComputePieceRanges: %v", err)
	}
	want := []wizard.PageRange{
		{Start: 1, End: 3}, // boundary page (3) belongs to the piece before it
		{Start: 4, End: 7}, // next piece starts immediately after, not on or two past the boundary
		{Start: 8, End: 10},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestComputePieceRanges_ManyAdjacentSinglePagePieces(t *testing.T) {
	// Every page its own piece — the tightest possible off-by-one stress case.
	got, err := wizard.ComputePieceRanges(4, []int{1, 2, 3})
	if err != nil {
		t.Fatalf("ComputePieceRanges: %v", err)
	}
	want := []wizard.PageRange{
		{Start: 1, End: 1},
		{Start: 2, End: 2},
		{Start: 3, End: 3},
		{Start: 4, End: 4},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestComputePieceRanges_RejectsInvalidTotalPages(t *testing.T) {
	if _, err := wizard.ComputePieceRanges(0, nil); err == nil {
		t.Error("ComputePieceRanges(0, nil) = nil error, want an error")
	}
}

func TestComputePieceRanges_RejectsBoundaryAtOrPastFinalPage(t *testing.T) {
	if _, err := wizard.ComputePieceRanges(10, []int{10}); err == nil {
		t.Error("boundary equal to totalPages should be rejected (it would leave the last piece empty)")
	}
	if _, err := wizard.ComputePieceRanges(10, []int{11}); err == nil {
		t.Error("boundary past totalPages should be rejected")
	}
}

func TestComputePieceRanges_RejectsNonIncreasingBoundaries(t *testing.T) {
	if _, err := wizard.ComputePieceRanges(10, []int{5, 5}); err == nil {
		t.Error("duplicate boundary should be rejected")
	}
	if _, err := wizard.ComputePieceRanges(10, []int{5, 3}); err == nil {
		t.Error("decreasing boundary should be rejected")
	}
}
