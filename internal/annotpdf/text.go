package annotpdf

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"golang.org/x/image/font/sfnt"

	"github.com/jpcranford/sonneck/internal/richtext"
)

// A text mark's layout, matching how the Sheet Viewer draws one
// (components/SheetViewerAnnotations.tsx's TextMarks, lib/sheetViewerTools.ts's
// textBoxStyle): Quintessential at the mark's size (a percent of the page's
// width) with no letter-spacing, lines 1.25 of the size apart,
// the box's top one size above y, wrapped 1% of the page short of its right
// edge, a word too long for a line broken anywhere. Markdown and :shortcodes:
// as MarkdownText reads them; Quintessential has one weight and no italic,
// so — like the browser — bold is drawn heavier and italic slanted.

const (
	lineHeight = 1.25
	// Paragraphs (a blank line between) sit apart by MarkdownText's mb-2,
	// 8px whatever the page's size; about 0.65em at the size M on an iPad.
	paragraphGap = 0.65
	// The browser's synthetic italic slant and bold stroke.
	italicSkew = 0.25
	boldStroke = 1.0 / 28
)

// glyphRun is consecutive glyphs of one word in one font.
type glyphRun struct {
	font   *textFont
	glyphs []sfnt.GlyphIndex
	kerns  []float64 // kerning after each glyph, thousandths of an em
	text   string
}

// placedWord is a word placed on its line, x from the box's left, in em.
type placedWord struct {
	x            float64
	runs         []glyphRun
	bold, italic bool
}

// textLayout is a text mark laid out in em, from its box's top left.
type textLayout struct {
	lines     [][]placedWord
	baselines []float64 // each line's baseline, from the box's top
	width     float64   // the widest line
	height    float64
	plain     string // the text as plain text, for Contents
}

// layoutText lays a mark's text out in a box maxWidth ems wide.
func layoutText(text string, italic bool, maxWidth float64) textLayout {
	var buf sfnt.Buffer
	var out textLayout
	// Where the first line's baseline sits in its line box: the line's
	// extra height split above and below the font's own (CSS half-leading).
	first := (lineHeight-(handFont.ascent+handFont.descent))/2 + handFont.ascent
	y := 0.0
	var plain []string
	for pi, para := range richtext.Parse(text, false) {
		if pi > 0 {
			y += paragraphGap
		}
		var line []placedWord
		var lineText []string
		x := 0.0
		flush := func() {
			out.lines = append(out.lines, line)
			out.baselines = append(out.baselines, y+first)
			out.width = max(out.width, x)
			plain = append(plain, strings.Join(lineText, ""))
			line, lineText, x = nil, nil, 0
			y += lineHeight
		}
		space := handFont.widths[handFont.glyph(&buf, ' ')] / 1000
		for _, unit := range glueUnits(para.Words) {
			if unit[0].BreakBefore && len(line) > 0 {
				flush()
			}
			width := 0.0
			for _, w := range unit {
				width += wordWidth(&buf, w)
			}
			gap := 0.0
			if len(line) > 0 {
				gap = space
			}
			if len(line) > 0 && x+gap+width > maxWidth {
				flush()
				gap = 0
			}
			if len(line) > 0 {
				lineText = append(lineText, " ")
			}
			x += gap
			for _, w := range unit {
				// A word wider than a whole line breaks anywhere.
				for _, piece := range splitWord(&buf, w, maxWidth, x) {
					if piece.newLine {
						flush()
					}
					line = append(line, placedWord{x: x, runs: wordRuns(&buf, piece.word), bold: w.Bold, italic: (w.Italic || italic) && !w.Symbol})
					lineText = append(lineText, piece.word.Text)
					x += wordWidth(&buf, piece.word)
				}
			}
		}
		if len(line) > 0 {
			flush()
		}
	}
	out.height = y
	out.plain = strings.Join(plain, "\n")
	return out
}

// glueUnits groups words that touch in the source (a style or symbol
// boundary inside a word), which wrap as one.
func glueUnits(words []richtext.Word) [][]richtext.Word {
	var units [][]richtext.Word
	for _, w := range words {
		if w.Glued && len(units) > 0 && !w.BreakBefore {
			units[len(units)-1] = append(units[len(units)-1], w)
			continue
		}
		units = append(units, []richtext.Word{w})
	}
	return units
}

type wordPiece struct {
	word    richtext.Word
	newLine bool
}

// splitWord breaks a word that won't fit on a line of its own into pieces
// that do, the first one starting at x.
func splitWord(buf *sfnt.Buffer, w richtext.Word, maxWidth, x float64) []wordPiece {
	if wordWidth(buf, w) <= maxWidth-x || utf8.RuneCountInString(w.Text) < 2 {
		return []wordPiece{{word: w}}
	}
	var pieces []wordPiece
	start, width := 0, 0.0
	newLine := false
	for i, r := range w.Text {
		cw := wordWidth(buf, richtext.Word{Text: string(r), Symbol: w.Symbol})
		if i > start && x+width+cw > maxWidth {
			part := w
			part.Text = w.Text[start:i]
			pieces = append(pieces, wordPiece{word: part, newLine: newLine})
			start, width, x, newLine = i, 0, 0, true
		}
		width += cw
	}
	part := w
	part.Text = w.Text[start:]
	return append(pieces, wordPiece{word: part, newLine: newLine})
}

// fontFor picks the font a character is drawn in, the way the browser walks
// --font-hand: Quintessential, else Bravura Text (the music symbols).
func fontFor(buf *sfnt.Buffer, r rune, symbol bool) *textFont {
	if symbol || (r != ' ' && handFont.glyph(buf, r) == 0 && symbolFont.glyph(buf, r) != 0) {
		return symbolFont
	}
	return handFont
}

// wordRuns splits a word into runs of one font, kerned within each.
func wordRuns(buf *sfnt.Buffer, w richtext.Word) []glyphRun {
	var runs []glyphRun
	for _, r := range w.Text {
		f := fontFor(buf, r, w.Symbol)
		g := f.glyph(buf, r)
		if n := len(runs); n > 0 && runs[n-1].font == f {
			last := &runs[n-1]
			last.kerns[len(last.kerns)-1] = f.kern(buf, last.glyphs[len(last.glyphs)-1], g)
			last.glyphs = append(last.glyphs, g)
			last.kerns = append(last.kerns, 0)
			last.text += string(r)
			continue
		}
		runs = append(runs, glyphRun{font: f, glyphs: []sfnt.GlyphIndex{g}, kerns: []float64{0}, text: string(r)})
	}
	return runs
}

// wordWidth is a word's advance in em: glyph widths and kerning.
func wordWidth(buf *sfnt.Buffer, w richtext.Word) float64 {
	width := 0.0
	for _, run := range wordRuns(buf, w) {
		for i, g := range run.glyphs {
			width += (run.font.widths[g] + run.kerns[i]) / 1000
		}
	}
	return width
}

// fontNames are the resource names text appearances use for the two fonts.
var fontNames = map[*textFont]string{handFont: "Hand", symbolFont: "Sym"}

// drawText writes the content-stream operators for a laid-out mark: size
// in points, its box's top left at (left, top) in a y-up space.
func drawText(b *strings.Builder, l textLayout, size, left, top float64, color [3]float64) {
	fmt.Fprintf(b, "BT\n%s rg %s RG\n", num3(color), num3(color))
	for i, line := range l.lines {
		baseline := top - l.baselines[i]*size
		for _, w := range line {
			skew := 0.0
			if w.italic {
				skew = italicSkew
			}
			if w.bold {
				fmt.Fprintf(b, "2 Tr %s w\n", num(boldStroke*size))
			} else {
				b.WriteString("0 Tr\n")
			}
			fmt.Fprintf(b, "1 0 %s 1 %s %s Tm\n", num(skew), num(left+w.x*size), num(baseline))
			for _, run := range w.runs {
				fmt.Fprintf(b, "/%s %s Tf [", fontNames[run.font], num(size))
				for gi, g := range run.glyphs {
					fmt.Fprintf(b, "<%04X>", int(g))
					if k := run.kerns[gi]; k != 0 && gi < len(run.glyphs)-1 {
						b.WriteString(num(-k))
					}
				}
				b.WriteString("] TJ\n")
			}
		}
	}
	b.WriteString("ET\n")
}
