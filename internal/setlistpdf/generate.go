package setlistpdf

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"codeberg.org/go-pdf/fpdf"
	poppler "github.com/jpcranford/sonneck/internal/pdf"
)

// Unit is points throughout this package.
const unit = "pt"

// Letter/A4 page dimensions in points, matching fpdf's own built-in
// format strings exactly (8.5x11in and 210x297mm respectively) — named
// here since a piece's own imported page needs its *own* size, so the
// cover/TOC/program/colophon pages are sized explicitly rather than
// relying on a document-wide default that imported pages would also
// inherit.
var pageSize = map[Shape]fpdf.SizeType{
	ShapeLetter: {Wd: 612, Ht: 792},
	ShapeA4:     {Wd: 595.28, Ht: 841.89},
}

// Real app design tokens (frontend/src/index.css), reused verbatim —
// this generated PDF is meant to look like it belongs to the same app,
// not a separately-invented palette.
var (
	colorInk        = rgb(0x1c, 0x18, 0x15)
	colorInkSoft    = rgb(0x5c, 0x53, 0x49)
	colorBorder     = rgb(0xe4, 0xe0, 0xd8)
	colorAccent     = rgb(0x3f, 0x5c, 0x3f)
	colorAccentSoft = rgb(0xe3, 0xe9, 0xe0)
)

type rgbColor struct{ r, g, b int }

func rgb(r, g, b int) rgbColor { return rgbColor{r, g, b} }

// Font family names as registered with fpdf — "display" mirrors the
// app's own --font-display (Libre Baskerville), "sans" mirrors
// --font-sans (Cabin). No "music" font is needed here; nothing in the
// four generated page designs uses Bravura Text.
const (
	fontDisplay = "LibreBaskerville"
	fontSans    = "Cabin"
)

func registerFonts(pdf *fpdf.Fpdf) {
	pdf.AddUTF8FontFromBytes(fontDisplay, "", fontLibreBaskervilleRegular)
	pdf.AddUTF8FontFromBytes(fontDisplay, "I", fontLibreBaskervilleItalic)
	pdf.AddUTF8FontFromBytes(fontDisplay, "B", fontLibreBaskervilleBold)
	pdf.AddUTF8FontFromBytes(fontSans, "", fontCabinRegular)
	pdf.AddUTF8FontFromBytes(fontSans, "I", fontCabinItalic)
	pdf.AddUTF8FontFromBytes(fontSans, "B", fontCabinBold)
	// fpdf keys fonts by (family, style) only — "semibold" has no style
	// flag of its own, so it's registered as a distinct family name
	// instead of trying to misuse the regular/bold/italic style slots.
	pdf.AddUTF8FontFromBytes(fontSans+"SemiBold", "", fontCabinSemiBold)
}

func setColor(pdf *fpdf.Fpdf, c rgbColor) { pdf.SetTextColor(c.r, c.g, c.b) }
func setDraw(pdf *fpdf.Fpdf, c rgbColor)  { pdf.SetDrawColor(c.r, c.g, c.b) }
func setFill(pdf *fpdf.Fpdf, c rgbColor)  { pdf.SetFillColor(c.r, c.g, c.b) }

// Setlist carries the setlist-level fields every generated page needs —
// deliberately not repo.Setlist itself, so this package has no dependency
// on the repo layer (kept feature-scoped and independently testable, same
// posture as internal/copyright or internal/wikipedia).
type Setlist struct {
	Name        string
	GigDate     string // already formatted for display (e.g. "October 4, 2026"), or ""
	Description string // markdown source is not rendered here; plain text only
}

// Input is everything Generate needs to produce one merged export.
type Input struct {
	Setlist Setlist
	Entries []Entry
	Shape   Shape
	Now     time.Time // generation timestamp for the colophon's "Generated" line
}

// Generate produces the complete merged PDF for one setlist export: a
// cover page, a table of contents, each program entry in order (a custom
// entry drawn as a generated stand-in page, a piece entry's own real PDF
// file spliced in verbatim at its own original page size), and a
// colophon.
//
// Merging is done via poppler's pdfunite (internal/pdf.Merge), not a
// pure-Go PDF-object-import library — an earlier version of this package
// used codeberg.org/go-pdf/fpdf/contrib/gofpdi (wrapping
// phpdave11/gofpdi) to import a piece's own pages directly into the fpdf
// document, and that panicked with a nil-pointer dereference on a
// perfectly ordinary real-world file (a plain PDF 1.3, produced by
// macOS's own Quartz PDFContext — ordinary Preview/print-to-PDF output,
// not an exotic edge case) — gofpdi's own object parser has a real
// robustness gap against real-world files that its own minimal test
// fixtures never exercised. pdfunite is part of poppler-utils, which
// this app already depends on and bundles across every distribution
// channel (Docker image, native macOS/Windows builds — CLAUDE.md's
// Native app section), so this swap adds no new dependency at all: each
// contiguous run of generated pages (cover/TOC/a custom entry's stand-in
// page/colophon) is drawn into its own small fpdf document and flushed
// to a temp file, a piece entry's own real file is referenced by its
// path directly (no page-by-page import needed — pdfunite pulls in a
// whole source file's pages at once), and the ordered list of temp
// files plus real piece files is concatenated by pdfunite into the
// final output.
func Generate(ctx context.Context, binDir string, input Input) ([]byte, error) {
	shape := input.Shape
	if shape == "" {
		shape = ShapeLetter
	}
	size := pageSize[shape]

	tmpDir, err := os.MkdirTemp("", "setlistpdf-*")
	if err != nil {
		return nil, fmt.Errorf("creating temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	newDoc := func() *fpdf.Fpdf {
		pdf := fpdf.NewCustom(&fpdf.InitType{
			OrientationStr: "P",
			UnitStr:        unit,
			SizeStr:        "",
			Size:           size,
		})
		registerFonts(pdf)
		pdf.SetAutoPageBreak(false, 0)
		pdf.SetMargins(0, 0, 0)
		return pdf
	}

	var segments []string
	segIdx := 0
	// flush writes the current chunk's pages (if any) to its own temp PDF
	// and appends it to segments. A no-op when nothing has been drawn
	// into this chunk yet — two piece entries back to back would
	// otherwise try to flush an empty (zero-page) document, which fpdf
	// can't Output at all.
	flush := func(pdf *fpdf.Fpdf) error {
		if pdf.PageNo() == 0 {
			return nil
		}
		if pdf.Err() {
			return pdf.Error()
		}
		segIdx++
		path := filepath.Join(tmpDir, fmt.Sprintf("chunk-%03d.pdf", segIdx))
		f, err := os.Create(path)
		if err != nil {
			return fmt.Errorf("creating chunk file: %w", err)
		}
		defer f.Close()
		if err := pdf.Output(f); err != nil {
			return fmt.Errorf("writing chunk pdf: %w", err)
		}
		segments = append(segments, path)
		return nil
	}

	layout := ComputeLayout(input.Entries)

	pdf := newDoc()
	drawCover(pdf, size, input.Setlist)
	drawTOC(pdf, size, layout, input.Setlist, input.Entries)

	for _, e := range input.Entries {
		if e.IsPiece {
			if err := flush(pdf); err != nil {
				return nil, fmt.Errorf("before importing %q: %w", e.PieceTitle, err)
			}
			if _, err := os.Stat(e.PieceFilePath); err != nil {
				return nil, fmt.Errorf("piece file for %q: %w", e.PieceTitle, err)
			}
			segments = append(segments, e.PieceFilePath)
			pdf = newDoc()
			continue
		}
		drawProgramPage(pdf, size, e)
	}

	drawColophon(pdf, size, input.Now)
	if err := flush(pdf); err != nil {
		return nil, fmt.Errorf("finalizing colophon: %w", err)
	}

	mergedPath := filepath.Join(tmpDir, "merged.pdf")
	if err := poppler.Merge(ctx, binDir, segments, mergedPath); err != nil {
		return nil, fmt.Errorf("merging setlist pdf: %w", err)
	}
	return os.ReadFile(mergedPath)
}

// diamondDivider draws the small rule-diamond-rule ornament every locked
// page design uses in place of the mockup's own literal "❧" fleuron —
// live-verified that no embedded weight of either Libre Baskerville or
// Cabin actually contains a glyph for U+2767, so this hand-drawn device
// (already part of the same design language, used elsewhere as the
// "has more to say below" divider) stands in everywhere the fleuron
// appeared, not just where it would otherwise fail to render.
func diamondDivider(pdf *fpdf.Fpdf, centerX, y, ruleWidth float64) {
	setDraw(pdf, colorBorder)
	pdf.SetLineWidth(0.75)
	pdf.Line(centerX-ruleWidth-4, y, centerX-4, y)
	pdf.Line(centerX+4, y, centerX+ruleWidth+4, y)
	setFill(pdf, colorAccent)
	pdf.TransformBegin()
	pdf.TransformRotate(45, centerX, y)
	pdf.Rect(centerX-2, y-2, 4, 4, "F")
	pdf.TransformEnd()
}

func formatDuration(seconds int) string {
	m := seconds / 60
	s := seconds % 60
	return fmt.Sprintf("%d:%02d", m, s)
}

func joinKeys(keys []string) string {
	return strings.Join(keys, " → ") // chevron-joined, matches the app's own key-sequence convention
}
