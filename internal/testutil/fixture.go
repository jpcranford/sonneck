// Package testutil holds test fixtures shared across packages. It exists
// so this logic has exactly one implementation: two independent copies of
// a hand-rolled PDF structure are exactly the kind of thing that silently
// drifts out of sync (see CLAUDE.md > Testing on why PDF page-range
// correctness is treated as non-optional here).
package testutil

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"strings"
	"testing"
)

// WriteFixturePDF writes a minimal, valid multi-page PDF (blank pages, no
// content streams) to path — just enough structure for poppler-utils to
// parse it, so PDF operations can be tested against real tool output
// rather than mocks. Each page carries a distinct marker in a custom dict
// entry so pages have different byte content — otherwise every extracted
// range would hash identically and mask real page-range bugs.
func WriteFixturePDF(t *testing.T, path string, pageCount int) {
	t.Helper()

	var buf bytes.Buffer
	var offsets []int

	buf.WriteString("%PDF-1.4\n")

	offsets = append(offsets, buf.Len())
	buf.WriteString("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")

	kids := make([]string, pageCount)
	for i := range kids {
		kids[i] = fmt.Sprintf("%d 0 R", 3+i)
	}
	offsets = append(offsets, buf.Len())
	fmt.Fprintf(&buf, "2 0 obj\n<< /Type /Pages /Kids [%s] /Count %d >>\nendobj\n", strings.Join(kids, " "), pageCount)

	for i := 0; i < pageCount; i++ {
		offsets = append(offsets, buf.Len())
		fmt.Fprintf(&buf, "%d 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /SonneckTestPageNumber %d >>\nendobj\n", 3+i, i+1)
	}

	xrefStart := buf.Len()
	size := len(offsets) + 1 // +1 for the free object 0
	fmt.Fprintf(&buf, "xref\n0 %d\n0000000000 65535 f \n", size)
	for _, off := range offsets {
		fmt.Fprintf(&buf, "%010d 00000 n \n", off)
	}
	fmt.Fprintf(&buf, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", size, xrefStart)

	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatalf("writing fixture PDF: %v", err)
	}
}

// WriteFixturePNG writes a tiny real PNG (solid fill, r/g/b as given) to
// path — for the book cover-image upload tests (handleUploadBookCover),
// which validate the upload via image.DecodeConfig and so need a file that
// actually decodes as an image, not just PNG-shaped bytes. rgb varies the
// fill color between calls so two fixture images produce different SHA-256
// hashes (content-addressed storage, same "distinct content per fixture"
// reasoning as WriteFixturePDF's own per-page marker).
func WriteFixturePNG(t *testing.T, path string, rgb [3]byte) {
	t.Helper()

	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	fill := color.RGBA{R: rgb[0], G: rgb[1], B: rgb[2], A: 255}
	for y := 0; y < 4; y++ {
		for x := 0; x < 4; x++ {
			img.Set(x, y, fill)
		}
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encoding fixture PNG: %v", err)
	}
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatalf("writing fixture PNG: %v", err)
	}
}
