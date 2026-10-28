// Package richtext reads the small Markdown subset Sonneck's PDFs draw —
// paragraphs, a single newline as a line break, **bold**, *italic* /
// _italic_, and the :shortcode: music symbols — into words carrying their
// own style, ready to wrap. Shared by the Setlist PDF (internal/setlistpdf)
// and annotated piece downloads (internal/annotpdf).
package richtext

import (
	"regexp"
	"sort"
	"strings"
	"unicode"
)

// Shortcodes mirrors frontend/src/lib/musicEmoji.ts's MUSIC_SHORTCODES
// map exactly (codepoint-for-codepoint, ported by hand since there's no
// shared source of truth between the Go and TS sides) — the same
// :shortcode: -> Bravura Text glyph substitution MarkdownText makes on
// the web. Keep this in sync with that file if
// the shortcode list ever changes.
var Shortcodes = map[string]rune{
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

// emphasis matches a **bold** or *italic*/_italic_ span. Resolved as
// its own first pass, separately from shortcode extraction (shortcode
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
var emphasis = regexp.MustCompile(`(?s)\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_`)

// shortcode matches one :shortcode: token, scanned independently
// within each plain or emphasis-captured segment emphasis produces.
var shortcode = regexp.MustCompile(`:(` + shortcodeAlternation() + `):`)

func shortcodeAlternation() string {
	codes := make([]string, 0, len(Shortcodes))
	for k := range Shortcodes {
		codes = append(codes, regexp.QuoteMeta(k))
	}
	sort.Slice(codes, func(i, j int) bool { return len(codes[i]) > len(codes[j]) })
	return strings.Join(codes, "|")
}

type Word struct {
	Text         string
	Bold, Italic bool
	Symbol       bool // a music symbol, drawn in Bravura Text, never bold or slanted
	BreakBefore  bool // this word starts a new visual line (a single \n in the source)
	// glued: no whitespace separated this from the previous word in the
	// source (a style or shortcode boundary inside one word, e.g. the "."
	// in "*subito :pp:*."), so it's drawn with no space before it and
	// never wrapped away from it.
	Glued bool
}

type Paragraph struct {
	Words []Word
}

// Parse turns Markdown source (a setlist's description, a custom entry's
// notes, a Sheet Viewer text mark) into paragraphs of word-level tokens
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
func Parse(markdown string, ambientItalic bool) []Paragraph {
	markdown = strings.ReplaceAll(markdown, "\r\n", "\n")
	blankLine := regexp.MustCompile(`\n[ \t]*\n+`)
	paraTexts := blankLine.Split(strings.TrimSpace(markdown), -1)

	paragraphs := make([]Paragraph, 0, len(paraTexts))
	for _, paraText := range paraTexts {
		paraText = strings.TrimSpace(paraText)
		if paraText == "" {
			continue
		}
		lines := strings.Split(paraText, "\n")
		var words []Word
		for lineIdx, line := range lines {
			lineWords := tokenizeLine(line, ambientItalic)
			if lineIdx > 0 && len(lineWords) > 0 {
				lineWords[0].BreakBefore = true
			}
			words = append(words, lineWords...)
		}
		if len(words) > 0 {
			paragraphs = append(paragraphs, Paragraph{Words: words})
		}
	}
	return paragraphs
}

// tokenizeLine resolves inline bold/italic spans in one line of source
// text first, then independently resolves :shortcode: tokens within each
// resulting segment (see emphasis's own doc comment for why), finally
// splitting everything into individual whitespace-separated words
// carrying their own resolved style, so drawRichText can wrap at word
// boundaries without losing which style each word belongs to. A word
// that touches the previous one with no whitespace between them in the
// source — across a style or shortcode boundary — is marked glued.
func tokenizeLine(line string, ambientItalic bool) []Word {
	// runs is the line in source order, each piece with its resolved
	// style; whitespace is still inside the plain runs at this point.
	type run struct {
		text                 string
		bold, italic, symbol bool
	}
	var runs []run

	// appendSegment resolves any :shortcode: tokens within one already
	// emphasis-resolved segment, keeping the text around them as runs
	// carrying the given (bold, italic) style.
	appendSegment := func(text string, bold, italic bool) {
		last := 0
		for _, m := range shortcode.FindAllStringSubmatchIndex(text, -1) {
			runs = append(runs, run{text: text[last:m[0]], bold: bold, italic: italic})
			// The regex's own alternation is built directly from
			// Shortcodes' keys, so a match here can never miss the
			// map — an unrecognized :name: simply never matches this
			// pattern at all and falls through as ordinary plain text
			// (including its colons).
			runs = append(runs, run{text: string(Shortcodes[text[m[2]:m[3]]]), symbol: true})
			last = m[1]
		}
		runs = append(runs, run{text: text[last:], bold: bold, italic: italic})
	}

	last := 0
	for _, m := range emphasis.FindAllStringSubmatchIndex(line, -1) {
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

	var words []Word
	spaceBefore := true // nothing to glue to at the start of a line
	for _, r := range runs {
		if r.symbol {
			words = append(words, Word{Text: r.text, Symbol: true, Glued: !spaceBefore})
			spaceBefore = false
			continue
		}
		start := -1
		for i, c := range r.text {
			if unicode.IsSpace(c) {
				if start >= 0 {
					words = append(words, Word{Text: r.text[start:i], Bold: r.bold, Italic: r.italic, Glued: !spaceBefore})
					start = -1
				}
				spaceBefore = true
				continue
			}
			if start < 0 {
				start = i
			}
		}
		if start >= 0 {
			words = append(words, Word{Text: r.text[start:], Bold: r.bold, Italic: r.italic, Glued: !spaceBefore})
			spaceBefore = false
		}
	}
	return words
}
