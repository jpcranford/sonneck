package setlistpdf

import (
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	"codeberg.org/go-pdf/fpdf"
)

// The table of contents' layout, in points — the locked design, drawn at
// these same values by SetlistProgramPageMockup.tsx's Table of Contents.
const (
	tocMargin          = 72.0 // every side
	tocNameSize        = 24.0 // 2x the 12pt body
	tocNameLeading     = 1.24 // Libre Baskerville's own ascent+descent
	tocNameMetaGap     = 4.0
	tocMetaSize        = 12 * cabinOptical
	tocMetaTracking    = 0.02 // em
	tocMetaLeading     = 1.4
	tocHeaderGap       = 24.0 // header block to the label row
	tocLabelSize       = 9 * cabinOptical
	tocLabelTracking   = 0.10 // em
	tocLabelLeading    = 1.4
	tocLabelRulePad    = 5.0 // label text to its rule
	tocRuleWidth       = 1.0
	tocRowsTopGap      = 10.0 // rule to the first row
	tocRowSize         = 12.0
	tocRowLeading      = tocRowSize * 1.24
	tocRowGap          = 12.0
	tocNumberWidth     = 24.0 // right-aligned display number column
	tocNumberGap       = 10.0 // number column to title (and a wrapped line's hanging indent)
	tocParenSize       = 9 * cabinOptical
	tocParenTracking   = 0.02 // em
	tocChevronSpace    = 0.3  // em, each side of a key chevron
	tocLeaderMin       = 24.0
	tocLeaderBefore    = 6.0 // after the title's last line
	tocLeaderAfter     = 3.0 // before the page number
	tocLeaderPitch     = 4.0
	tocLeaderDot       = 0.8 // radius
	tocPageMinWidth    = 16.0
	baskervilleAscent  = 0.97
	baskervilleDescent = 0.27
)

// fontDisplayMedium is Libre Baskerville at weight 500, a piece title's
// weight — registered as its own family, like Cabin SemiBold, since fpdf's
// style flags only cover regular/bold/italic.
const fontDisplayMedium = fontDisplay + "Medium"

// tocRun is one stretch of text in a single font and color, with optional
// space around it (a key chevron's).
type tocRun struct {
	text             string
	family, style    string
	size, tracking   float64 // tracking in points
	marginL, marginR float64
	color            rgbColor
	width            float64 // text width, margins excluded
}

// tocItem is what a row wraps by: one title word, or the whole
// parenthetical, which never breaks.
type tocItem struct {
	runs        []tocRun
	width       float64
	spaceBefore float64 // the space before it when it isn't first on its line
}

type tocRowPlan struct {
	num, page string
	lines     [][]tocItem
	height    float64
}

// tocPlan is the TOC fully measured: the header's lines and every row's
// wrapped lines, split into pages.
type tocPlan struct {
	nameLines []string
	metaLines []string
	rows      []tocRowPlan
	pages     [][]int // row indices on each TOC page
}

// shortKey is the TOC's key form: the stored name read case- and space-
// insensitively — a major key is just its note, a minor key gets "m"
// ("E♭ Major" -> "E♭", "C♯ Minor" -> "C♯m"). A name that isn't
// "<note> major/minor" is shown as stored. Mirrors the mockup's shortKey.
func shortKey(name string) string {
	k := strings.ToLower(strings.Join(strings.Fields(name), ""))
	for _, q := range []struct{ suffix, add string }{{"major", ""}, {"minor", "m"}} {
		if note, ok := strings.CutSuffix(k, q.suffix); ok && note != "" {
			r, size := utf8.DecodeRuneInString(note)
			return string(unicode.ToUpper(r)) + note[size:] + q.add
		}
	}
	return name
}

// formatApproximately is the header's total, to the nearest minute:
// "approximately 1 hour 28 minutes".
func formatApproximately(seconds int) string {
	minutes := max(1, (seconds+30)/60)
	unit := func(n int, word string) string {
		if n == 1 {
			return "1 " + word
		}
		return fmt.Sprintf("%d %ss", n, word)
	}
	var parts []string
	if h := minutes / 60; h > 0 {
		parts = append(parts, unit(h, "hour"))
	}
	if m := minutes % 60; m > 0 {
		parts = append(parts, unit(m, "minute"))
	}
	return "approximately " + strings.Join(parts, " ")
}

func (r *tocRun) measure(pdf *fpdf.Fpdf) {
	r.width = kernedWidth(pdf, r.family, r.style, r.size, r.text, r.tracking)
}

func (r *tocRun) draw(pdf *fpdf.Fpdf, x, baseline float64) float64 {
	x += r.marginL
	pdf.SetFont(r.family, r.style, r.size)
	setColor(pdf, r.color)
	drawKerned(pdf, r.family, r.style, r.size, x, baseline, r.text, r.tracking)
	return x + r.width + r.marginR
}

func newTocItem(pdf *fpdf.Fpdf, spaceBefore float64, runs ...tocRun) tocItem {
	item := tocItem{spaceBefore: spaceBefore}
	for i := range runs {
		runs[i].measure(pdf)
		item.width += runs[i].marginL + runs[i].width + runs[i].marginR
	}
	item.runs = runs
	return item
}

func spaceWidth(pdf *fpdf.Fpdf, family, style string, size float64) float64 {
	pdf.SetFont(family, style, size)
	return pdf.GetStringWidth(" ")
}

// tocParenthetical is a row's "(role • keys • duration)", whichever parts
// it has, as runs — each key chevron its own run, lighter and spaced the way
// the app joins a key sequence everywhere else.
func tocParenthetical(e Entry) []tocRun {
	var role *string
	var keys []string
	var seconds *int
	if e.IsPiece {
		role, keys, seconds = e.PieceRole, e.PieceKeys, e.PieceDuration
	} else {
		role, seconds = e.CustomRole, e.CustomDurationSeconds
	}
	text := func(s string) tocRun {
		return tocRun{text: s, family: fontSans, size: tocParenSize, tracking: tocParenTracking * tocParenSize, color: colorInkSoft}
	}
	var parts [][]tocRun
	if role != nil && *role != "" {
		parts = append(parts, []tocRun{text(*role)})
	}
	if len(keys) > 0 {
		var ks []tocRun
		for i, k := range keys {
			if i > 0 {
				chevron := text("›")
				chevron.color = colorFainter
				chevron.marginL = tocChevronSpace * tocParenSize
				chevron.marginR = tocChevronSpace * tocParenSize
				ks = append(ks, chevron)
			}
			ks = append(ks, text(shortKey(k)))
		}
		parts = append(parts, ks)
	}
	if seconds != nil {
		parts = append(parts, []tocRun{text(formatDuration(*seconds))})
	}
	if len(parts) == 0 {
		return nil
	}
	runs := []tocRun{text("(")}
	for i, p := range parts {
		if i > 0 {
			runs = append(runs, text(" • "))
		}
		runs = append(runs, p...)
	}
	return append(runs, text(")"))
}

// wrapTocItems breaks a row's items into lines no wider than width.
func wrapTocItems(items []tocItem, width float64) [][]tocItem {
	var lines [][]tocItem
	var line []tocItem
	lineW := 0.0
	for _, it := range items {
		if len(line) > 0 && lineW+it.spaceBefore+it.width > width {
			lines = append(lines, line)
			line, lineW = nil, 0
		}
		if len(line) > 0 {
			lineW += it.spaceBefore
		}
		line = append(line, it)
		lineW += it.width
	}
	if len(line) > 0 {
		lines = append(lines, line)
	}
	return lines
}

func lineWidth(line []tocItem) float64 {
	w := 0.0
	for i, it := range line {
		if i > 0 {
			w += it.spaceBefore
		}
		w += it.width
	}
	return w
}

func contentWidth(size fpdf.SizeType) float64 { return size.Wd - 2*tocMargin }

// tocLabelBlock is the header row's height: its line, the gap, and its rule.
const tocLabelBlock = tocLabelSize*tocLabelLeading + tocLabelRulePad + tocRuleWidth

// planTOC measures the whole table of contents — the header (a long setlist
// name or date line wraps, taking room from the rows), then every row's
// wrapped lines — and fills each page with rows until the next one would
// cross the bottom margin. Continuation pages start at the top margin with
// only the header row. pdf is used for measuring only.
func planTOC(pdf *fpdf.Fpdf, size fpdf.SizeType, s Setlist, meta string, entries []Entry, layout Layout) tocPlan {
	cw := contentWidth(size)
	var plan tocPlan
	plan.nameLines = kernedLines(pdf, fontDisplay, "B", tocNameSize, s.Name, 0, cw)
	if meta != "" {
		plan.metaLines = kernedLines(pdf, fontSans, "", tocMetaSize, meta, tocMetaTracking*tocMetaSize, cw)
	}

	for i, e := range entries {
		num := "–"
		if e.DisplayNumber != nil {
			num = fmt.Sprintf("%d", *e.DisplayNumber)
		}
		page := fmt.Sprintf("%d", layout.EntryStartPage[i])

		titleFamily, titleStyle, titleColor, title := fontDisplayMedium, "", colorInk, e.PieceTitle
		if !e.IsPiece {
			titleFamily, titleStyle, titleColor, title = fontDisplay, "I", colorInkSoft, e.CustomName
		}
		titleSpace := spaceWidth(pdf, titleFamily, titleStyle, tocRowSize)
		var items []tocItem
		for _, word := range strings.Fields(title) {
			items = append(items, newTocItem(pdf, titleSpace, tocRun{text: word, family: titleFamily, style: titleStyle, size: tocRowSize, color: titleColor}))
		}
		if paren := tocParenthetical(e); paren != nil {
			items = append(items, newTocItem(pdf, spaceWidth(pdf, fontDisplay, "", tocRowSize), paren...))
		}

		pdf.SetFont(fontDisplay, "", tocRowSize)
		pageW := max(tocPageMinWidth, kernedWidth(pdf, fontDisplay, "", tocRowSize, page, 0))
		width := cw - tocNumberWidth - tocNumberGap - tocLeaderBefore - tocLeaderMin - tocLeaderAfter - pageW
		lines := wrapTocItems(items, width)
		if len(lines) == 0 {
			lines = [][]tocItem{nil}
		}
		plan.rows = append(plan.rows, tocRowPlan{num: num, page: page, lines: lines, height: float64(len(lines)) * tocRowLeading})
	}

	bottom := size.Ht - tocMargin
	y := tocFirstRowsTop(plan)
	var current []int
	for i, row := range plan.rows {
		if len(current) > 0 && y+row.height > bottom {
			plan.pages = append(plan.pages, current)
			current = nil
			y = tocMargin + tocLabelBlock + tocRowsTopGap
		}
		current = append(current, i)
		y += row.height + tocRowGap
	}
	plan.pages = append(plan.pages, current)
	return plan
}

// tocFirstRowsTop is where the first page's rows begin, below the header.
func tocFirstRowsTop(plan tocPlan) float64 {
	y := tocMargin + float64(len(plan.nameLines))*tocNameSize*tocNameLeading
	if len(plan.metaLines) > 0 {
		y += tocNameMetaGap + float64(len(plan.metaLines))*tocMetaSize*tocMetaLeading
	}
	return y + tocHeaderGap + tocLabelBlock + tocRowsTopGap
}

// drawTOC draws an already-planned table of contents, one page per
// plan.pages entry.
func drawTOC(pdf *fpdf.Fpdf, size fpdf.SizeType, plan tocPlan) {
	left := tocMargin
	right := size.Wd - tocMargin
	for pageIndex, rowIndices := range plan.pages {
		pdf.AddPageFormat("P", size)
		y := tocMargin

		if pageIndex == 0 {
			setColor(pdf, colorInk)
			pdf.SetFont(fontDisplay, "B", tocNameSize)
			lead := tocNameSize * tocNameLeading
			for _, line := range plan.nameLines {
				drawKerned(pdf, fontDisplay, "B", tocNameSize, left, baselineIn(y, lead, tocNameSize, baskervilleBoldAscent, baskervilleBoldDescent), line, 0)
				y += lead
			}
			if len(plan.metaLines) > 0 {
				y += tocNameMetaGap
				lead := tocMetaSize * tocMetaLeading
				setColor(pdf, colorInkSoft)
				pdf.SetFont(fontSans, "", tocMetaSize)
				for _, line := range plan.metaLines {
					drawKerned(pdf, fontSans, "", tocMetaSize, left, baselineIn(y, lead, tocMetaSize, cabinAscent, cabinDescent), line, tocMetaTracking*tocMetaSize)
					y += lead
				}
			}
			y += tocHeaderGap
		}

		// The header row: "PROGRAM" (or "PROGRAM, CONTINUED") and "PAGE",
		// small caps over a rule.
		labelLead := tocLabelSize * tocLabelLeading
		baseline := baselineIn(y, labelLead, tocLabelSize, cabinAscent, cabinDescent)
		tracking := tocLabelTracking * tocLabelSize
		setColor(pdf, colorInkSoft)
		pdf.SetFont(fontSans, "", tocLabelSize)
		label := "PROGRAM"
		if pageIndex > 0 {
			label = "PROGRAM, CONTINUED"
		}
		drawKerned(pdf, fontSans, "", tocLabelSize, left, baseline, label, tracking)
		// Letter-spacing also follows the last letter, so right-aligned text
		// ends one tracking short of the edge, as in the browser.
		pageLabelW := kernedWidth(pdf, fontSans, "", tocLabelSize, "PAGE", tracking)
		drawKerned(pdf, fontSans, "", tocLabelSize, right-pageLabelW-tracking, baseline, "PAGE", tracking)
		ruleY := y + labelLead + tocLabelRulePad + tocRuleWidth/2
		setDraw(pdf, colorFainter)
		pdf.SetLineWidth(tocRuleWidth)
		pdf.Line(left, ruleY, right, ruleY)
		y += tocLabelBlock + tocRowsTopGap

		for _, i := range rowIndices {
			drawTocRow(pdf, left, right, y, plan.rows[i])
			y += plan.rows[i].height + tocRowGap
		}
	}
}

func drawTocRow(pdf *fpdf.Fpdf, left, right, top float64, row tocRowPlan) {
	lineBaseline := func(i int) float64 {
		return baselineIn(top+float64(i)*tocRowLeading, tocRowLeading, tocRowSize, baskervilleAscent, baskervilleDescent)
	}

	// The display number, right-aligned in its column on the first line.
	pdf.SetFont(fontDisplay, "", tocRowSize)
	setColor(pdf, colorInkSoft)
	numW := kernedWidth(pdf, fontDisplay, "", tocRowSize, row.num, 0)
	drawKerned(pdf, fontDisplay, "", tocRowSize, left+tocNumberWidth-numW, lineBaseline(0), row.num, 0)

	// Title and parenthetical; wrapped lines hang under the title.
	textLeft := left + tocNumberWidth + tocNumberGap
	lastEnd := textLeft
	for li, line := range row.lines {
		x := textLeft
		for ii, it := range line {
			if ii > 0 {
				x += it.spaceBefore
			}
			for ri := range it.runs {
				x = it.runs[ri].draw(pdf, x, lineBaseline(li))
			}
		}
		lastEnd = textLeft + lineWidth(line)
	}

	// The page number, right-aligned on the last line, and the dot leader
	// running up to it.
	last := lineBaseline(len(row.lines) - 1)
	pdf.SetFont(fontDisplay, "", tocRowSize)
	setColor(pdf, colorInk)
	pageW := kernedWidth(pdf, fontDisplay, "", tocRowSize, row.page, 0)
	drawKerned(pdf, fontDisplay, "", tocRowSize, right-pageW, last, row.page, 0)
	leaderEnd := right - max(tocPageMinWidth, pageW) - tocLeaderAfter
	drawLeader(pdf, lastEnd+tocLeaderBefore, leaderEnd, last)
}

// drawLeader fills [from, to] with dots sitting on the baseline, counted
// back from the right end at a fixed pitch so dots line up down the page.
func drawLeader(pdf *fpdf.Fpdf, from, to, baseline float64) {
	setFill(pdf, colorFainter)
	for x := to - tocLeaderPitch + 1; x-tocLeaderDot >= from; x -= tocLeaderPitch {
		pdf.Circle(x, baseline-1, tocLeaderDot, "F")
	}
}
