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
		fontDisplayMedium:     fontLibreBaskervilleMedium,
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

// symbolFont is the Bravura Text subset, parsed only to know which
// characters it covers — the fallback for music symbols (♭/♯/♮ in a key
// name or title) that neither Cabin nor Libre Baskerville has, the way the
// browser falls back through the app's font stacks (index.css).
var symbolFont = func() *sfnt.Font {
	f, err := sfnt.Parse(fontBravuraText)
	if err != nil {
		panic("setlistpdf: parsing embedded font " + fontSymbol + ": " + err.Error())
	}
	return f
}()

// hasGlyph reports whether f maps r to a real glyph.
func hasGlyph(f *sfnt.Font, buf *sfnt.Buffer, r rune) bool {
	g, err := f.GlyphIndex(buf, r)
	return err == nil && g != 0
}

// fontFor picks the font one character is drawn in: the requested
// family/style when it has the glyph, else Bravura Text when that does
// (a music symbol), else the requested font anyway. Spaces always stay in
// the requested font.
func fontFor(family, style string, r rune, buf *sfnt.Buffer) (string, string) {
	if r == ' ' || family == fontSymbol {
		return family, style
	}
	if f := kerningFonts[family+style]; f != nil && hasGlyph(f, buf, r) {
		return family, style
	}
	if hasGlyph(symbolFont, buf, r) {
		return fontSymbol, ""
	}
	return family, style
}

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
// kerning to the next character, plus tracking between characters) and
// the font it's drawn in (see fontFor). The last character carries no
// trailing tracking, so a line's width is just the sum. family/style/size
// is the text's own font; fpdf is left set to it afterwards.
func kernedAdvances(pdf *fpdf.Fpdf, family, style string, size float64, text string, tracking float64) ([]float64, [][2]string) {
	runes := []rune(text)
	var buf sfnt.Buffer
	fonts := make([][2]string, len(runes))
	for i, r := range runes {
		f, st := fontFor(family, style, r, &buf)
		fonts[i] = [2]string{f, st}
	}
	adv := make([]float64, len(runes))
	kerners := map[[2]string]*kerner{}
	for i, r := range runes {
		pdf.SetFont(fonts[i][0], fonts[i][1], size)
		adv[i] = pdf.GetStringWidth(string(r))
		if i+1 < len(runes) {
			// Kerning only between two characters in the same font.
			if fonts[i+1] == fonts[i] {
				k := kerners[fonts[i]]
				if k == nil {
					k = newKerner(fonts[i][0], fonts[i][1], size)
					kerners[fonts[i]] = k
				}
				adv[i] += k.pair(r, runes[i+1])
			}
			adv[i] += tracking
		}
	}
	pdf.SetFont(family, style, size)
	return adv, fonts
}

// kernedWidth is text's drawn width in family/style/size.
func kernedWidth(pdf *fpdf.Fpdf, family, style string, size float64, text string, tracking float64) float64 {
	adv, _ := kernedAdvances(pdf, family, style, size, text, tracking)
	w := 0.0
	for _, a := range adv {
		w += a
	}
	return w
}

// drawKerned draws text in family/style/size with its left edge at x and
// its baseline at y, returning the x just past it. The current text color
// is used for every character, fallback symbols included.
func drawKerned(pdf *fpdf.Fpdf, family, style string, size, x, baseline float64, text string, tracking float64) float64 {
	adv, fonts := kernedAdvances(pdf, family, style, size, text, tracking)
	for i, r := range []rune(text) {
		if r != ' ' {
			pdf.SetFont(fonts[i][0], fonts[i][1], size)
			pdf.Text(x, baseline, string(r))
		}
		x += adv[i]
	}
	pdf.SetFont(family, style, size)
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

// CanDraw reports whether every character of text has a glyph in the text
// font the packet's dates are set in (Cabin) or the Bravura fallback — for
// a caller choosing a locale's date format, which may be in a script these
// fonts don't cover.
func CanDraw(text string) bool {
	var buf sfnt.Buffer
	cabin := kerningFonts[fontSans]
	for _, r := range text {
		if r == ' ' || hasGlyph(cabin, &buf, r) || hasGlyph(symbolFont, &buf, r) {
			continue
		}
		return false
	}
	return true
}
