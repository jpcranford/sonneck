package setlistpdf

import (
	"codeberg.org/go-pdf/fpdf"

	"github.com/jpcranford/sonneck/internal/richtext"
)

// richWord and richParagraph are internal/richtext's words and paragraphs
// as this package's drawing code reads them.
type richWord struct {
	text         string
	bold, italic bool
	symbol       bool // draw via fontSymbol instead of the caller's base family
	breakBefore  bool // this word starts a new visual line (a single \n in the source)
	glued        bool // no space before it in the source; never wrapped away from the previous word
}

type richParagraph struct {
	words []richWord
}

// parseRichText reads Markdown through internal/richtext (see its Parse for
// the ambientItalic rule).
func parseRichText(markdown string, ambientItalic bool) []richParagraph {
	parsed := richtext.Parse(markdown, ambientItalic)
	out := make([]richParagraph, len(parsed))
	for i, p := range parsed {
		words := make([]richWord, len(p.Words))
		for j, w := range p.Words {
			words[j] = richWord{text: w.Text, bold: w.Bold, italic: w.Italic, symbol: w.Symbol, breakBefore: w.BreakBefore, glued: w.Glued}
		}
		out[i] = richParagraph{words: words}
	}
	return out
}

// richStyleFor returns the (family, style) fpdf needs for one word —
// symbols always go through fontSymbol at plain style, matching
// musicEmoji.ts's own not-italic/not-bold treatment.
func richStyleFor(w richWord, baseFamily string) (family, style string) {
	if w.symbol {
		return fontSymbol, ""
	}
	if w.bold && w.italic {
		return baseFamily, "BI"
	}
	if w.bold {
		return baseFamily, "B"
	}
	if w.italic {
		return baseFamily, "I"
	}
	return baseFamily, ""
}

// richLine is one wrapped line of a paragraph: its words, each with its
// own measured width, plus the line's total width including spaces.
type richLine struct {
	words []placedWord
	width float64
}

type placedWord struct {
	w     richWord
	width float64
}

// wrapRichParagraph breaks one paragraph into lines no wider than
// colWidth, measuring each word kerned in its own resolved font (see
// kerning.go). tracking is extra space between characters, as CSS
// letter-spacing adds it — a word boundary carries it twice (after the
// word's last letter, and after the space).
func wrapRichParagraph(pdf *fpdf.Fpdf, para richParagraph, colWidth float64, baseFamily string, baseSize, tracking float64) []richLine {
	pdf.SetFont(baseFamily, "", baseSize)
	sp := pdf.GetStringWidth(" ") + 2*tracking

	var lines []richLine
	var current richLine
	flush := func() {
		if len(current.words) > 0 {
			lines = append(lines, current)
		}
		current = richLine{}
	}
	words := para.words
	for i := 0; i < len(words); {
		// A word plus any glued to it wraps as one unit.
		j := i + 1
		for j < len(words) && words[j].glued {
			j++
		}
		group := make([]placedWord, 0, j-i)
		groupWidth := 0.0
		for k, w := range words[i:j] {
			family, style := richStyleFor(w, baseFamily)
			pdf.SetFont(family, style, baseSize)
			ww := kernedWidth(pdf, family, style, baseSize, w.text, tracking)
			if k > 0 {
				groupWidth += tracking
			}
			group = append(group, placedWord{w: w, width: ww})
			groupWidth += ww
		}

		needsBreak := words[i].breakBefore && len(current.words) > 0
		overflows := len(current.words) > 0 && current.width+sp+groupWidth > colWidth
		if needsBreak || overflows {
			flush()
		}
		if len(current.words) > 0 {
			current.width += sp
		}
		current.words = append(current.words, group...)
		current.width += groupWidth
		i = j
	}
	flush()
	return lines
}

// richTextHeight is the vertical space drawRichText would use for the same
// arguments — every wrapped line's lineHeight, plus paragraphSpacing
// between paragraphs — without drawing anything.
func richTextHeight(pdf *fpdf.Fpdf, colWidth, lineHeight, paragraphSpacing float64, baseFamily string, baseSize, tracking float64, paragraphs []richParagraph) float64 {
	h := 0.0
	for pi, para := range paragraphs {
		if pi > 0 {
			h += paragraphSpacing
		}
		h += float64(len(wrapRichParagraph(pdf, para, colWidth, baseFamily, baseSize, tracking))) * lineHeight
	}
	return h
}

// drawRichText renders parsed paragraphs word-wrapped within colWidth,
// starting at (x0, y), returning the y position just past the last line
// drawn. y is a zero-height fpdf cell's top — each line's baseline sits
// fpdfCellBaseline×size below it. align is "C" (centered, the cover page's
// description) or "L" (left-aligned, a custom entry's own description).
// Blank lines between paragraphs get a touch of extra spacing
// (paragraphSpacing) beyond the ordinary lineHeight. tracking is extra
// space between characters (0 for none); text is kerned either way.
func drawRichText(pdf *fpdf.Fpdf, x0, y, colWidth, lineHeight, paragraphSpacing float64, align string, baseFamily string, baseSize, tracking float64, baseColor rgbColor, paragraphs []richParagraph) float64 {
	pdf.SetFont(baseFamily, "", baseSize)
	sp := pdf.GetStringWidth(" ") + 2*tracking

	for pi, para := range paragraphs {
		if pi > 0 {
			y += paragraphSpacing
		}
		for _, line := range wrapRichParagraph(pdf, para, colWidth, baseFamily, baseSize, tracking) {
			x := x0
			if align == "C" {
				x = x0 + (colWidth-line.width)/2
			}
			baseline := y + fpdfCellBaseline*baseSize
			for i, pw := range line.words {
				if i > 0 {
					if pw.w.glued {
						x += tracking
					} else {
						x += sp
					}
				}
				family, style := richStyleFor(pw.w, baseFamily)
				pdf.SetFont(family, style, baseSize)
				setColor(pdf, baseColor)
				drawKerned(pdf, family, style, baseSize, x, baseline, pw.w.text, tracking)
				x += pw.width
			}
			y += lineHeight
		}
	}
	return y
}
