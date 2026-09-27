package setlistpdf

import (
	"strings"

	"codeberg.org/go-pdf/fpdf"
	"golang.org/x/image/font"
	"golang.org/x/image/font/sfnt"
	"golang.org/x/image/math/fixed"
)

// fpdf draws text without kerning and has no letter-spacing, while the
// browser (and so the mockup) applies both. This file closes that gap:
// kerning pairs are read from each embedded font's own GPOS table via
// golang.org/x/image/font/sfnt, and text is placed one character at a
// time — each advance from fpdf's own glyph widths, plus the pair's
// kerning, plus any tracking. Measuring (kernedWidth) and drawing
// (drawKerned) share one walk over the text, so line-wrapping decisions
// always agree with what's drawn.

// kerningFonts maps an fpdf family+style (as registerFonts names them) to
// the same embedded bytes parsed for sfnt. A family missing here (the
// Bravura Text symbol font, which has no kerning) is drawn unkerned.
var kerningFonts = func() map[string]*sfnt.Font {
	sources := map[string][]byte{
		fontDisplay:           fontLibreBaskervilleRegular,
		fontDisplay + "I":     fontLibreBaskervilleItalic,
		fontDisplay + "B":     fontLibreBaskervilleBold,
		fontSans:              fontCabinRegular,
		fontSans + "I":        fontCabinItalic,
		fontSans + "B":        fontCabinBold,
		fontSans + "BI":       fontCabinBoldItalic,
		fontSans + "SemiBold": fontCabinSemiBold,
	}
	fonts := make(map[string]*sfnt.Font, len(sources))
	for key, b := range sources {
		f, err := sfnt.Parse(b)
		if err != nil {
			panic("setlistpdf: parsing embedded font " + key + ": " + err.Error())
		}
		fonts[key] = f
	}
	return fonts
}()

// kerner resolves kerning for one font at one size. Each call site makes
// its own (sfnt.Buffer isn't safe to share across goroutines, and
// concurrent exports are possible).
type kerner struct {
	font  *sfnt.Font
	buf   sfnt.Buffer
	scale float64 // points per font unit at this size
}

func newKerner(family, style string, size float64) *kerner {
	f := kerningFonts[family+style]
	if f == nil {
		return &kerner{}
	}
	return &kerner{font: f, scale: size / float64(f.UnitsPerEm())}
}

// pair returns the kerning between two characters, in points (negative
// pulls them together). 0 when the font has no entry for the pair.
func (k *kerner) pair(a, b rune) float64 {
	if k.font == nil {
		return 0
	}
	g0, err := k.font.GlyphIndex(&k.buf, a)
	if err != nil || g0 == 0 {
		return 0
	}
	g1, err := k.font.GlyphIndex(&k.buf, b)
	if err != nil || g1 == 0 {
		return 0
	}
	// A ppem equal to the font's own units-per-em makes Kern return the
	// raw value in font units (26.6 fixed point).
	upem := fixed.Int26_6(k.font.UnitsPerEm()) << 6
	v, err := k.font.Kern(&k.buf, g0, g1, upem, font.HintingNone)
	if err != nil {
		return 0
	}
	return float64(v) / 64 * k.scale
}

// kernedAdvances returns each character's advance (its own width, plus the
// kerning to the next character, plus tracking between characters) in
// the current fpdf font. The last character carries no trailing tracking,
// so a line's width is just the sum.
func kernedAdvances(pdf *fpdf.Fpdf, family, style string, size float64, text string, tracking float64) []float64 {
	runes := []rune(text)
	k := newKerner(family, style, size)
	adv := make([]float64, len(runes))
	for i, r := range runes {
		adv[i] = pdf.GetStringWidth(string(r))
		if i+1 < len(runes) {
			adv[i] += k.pair(r, runes[i+1]) + tracking
		}
	}
	return adv
}

// kernedWidth is text's drawn width in the current fpdf font (which must
// be family/style/size).
func kernedWidth(pdf *fpdf.Fpdf, family, style string, size float64, text string, tracking float64) float64 {
	w := 0.0
	for _, a := range kernedAdvances(pdf, family, style, size, text, tracking) {
		w += a
	}
	return w
}

// drawKerned draws text with its left edge at x and its baseline at y, in
// the current fpdf font (which must be family/style/size), returning the
// x just past it.
func drawKerned(pdf *fpdf.Fpdf, family, style string, size, x, baseline float64, text string, tracking float64) float64 {
	adv := kernedAdvances(pdf, family, style, size, text, tracking)
	for i, r := range []rune(text) {
		if r != ' ' {
			pdf.Text(x, baseline, string(r))
		}
		x += adv[i]
	}
	return x
}

// kernedLines wraps text into lines no wider than width, breaking at
// spaces, using kerned widths. A single word wider than the line stays
// whole on its own line rather than being split mid-word.
func kernedLines(pdf *fpdf.Fpdf, family, style string, size float64, text string, tracking, width float64) []string {
	var lines []string
	line := ""
	for _, word := range strings.Fields(text) {
		candidate := word
		if line != "" {
			candidate = line + " " + word
		}
		if line != "" && kernedWidth(pdf, family, style, size, candidate, tracking) > width {
			lines = append(lines, line)
			line = word
			continue
		}
		line = candidate
	}
	if line != "" {
		lines = append(lines, line)
	}
	return lines
}
