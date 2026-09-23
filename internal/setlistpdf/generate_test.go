package setlistpdf_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jpcranford/sonneck/internal/pdf"
	"github.com/jpcranford/sonneck/internal/setlistpdf"
	"github.com/jpcranford/sonneck/internal/testutil"
)

// TestGenerate_RealOutputPageCountMatchesComputedLayout builds a small
// mixed fixture (real multi-page "piece" PDFs plus custom entries), calls
// Generate, and verifies the *actual* output — via the same poppler-based
// PageCount this app already trusts everywhere else, not just the
// pagination math in isolation — matches what ComputeLayout predicted.
// This is exactly the class of PDF page-range correctness CLAUDE.md's
// Testing section already treats as non-optional elsewhere.
func TestGenerate_RealOutputPageCountMatchesComputedLayout(t *testing.T) {
	dir := t.TempDir()

	piece1 := filepath.Join(dir, "piece1.pdf")
	testutil.WriteFixturePDF(t, piece1, 2)
	piece2 := filepath.Join(dir, "piece2.pdf")
	testutil.WriteFixturePDF(t, piece2, 4)

	role := "Offertory"
	dur := 90
	notes := "A short spoken interlude."

	entries := []setlistpdf.Entry{
		{IsPiece: false, CustomName: "Prelude"},
		{IsPiece: true, PieceTitle: "Holy, Holy, Holy", PieceKeys: []string{"Eb"}, PieceFilePath: piece1, PiecePageCount: 2},
		{IsPiece: false, CustomName: "Congregational Response", CustomRole: &role, CustomDurationSeconds: &dur, CustomNotes: &notes},
		{IsPiece: true, PieceTitle: "How Great Thou Art", PieceKeys: []string{"F"}, PieceFilePath: piece2, PiecePageCount: 4},
		{IsPiece: false, CustomName: "Benediction"},
	}

	layout := setlistpdf.ComputeLayout(entries)

	out, err := setlistpdf.Generate(context.Background(), "", setlistpdf.Input{
		Setlist: setlistpdf.Setlist{
			Name:        "Sunday Morning Service",
			GigDate:     "October 4, 2026",
			Description: "Traditional hymns for the first Sunday of October.",
		},
		Entries: entries,
		Shape:   setlistpdf.ShapeLetter,
		Now:     time.Date(2026, 9, 22, 0, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if len(out) == 0 {
		t.Fatal("Generate returned empty output")
	}

	outPath := filepath.Join(dir, "out.pdf")
	if err := os.WriteFile(outPath, out, 0o644); err != nil {
		t.Fatalf("writing generated PDF: %v", err)
	}

	got, err := pdf.PageCount(context.Background(), "", outPath)
	if err != nil {
		t.Fatalf("PageCount on generated output: %v", err)
	}
	if got != layout.TotalPages {
		t.Errorf("real output page count = %d, want %d (from ComputeLayout)", got, layout.TotalPages)
	}
}

// TestGenerate_AdjacentPieceEntries covers Generate's own chunk-flushing
// logic specifically: two piece entries back to back, with no generated
// page between them, means the chunk started right after the first piece
// has zero pages drawn into it by the time the second piece is reached —
// flush must skip writing that empty chunk to pdfunite (which can't
// merge a zero-page PDF) rather than erroring.
func TestGenerate_AdjacentPieceEntries(t *testing.T) {
	dir := t.TempDir()

	piece1 := filepath.Join(dir, "piece1.pdf")
	testutil.WriteFixturePDF(t, piece1, 1)
	piece2 := filepath.Join(dir, "piece2.pdf")
	testutil.WriteFixturePDF(t, piece2, 3)

	entries := []setlistpdf.Entry{
		{IsPiece: true, PieceTitle: "First", PieceFilePath: piece1, PiecePageCount: 1},
		{IsPiece: true, PieceTitle: "Second", PieceFilePath: piece2, PiecePageCount: 3},
	}
	layout := setlistpdf.ComputeLayout(entries)

	out, err := setlistpdf.Generate(context.Background(), "", setlistpdf.Input{
		Setlist: setlistpdf.Setlist{Name: "Adjacent Pieces"},
		Entries: entries,
		Shape:   setlistpdf.ShapeLetter,
		Now:     time.Now(),
	})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}

	outPath := filepath.Join(dir, "out.pdf")
	if err := os.WriteFile(outPath, out, 0o644); err != nil {
		t.Fatalf("writing generated PDF: %v", err)
	}
	got, err := pdf.PageCount(context.Background(), "", outPath)
	if err != nil {
		t.Fatalf("PageCount on generated output: %v", err)
	}
	if got != layout.TotalPages {
		t.Errorf("real output page count = %d, want %d (from ComputeLayout)", got, layout.TotalPages)
	}
}

// TestGenerate_A4Shape is a light smoke test that the A4 code path also
// produces a valid, non-empty PDF — the region->shape mapping and the A4
// SizeType are both exercised nowhere else.
func TestGenerate_A4Shape(t *testing.T) {
	out, err := setlistpdf.Generate(context.Background(), "", setlistpdf.Input{
		Setlist: setlistpdf.Setlist{Name: "Test Setlist"},
		Entries: []setlistpdf.Entry{{IsPiece: false, CustomName: "Announcement"}},
		Shape:   setlistpdf.ShapeA4,
		Now:     time.Now(),
	})
	if err != nil {
		t.Fatalf("Generate (A4): %v", err)
	}
	if len(out) == 0 {
		t.Fatal("Generate (A4) returned empty output")
	}
}

// TestGenerate_EmptySetlist confirms a setlist with no entries at all
// still produces a valid cover+TOC+colophon-only export rather than
// erroring — a legitimate, if unusual, real case.
func TestGenerate_EmptySetlist(t *testing.T) {
	out, err := setlistpdf.Generate(context.Background(), "", setlistpdf.Input{
		Setlist: setlistpdf.Setlist{Name: "Empty Setlist"},
		Entries: nil,
		Shape:   setlistpdf.ShapeLetter,
		Now:     time.Now(),
	})
	if err != nil {
		t.Fatalf("Generate (empty): %v", err)
	}
	if len(out) == 0 {
		t.Fatal("Generate (empty) returned empty output")
	}
}
