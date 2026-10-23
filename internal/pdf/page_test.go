package pdf_test

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"path/filepath"
	"testing"

	"codeberg.org/go-pdf/fpdf"

	"github.com/jpcranford/sonneck/internal/pdf"
)

// writePagePDF writes a one-page Letter PDF: an engraved-style page (a
// drawn line and box), optionally with images placed over it. Each image is
// {x, y, w, h} in points.
func writePagePDF(t *testing.T, path string, images [][4]float64) {
	t.Helper()
	doc := fpdf.New("P", "pt", "Letter", "")
	doc.AddPage()
	doc.SetLineWidth(1.2)
	doc.Line(72, 200, 540, 200)
	doc.SetFillColor(0, 0, 0)
	doc.Rect(72, 300, 100, 40, "F")

	var buf bytes.Buffer
	img := image.NewGray(image.Rect(0, 0, 40, 40))
	for i := range img.Pix {
		img.Pix[i] = 128
	}
	img.Set(5, 5, color.Gray{Y: 0})
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	opt := fpdf.ImageOptions{ImageType: "PNG"}
	for i, r := range images {
		name := fmt.Sprintf("img%d", i)
		doc.RegisterImageOptionsReader(name, opt, bytes.NewReader(buf.Bytes()))
		doc.ImageOptions(name, r[0], r[1], r[2], r[3], false, opt, 0, "")
	}
	if err := doc.OutputFileAndClose(path); err != nil {
		t.Fatal(err)
	}
}

func TestIsScannedPage(t *testing.T) {
	cases := []struct {
		name   string
		images [][4]float64
		want   bool
	}{
		{"drawn page", nil, false},
		{"small logo on a drawn page", [][4]float64{{72, 72, 60, 30}}, false},
		{"one page-sized image", [][4]float64{{0, 0, 612, 792}}, true},
		{"a page in strips", [][4]float64{{0, 0, 612, 160}, {0, 160, 612, 160}, {0, 320, 612, 160}, {0, 480, 612, 160}, {0, 640, 612, 152}}, true},
		{"an image under half the page", [][4]float64{{0, 0, 612, 300}}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			src := filepath.Join(t.TempDir(), "page.pdf")
			writePagePDF(t, src, tc.images)
			got, err := pdf.IsScannedPage(context.Background(), "", src, 1)
			if err != nil {
				t.Fatalf("IsScannedPage: %v", err)
			}
			if got != tc.want {
				t.Errorf("IsScannedPage = %v, want %v", got, tc.want)
			}
		})
	}
}

// Both render paths give an 8-bit gray image at the requested resolution,
// with the page's ink in it.
func TestRenderPageGray(t *testing.T) {
	src := filepath.Join(t.TempDir(), "page.pdf")
	writePagePDF(t, src, nil)
	for _, scanned := range []bool{false, true} {
		t.Run(fmt.Sprintf("scanned=%v", scanned), func(t *testing.T) {
			g, err := pdf.RenderPageGray(context.Background(), "", src, 1, 72, scanned, t.TempDir())
			if err != nil {
				t.Fatalf("RenderPageGray: %v", err)
			}
			if g.Rect.Dx() != 612 || g.Rect.Dy() != 792 {
				t.Errorf("size = %dx%d, want 612x792 at 72ppi", g.Rect.Dx(), g.Rect.Dy())
			}
			// Inside the filled box: black. Far from any ink: white.
			if y := g.GrayAt(120, 320).Y; y > 40 {
				t.Errorf("box pixel = %d, want near 0", y)
			}
			if y := g.GrayAt(300, 600).Y; y < 250 {
				t.Errorf("blank pixel = %d, want near 255", y)
			}
		})
	}
}

// The engraved path draws a line at its true width instead of snapping it
// to whole pixels: a 1.2pt line at 72ppi carries 1.2 pixels of ink.
func TestRenderPageGray_EngravedLinesKeepTheirWidth(t *testing.T) {
	src := filepath.Join(t.TempDir(), "page.pdf")
	writePagePDF(t, src, nil)
	g, err := pdf.RenderPageGray(context.Background(), "", src, 1, 72, false, t.TempDir())
	if err != nil {
		t.Fatalf("RenderPageGray: %v", err)
	}
	ink := 0.0
	for y := 195; y <= 205; y++ {
		ink += float64(255-g.GrayAt(300, y).Y) / 255
	}
	if ink < 1.1 || ink > 1.3 {
		t.Errorf("line ink = %.2f pixels, want about 1.2", ink)
	}
}
