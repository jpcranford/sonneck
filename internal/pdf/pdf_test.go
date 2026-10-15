package pdf_test

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jpcranford/sonneck/internal/pdf"
	"github.com/jpcranford/sonneck/internal/testutil"
)

func TestPageCount_MatchesFixture(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "fixture.pdf")
	testutil.WriteFixturePDF(t, src, 7)

	got, err := pdf.PageCount(context.Background(), "", src)
	if err != nil {
		t.Fatalf("PageCount: %v", err)
	}
	if got != 7 {
		t.Errorf("PageCount = %d, want 7", got)
	}
}

func TestExtractPages_ProducesFileWithExactPageCount(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "book.pdf")
	testutil.WriteFixturePDF(t, src, 10)

	dst := filepath.Join(dir, "piece.pdf")
	if err := pdf.ExtractPages(context.Background(), "", src, 4, 8, dst); err != nil {
		t.Fatalf("ExtractPages: %v", err)
	}

	got, err := pdf.PageCount(context.Background(), "", dst)
	if err != nil {
		t.Fatalf("PageCount on extracted file: %v", err)
	}
	if want := 8 - 4 + 1; got != want {
		t.Errorf("extracted PageCount = %d, want %d (pages 4-8 inclusive)", got, want)
	}
}

// writeAnnotatedPDF writes a pageCount-page PDF whose every page carries
// one ink annotation (a pen stroke), the way a PDF editor stores one.
func writeAnnotatedPDF(t *testing.T, path string, pageCount int) {
	t.Helper()
	var buf bytes.Buffer
	var offsets []int
	obj := func(body string) {
		offsets = append(offsets, buf.Len())
		fmt.Fprintf(&buf, "%d 0 obj\n%s\nendobj\n", len(offsets), body)
	}
	buf.WriteString("%PDF-1.4\n")
	obj("<< /Type /Catalog /Pages 2 0 R >>")
	kids := make([]string, pageCount)
	for i := range kids {
		kids[i] = fmt.Sprintf("%d 0 R", 3+2*i)
	}
	obj(fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), pageCount))
	for i := 0; i < pageCount; i++ {
		page, annot := 3+2*i, 4+2*i
		obj(fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Annots [%d 0 R] >>", annot))
		obj(fmt.Sprintf("<< /Type /Annot /Subtype /Ink /Rect [100 100 300 200] /F 4 "+
			"/InkList [[100 100 200 200 300 100]] /C [1 0 0] /Contents (stroke on page %d) /P %d 0 R >>", i+1, page))
	}
	xref := buf.Len()
	fmt.Fprintf(&buf, "xref\n0 %d\n0000000000 65535 f \n", len(offsets)+1)
	for _, off := range offsets {
		fmt.Fprintf(&buf, "%010d 00000 n \n", off)
	}
	fmt.Fprintf(&buf, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets)+1, xref)
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatalf("writing annotated PDF: %v", err)
	}
}

// The book split must keep a page's annotations as real annotations — not
// flattened into the page or dropped, which redrawing through pdftocairo
// did.
func TestExtractPages_KeepsAnnotations(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "book.pdf")
	writeAnnotatedPDF(t, src, 5)

	dst := filepath.Join(dir, "piece.pdf")
	if err := pdf.ExtractPages(context.Background(), "", src, 2, 4, dst); err != nil {
		t.Fatalf("ExtractPages: %v", err)
	}
	out, err := os.ReadFile(dst)
	if err != nil {
		t.Fatalf("reading extracted file: %v", err)
	}
	if got := bytes.Count(out, []byte("/Subtype /Ink")); got != 3 {
		t.Errorf("extracted file has %d ink annotations, want 3 (one per page 2-4)", got)
	}
	for _, page := range []int{2, 3, 4} {
		if !bytes.Contains(out, []byte(fmt.Sprintf("stroke on page %d", page))) {
			t.Errorf("page %d's annotation is missing from the extracted file", page)
		}
	}
	if bytes.Contains(out, []byte("stroke on page 1")) || bytes.Contains(out, []byte("stroke on page 5")) {
		t.Error("extracted file carries an annotation from a page outside the range")
	}
}

func TestExtractPages_RejectsInvalidRange(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "book.pdf")
	testutil.WriteFixturePDF(t, src, 5)

	if err := pdf.ExtractPages(context.Background(), "", src, 3, 2, filepath.Join(dir, "out.pdf")); err == nil {
		t.Error("ExtractPages with last < first = nil error, want an error")
	}
}

func TestRenderThumbnail_WritesExpectedPNG(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "book.pdf")
	testutil.WriteFixturePDF(t, src, 3)

	outPrefix := filepath.Join(dir, "thumb")
	path, err := pdf.RenderThumbnail(context.Background(), "", src, 2, 72, outPrefix)
	if err != nil {
		t.Fatalf("RenderThumbnail: %v", err)
	}
	if path != outPrefix+".png" {
		t.Errorf("returned path = %q, want %q", path, outPrefix+".png")
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat rendered thumbnail: %v", err)
	}
	if info.Size() == 0 {
		t.Error("rendered thumbnail file is empty")
	}
}
