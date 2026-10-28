package annotpdf

import (
	"bytes"
	"encoding/json"
	"errors"
	"image/png"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"codeberg.org/go-pdf/fpdf"
	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// blankPage is a one-page blank Letter PDF.
func blankPage(t *testing.T) []byte {
	t.Helper()
	pdf := fpdf.NewCustom(&fpdf.InitType{UnitStr: "pt", Size: fpdf.SizeType{Wd: 612, Ht: 792}})
	pdf.AddPage()
	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// redCentroid renders page 1 with poppler (its CropBox, as the Sheet
// Viewer renders pages) and returns where the red marks'
// pixels center, as shares of the shown page.
func redCentroid(t *testing.T, pdf []byte) (float64, float64) {
	t.Helper()
	if _, err := exec.LookPath("pdftoppm"); err != nil {
		t.Skip("pdftoppm not installed")
	}
	dir := t.TempDir()
	in := filepath.Join(dir, "in.pdf")
	if err := os.WriteFile(in, pdf, 0o644); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("pdftoppm", "-cropbox", "-r", "36", "-png", "-singlefile", in, filepath.Join(dir, "out")).CombinedOutput(); err != nil {
		t.Fatalf("pdftoppm: %v\n%s", err, out)
	}
	f, err := os.Open(filepath.Join(dir, "out.png"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img, err := png.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	b := img.Bounds()
	var sx, sy, n float64
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			r, g, bl, _ := img.At(x, y).RGBA()
			if r > 0xa000 && g < 0x8000 && bl < 0x8000 {
				sx, sy, n = sx+float64(x)+0.5, sy+float64(y)+0.5, n+1
			}
		}
	}
	if n == 0 {
		t.Fatal("no red pixels on the page")
	}
	return sx / n / float64(b.Dx()), sy / n / float64(b.Dy())
}

// A red stroke centered at (0.25, 0.2) of the page as shown.
var redStroke = json.RawMessage(`[{"id":"r","kind":"stroke","tool":"pen","layer":0,"size":1.5,"pressure":false,
	"points":[[0.2,0.2,0.5],[0.22,0.2,0.5],[0.24,0.2,0.5],[0.26,0.2,0.5],[0.28,0.2,0.5],[0.3,0.2,0.5]]}]`)

// A mark lands where it was drawn on the page as the viewer shows it —
// the CropBox, turned by /Rotate — whatever the page's rotation or crop.
func TestMarksFollowRotationAndCrop(t *testing.T) {
	conf := model.NewDefaultConfiguration()
	cases := []struct {
		name   string
		rotate int
		crop   string
	}{
		{"upright", 0, ""},
		{"rotated 90", 90, ""},
		{"rotated 180", 180, ""},
		{"rotated 270", 270, ""},
		{"cropped", 0, "[100 150 500 700]"},
		{"cropped and rotated 90", 90, "[100 150 500 700]"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			pdf := blankPage(t)
			if c.rotate != 0 {
				var out bytes.Buffer
				if err := api.Rotate(bytes.NewReader(pdf), &out, c.rotate, nil, conf); err != nil {
					t.Fatal(err)
				}
				pdf = out.Bytes()
			}
			if c.crop != "" {
				box, err := api.Box(c.crop, types.POINTS)
				if err != nil {
					t.Fatal(err)
				}
				var out bytes.Buffer
				if err := api.Crop(bytes.NewReader(pdf), &out, nil, box, conf); err != nil {
					t.Fatal(err)
				}
				pdf = out.Bytes()
			}
			var out bytes.Buffer
			if err := Write(bytes.NewReader(pdf), &out, map[int]json.RawMessage{1: redStroke}, Options{}); err != nil {
				t.Fatal(err)
			}
			x, y := redCentroid(t, out.Bytes())
			if math.Abs(x-0.25) > 0.01 || math.Abs(y-0.2) > 0.01 {
				t.Errorf("the mark centers at (%.3f, %.3f), want (0.25, 0.2)", x, y)
			}
		})
	}
}

// Hidden colors are left out; with nothing left, ErrNoMarks.
func TestHiddenColorsLeftOut(t *testing.T) {
	var out bytes.Buffer
	err := Write(bytes.NewReader(blankPage(t)), &out, map[int]json.RawMessage{1: redStroke}, Options{HiddenColors: 1})
	if !errors.Is(err, ErrNoMarks) {
		t.Errorf("only a hidden color: err = %v, want ErrNoMarks", err)
	}
	shown, hidden, err := Count(map[int]json.RawMessage{1: redStroke, 2: sampleMarks()}, 1|1<<4)
	if err != nil {
		t.Fatal(err)
	}
	if shown != 4 || hidden != 4 {
		t.Errorf("Count = %d shown, %d hidden; want 4, 4", shown, hidden)
	}
}

// A text mark's appearance embeds its fonts, and its text copies back out
// as plain text: Markdown markers gone, the :shortcode: as its symbol.
func TestTextMarkContents(t *testing.T) {
	marks := json.RawMessage(`[{"id":"t","kind":"text","layer":2,"x":0.1,"y":0.1,"size":1.8,"text":"Breathe **here**\nB:flat: *now*"}]`)
	var out bytes.Buffer
	if err := Write(bytes.NewReader(blankPage(t)), &out, map[int]json.RawMessage{1: marks}, Options{Author: "Reader"}); err != nil {
		t.Fatal(err)
	}
	conf := model.NewDefaultConfiguration()
	ctx, err := api.ReadAndValidate(bytes.NewReader(out.Bytes()), conf)
	if err != nil {
		t.Fatal(err)
	}
	d, _, _, err := ctx.PageDict(1, false)
	if err != nil {
		t.Fatal(err)
	}
	annots, err := ctx.DereferenceArray(d["Annots"])
	if err != nil || len(annots) != 1 {
		t.Fatalf("annotations = %v, %v; want one", annots, err)
	}
	a, err := ctx.DereferenceDict(annots[0])
	if err != nil {
		t.Fatal(err)
	}
	contents, err := types.StringOrHexLiteral(a["Contents"])
	if err != nil {
		t.Fatal(err)
	}
	if want := "Breathe here\nB♭ now"; contents == nil || *contents != want {
		t.Errorf("Contents = %v, want %q", contents, want)
	}
	if author, _ := types.StringOrHexLiteral(a["T"]); author == nil || *author != "Reader" {
		t.Errorf("author = %v, want Reader", author)
	}
	// The appearance's fonts are both embedded.
	ap, err := ctx.DereferenceDict(a["AP"])
	if err != nil {
		t.Fatal(err)
	}
	form, _, err := ctx.DereferenceStreamDict(ap["N"])
	if err != nil {
		t.Fatal(err)
	}
	res, err := ctx.DereferenceDict(form.Dict["Resources"])
	if err != nil {
		t.Fatal(err)
	}
	fonts, err := ctx.DereferenceDict(res["Font"])
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for k := range fonts {
		names = append(names, k)
	}
	if len(names) != 2 {
		t.Errorf("appearance fonts = %v, want Hand and Sym", strings.Join(names, ", "))
	}
}

// Nothing reaches past the page: a stroke running off an edge is cut at it,
// and one wholly off the page is left out.
func TestMarksStayOnPage(t *testing.T) {
	off := json.RawMessage(`[{"id":"o","kind":"stroke","tool":"pen","layer":5,"size":1,"pressure":false,"points":[[1.1,0.5,0.5],[1.3,0.5,0.5]]}]`)
	var out bytes.Buffer
	if err := Write(bytes.NewReader(blankPage(t)), &out, map[int]json.RawMessage{1: off}, Options{}); !errors.Is(err, ErrNoMarks) {
		t.Errorf("a stroke wholly off the page: err = %v, want ErrNoMarks", err)
	}
	across := json.RawMessage(`[{"id":"a","kind":"stroke","tool":"pen","layer":5,"size":1,"pressure":false,"points":[[0.8,0.5,0.5],[0.9,0.5,0.5],[1.3,0.5,0.5]]}]`)
	if err := Write(bytes.NewReader(blankPage(t)), &out, map[int]json.RawMessage{1: across}, Options{}); err != nil {
		t.Fatal(err)
	}
	ctx, err := api.ReadAndValidate(bytes.NewReader(out.Bytes()), model.NewDefaultConfiguration())
	if err != nil {
		t.Fatal(err)
	}
	d, _, _, err := ctx.PageDict(1, false)
	if err != nil {
		t.Fatal(err)
	}
	annots, _ := ctx.DereferenceArray(d["Annots"])
	a, err := ctx.DereferenceDict(annots[0])
	if err != nil {
		t.Fatal(err)
	}
	rect, err := ctx.RectForArray(a["Rect"].(types.Array))
	if err != nil {
		t.Fatal(err)
	}
	if rect.UR.X > 612 || rect.LL.X < 480 {
		t.Errorf("Rect %v, want it to end at the page's right edge (612)", rect)
	}
}
