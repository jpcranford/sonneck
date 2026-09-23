package setlistpdf

import (
	"regexp"
	"sort"
	"strings"

	"codeberg.org/go-pdf/fpdf"
)

// musicShortcodes mirrors frontend/src/lib/musicEmoji.ts's MUSIC_SHORTCODES
// map exactly (codepoint-for-codepoint, ported by hand since there's no
// shared source of truth between the Go and TS sides) — the same
// :shortcode: -> Bravura Text glyph substitution a setlist/entry
// description already gets on the web. Keep this in sync with that file if
// the shortcode list ever changes.
var musicShortcodes = map[string]rune{
	"piano": 0xE520, "p": 0xE520,
	"mezzo": 0xE521, "m": 0xE521,
	"forte": 0xE522, "f": 0xE522,
	"pianissimo": 0xE52B, "pp": 0xE52B,
	"mezzopiano": 0xE52C, "mp": 0xE52C,
	"mezzoforte": 0xE52D, "mf": 0xE52D,
	"fortissimo": 0xE52F, "ff": 0xE52F,
	"flat": 0x266D, "b": 0x266D,
	"natural": 0x266E,
	"sharp":   0x266F, "#": 0x266F,
	"doublesharp": 0xED63, "##": 0xED63,
	"doubleflat": 0xED64, "bb": 0xED64,
	"dalsegno": 0xE045, "ds": 0xE045,
	"dacapo": 0xE046, "dc": 0xE046,
	"segno":   0xE047,
	"coda":    0xE048,
	"treble":  0xE050,
	"alto":    0xE05C,
	"bass":    0xE062,
	"glasses": 0xEC62, "look": 0xEC62,
}

// richEmphasis matches a **bold** or *italic*/_italic_ span. Resolved as
// its own first pass, separately from shortcode extraction (richShortcode
// below) — a :shortcode: commonly sits *inside* an emphasis span in real
// descriptions (e.g. "*subito :pp:*", found live against setlist id 5's
// own real description text), and running emphasis-matching over the
// whole line first, then re-scanning each resulting plain/emphasis
// segment for shortcodes independently, resolves that correctly without
// needing a single combined regex to reason about both constructs
// nesting into each other at once. The real, accepted tradeoff this
// two-pass order makes: a shortcode whose surrounding `**`/`*` markers
// land in two different segments split by an *earlier* shortcode match
// (e.g. "**bold :ff: text**") won't be recognized as emphasis — genuinely
// rare in a real setlist/entry description, and out of scope the same
// way nested emphasis (`**a *b* c**`) already is.
var richEmphasis = regexp.MustCompile(`(?s)\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_`)

// richShortcode matches one :shortcode: token, scanned independently
// within each plain or emphasis-captured segment richEmphasis produces.
var richShortcode = regexp.MustCompile(`:(` + shortcodeAlternation() + `):`)

func shortcodeAlternation() string {
	codes := make([]string, 0, len(musicShortcodes))
	for k := range musicShortcodes {
		codes = append(codes, regexp.QuoteMeta(k))
	}
	sort.Slice(codes, func(i, j int) bool { return len(codes[i]) > len(codes[j]) })
	return strings.Join(codes, "|")
}

type richWord struct {
	text         string
	bold, italic bool
	symbol       bool // draw via fontSymbol instead of the caller's base family
	breakBefore  bool // this word starts a new visual line (a single \n in the source)
}

type richParagraph struct {
	words []richWord
}

// parseRichText turns markdown source (a setlist's own description, or a
// custom entry's own description/notes — the two Markdown-capable fields
// this package ever needs to render) into paragraphs of word-level tokens
// ready for word-wrapping. ambientItalic mirrors index.css's real
// `.italic em { font-style: normal }` rule exactly (CLAUDE.md > Frontend's
// standing gotcha log) — when the surrounding block is itself styled
// italic (the cover page's description), plain text and *em* spans swap
// which one renders upright vs. slanted, rather than both naively
// rendering italic; **strong** always keeps the ambient's own italic
// state and adds bold on top, matching a bare <strong> tag's real
// behavior (no font-style override of its own). A :shortcode: symbol
// never inherits ambient italic at all, matching musicEmoji.ts's own
// `not-italic` wrapper span.
func parseRichText(markdown string, ambientItalic bool) []richParagraph {
	markdown = strings.ReplaceAll(markdown, "\r\n", "\n")
	blankLine := regexp.MustCompile(`\n[ \t]*\n+`)
	paraTexts := blankLine.Split(strings.TrimSpace(markdown), -1)

	paragraphs := make([]richParagraph, 0, len(paraTexts))
	for _, paraText := range paraTexts {
		paraText = strings.TrimSpace(paraText)
		if paraText == "" {
			continue
		}
		lines := strings.Split(paraText, "\n")
		var words []richWord
		for lineIdx, line := range lines {
			lineWords := tokenizeLine(line, ambientItalic)
			if lineIdx > 0 && len(lineWords) > 0 {
				lineWords[0].breakBefore = true
			}
			words = append(words, lineWords...)
		}
		if len(words) > 0 {
			paragraphs = append(paragraphs, richParagraph{words: words})
		}
	}
	return paragraphs
}

// tokenizeLine resolves inline bold/italic spans in one line of source
// text first, then independently resolves :shortcode: tokens within each
// resulting segment (see richEmphasis's own doc comment for why), finally
// splitting everything into individual whitespace-separated words
// carrying their own resolved style, so drawRichText can wrap at word
// boundaries without losing which style each word belongs to.
func tokenizeLine(line string, ambientItalic bool) []richWord {
	var words []richWord

	// appendSegment resolves any :shortcode: tokens within one already
	// emphasis-resolved segment, splitting the rest into plain words
	// carrying the given (bold, italic) style.
	appendSegment := func(text string, bold, italic bool) {
		last := 0
		for _, m := range richShortcode.FindAllStringSubmatchIndex(text, -1) {
			for _, w := range strings.Fields(text[last:m[0]]) {
				words = append(words, richWord{text: w, bold: bold, italic: italic})
			}
			// The regex's own alternation is built directly from
			// musicShortcodes' keys, so a match here can never miss the
			// map — an unrecognized :name: simply never matches this
			// pattern at all and falls through as ordinary plain text
			// (including its colons) below.
			words = append(words, richWord{text: string(musicShortcodes[text[m[2]:m[3]]]), symbol: true})
			last = m[1]
		}
		for _, w := range strings.Fields(text[last:]) {
			words = append(words, richWord{text: w, bold: bold, italic: italic})
		}
	}

	last := 0
	for _, m := range richEmphasis.FindAllStringSubmatchIndex(line, -1) {
		appendSegment(line[last:m[0]], false, ambientItalic)
		switch {
		case m[2] >= 0: // **bold**
			appendSegment(line[m[2]:m[3]], true, ambientItalic)
		case m[4] >= 0: // *italic*
			appendSegment(line[m[4]:m[5]], false, !ambientItalic)
		case m[6] >= 0: // _italic_
			appendSegment(line[m[6]:m[7]], false, !ambientItalic)
		}
		last = m[1]
	}
	appendSegment(line[last:], false, ambientItalic)
	return words
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

// drawRichText renders parsed paragraphs word-wrapped within colWidth,
// starting at (x0, y), returning the y position just past the last line
// drawn. align is "C" (centered, the cover page's description) or "L"
// (left-aligned, a custom entry's own description). Blank lines between
// paragraphs get a touch of extra spacing (paragraphSpacing) beyond the
// ordinary lineHeight.
func drawRichText(pdf *fpdf.Fpdf, x0, y, colWidth, lineHeight, paragraphSpacing float64, align string, baseFamily string, baseSize float64, baseColor rgbColor, paragraphs []richParagraph) float64 {
	spaceWidth := func(family, style string) float64 {
		pdf.SetFont(family, style, baseSize)
		return pdf.GetStringWidth(" ")
	}

	for pi, para := range paragraphs {
		if pi > 0 {
			y += paragraphSpacing
		}

		type placedWord struct {
			w     richWord
			width float64
		}
		var lines [][]placedWord
		var current []placedWord
		var currentWidth float64

		flush := func() {
			if len(current) > 0 {
				lines = append(lines, current)
			}
			current = nil
			currentWidth = 0
		}

		for _, w := range para.words {
			family, style := richStyleFor(w, baseFamily)
			pdf.SetFont(family, style, baseSize)
			ww := pdf.GetStringWidth(w.text)
			sp := spaceWidth(baseFamily, "")

			needsBreak := w.breakBefore && len(current) > 0
			overflows := len(current) > 0 && currentWidth+sp+ww > colWidth
			if needsBreak || overflows {
				flush()
			}
			if len(current) > 0 {
				currentWidth += sp
			}
			current = append(current, placedWord{w: w, width: ww})
			currentWidth += ww
		}
		flush()

		for _, line := range lines {
			lineWidth := 0.0
			for i, pw := range line {
				if i > 0 {
					lineWidth += spaceWidth(baseFamily, "")
				}
				lineWidth += pw.width
			}
			x := x0
			if align == "C" {
				x = x0 + (colWidth-lineWidth)/2
			}
			for i, pw := range line {
				if i > 0 {
					x += spaceWidth(baseFamily, "")
				}
				family, style := richStyleFor(pw.w, baseFamily)
				pdf.SetFont(family, style, baseSize)
				setColor(pdf, baseColor)
				pdf.SetXY(x, y)
				pdf.CellFormat(pw.width, 0, pw.w.text, "", 0, "L", false, 0, "")
				x += pw.width
			}
			y += lineHeight
		}
	}
	return y
}
