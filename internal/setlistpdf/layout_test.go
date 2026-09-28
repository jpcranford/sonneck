package setlistpdf_test

import (
	"reflect"
	"testing"

	"github.com/jpcranford/sonneck/internal/setlistpdf"
)

func intp(n int) *int { return &n }

func TestComputeLayout_Empty(t *testing.T) {
	l := setlistpdf.ComputeLayout(nil, 1)
	if l.TOCPageCount != 1 {
		t.Errorf("TOCPageCount = %d, want 1", l.TOCPageCount)
	}
	if l.ColophonPage != 3 { // cover(1) + toc(1) + colophon(1)
		t.Errorf("ColophonPage = %d, want 3", l.ColophonPage)
	}
	if l.TotalPages != 3 {
		t.Errorf("TotalPages = %d, want 3", l.TotalPages)
	}
	if len(l.EntryStartPage) != 0 {
		t.Errorf("EntryStartPage = %v, want empty", l.EntryStartPage)
	}
}

func TestComputeLayout_MixedEntries(t *testing.T) {
	entries := []setlistpdf.Entry{
		{IsPiece: false},                   // custom, 1 page -> page 3
		{IsPiece: true, PiecePageCount: 2}, // piece, 2 pages -> pages 4-5
		{IsPiece: false},                   // custom, 1 page -> page 6
		{IsPiece: true, PiecePageCount: 3}, // piece, 3 pages -> pages 7-9
	}
	l := setlistpdf.ComputeLayout(entries, 1)
	want := []int{3, 4, 6, 7}
	if !reflect.DeepEqual(l.EntryStartPage, want) {
		t.Errorf("EntryStartPage = %v, want %v", l.EntryStartPage, want)
	}
	if l.ColophonPage != 10 {
		t.Errorf("ColophonPage = %d, want 10", l.ColophonPage)
	}
	if l.TotalPages != 10 {
		t.Errorf("TotalPages = %d, want 10", l.TotalPages)
	}
}

func TestComputeLayout_SinglePieceMultiPageAdvancesStartPageCorrectly(t *testing.T) {
	// Guards against the "always +1" bug this exact math is meant to avoid
	// — a multi-page piece must push the next entry's start page forward
	// by its own real page count, not by one.
	entries := []setlistpdf.Entry{
		{IsPiece: true, PiecePageCount: 5},
		{IsPiece: false},
	}
	l := setlistpdf.ComputeLayout(entries, 1)
	if l.EntryStartPage[0] != 3 {
		t.Errorf("first entry start = %d, want 3", l.EntryStartPage[0])
	}
	if l.EntryStartPage[1] != 8 {
		t.Errorf("second entry start = %d, want 8 (after a 5-page piece starting at 3)", l.EntryStartPage[1])
	}
}

func TestComputeLayout_MultiPageTOCShiftsEveryEntry(t *testing.T) {
	entries := []setlistpdf.Entry{{IsPiece: false}, {IsPiece: true, PiecePageCount: 2}}
	l := setlistpdf.ComputeLayout(entries, 3)
	if l.TOCPageCount != 3 {
		t.Errorf("TOCPageCount = %d, want 3", l.TOCPageCount)
	}
	// Cover, three TOC pages, then the first entry.
	if want := []int{5, 6}; !reflect.DeepEqual(l.EntryStartPage, want) {
		t.Errorf("EntryStartPage = %v, want %v", l.EntryStartPage, want)
	}
	if l.TotalPages != 8 {
		t.Errorf("TotalPages = %d, want 8", l.TotalPages)
	}
}

func TestTotalDurationSeconds_OmittedWhenNoneSet(t *testing.T) {
	entries := []setlistpdf.Entry{{IsPiece: false}, {IsPiece: true}}
	if got := setlistpdf.TotalDurationSeconds(entries); got != nil {
		t.Errorf("TotalDurationSeconds = %v, want nil", got)
	}
}

func TestTotalDurationSeconds_SumsWhicheverAreSet(t *testing.T) {
	entries := []setlistpdf.Entry{
		{IsPiece: true, PieceDuration: intp(120)},
		{IsPiece: false, CustomDurationSeconds: nil},
		{IsPiece: false, CustomDurationSeconds: intp(90)},
	}
	got := setlistpdf.TotalDurationSeconds(entries)
	if got == nil || *got != 210 {
		t.Errorf("TotalDurationSeconds = %v, want 210", got)
	}
}

func TestTotalPageCount_OnlyCountsPieces(t *testing.T) {
	entries := []setlistpdf.Entry{
		{IsPiece: true, PiecePageCount: 2},
		{IsPiece: false}, // a custom entry has no pages of music
		{IsPiece: true, PiecePageCount: 3},
	}
	if got := setlistpdf.TotalPageCount(entries); got != 5 {
		t.Errorf("TotalPageCount = %d, want 5", got)
	}
}

func TestShapeForRegion(t *testing.T) {
	cases := map[string]setlistpdf.Shape{
		"en-US":       setlistpdf.ShapeLetter,
		"ca":          setlistpdf.ShapeLetter,
		"eu-generic":  setlistpdf.ShapeA4,
		"en-GB":       setlistpdf.ShapeA4,
		"unknown-xyz": setlistpdf.ShapeLetter,
	}
	for region, want := range cases {
		if got := setlistpdf.ShapeForRegion(region); got != want {
			t.Errorf("ShapeForRegion(%q) = %q, want %q", region, got, want)
		}
	}
}
