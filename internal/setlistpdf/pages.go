package setlistpdf

import (
	"codeberg.org/go-pdf/fpdf"
)

// The cover's layout, in points — the locked design, drawn at these same
// values by SetlistProgramPageMockup.tsx's Cover.
const (
	coverOuterInset   = 36.0 // clears a printer's ¼" no-print margin
	coverInnerInset   = 44.0
	coverSidePadding  = 32.0
	coverColumnWidth  = 233.0
	coverGap          = 10.0
	coverOpticalLift  = 0.04 // of the page height; see drawCover
	coverFleuronSize  = 21.0
	coverFleuronSpace = 8.0 // between each fleuron and the text it frames
	coverDateSize     = 11 * cabinOptical
	coverDateTracking = 0.10 // em
	coverTitleSize    = 24.0
	coverRuleWidth    = 24.0
	coverRuleMargin   = 2.0
	coverDescSize     = 12 * cabinOptical
	coverDescLeading  = 1.4
	coverDescTracking = 0.02 // em, the app's own Cabin tracking
)

// Cabin reads smaller than Libre Baskerville at the same size (x-height
// .490 vs .530), so its sizes are scaled up by this factor to match.
const cabinOptical = 1.08

// Each font's line-box extents above and below the baseline, as a
// fraction of its size (hhea ascender/descender, no line gap) — what a
// browser's `line-height: normal` spans, used to place baselines where the
// mockup's flex layout puts them.
const (
	cabinAscent            = 0.965
	cabinDescent           = 0.25
	baskervilleBoldAscent  = 0.97
	baskervilleBoldDescent = 0.27
)

// fpdf's CellFormat draws a zero-height cell's baseline this far below the
// cell's y, as a fraction of the font size.
const fpdfCellBaseline = 0.3

// baselineIn is where text of the given size and ascent/descent sits in a
// line box of lineHeight starting at top — half-leading above and below,
// as CSS does.
func baselineIn(top, lineHeight, size, ascent, descent float64) float64 {
	return top + (lineHeight-(ascent+descent)*size)/2 + ascent*size
}

// drawCover draws the cover as one vertically centered stack inside the
// inner frame: fleuron, date, title, a short rule, description, and the
// same fleuron rotated 180°. An absent date or description drops out of
// the stack along with its gap.
func drawCover(pdf *fpdf.Fpdf, size fpdf.SizeType, s Setlist) {
	pdf.AddPageFormat("P", size)
	w, h := size.Wd, size.Ht

	// A 1pt stroke is centered on its path, so each frame's path sits half
	// a point inside its inset to span exactly [inset, inset+1].
	setDraw(pdf, colorFainter)
	pdf.SetLineWidth(1)
	for _, inset := range []float64{coverOuterInset + 0.5, coverInnerInset + 0.5} {
		pdf.Rect(inset, inset, w-2*inset, h-2*inset, "D")
	}

	type block struct {
		height float64
		draw   func(top float64)
	}
	var blocks []block

	blocks = append(blocks, block{coverFleuronSize + coverFleuronSpace, func(top float64) {
		drawFleuron(pdf, (w-fleuronWidth(coverFleuronSize))/2, top, coverFleuronSize, false, colorFainter)
	}})

	if s.GigDate != "" {
		lineHeight := (cabinAscent + cabinDescent) * coverDateSize
		blocks = append(blocks, block{lineHeight, func(top float64) {
			pdf.SetFont(fontSans, "", coverDateSize)
			setColor(pdf, colorInkSoft)
			date := toUpper(s.GigDate)
			tracking := coverDateTracking * coverDateSize
			dateW := kernedWidth(pdf, fontSans, "", coverDateSize, date, tracking)
			drawKerned(pdf, fontSans, "", coverDateSize, (w-dateW)/2,
				baselineIn(top, lineHeight, coverDateSize, cabinAscent, cabinDescent), date, tracking)
		}})
	}

	pdf.SetFont(fontDisplay, "B", coverTitleSize)
	titleLines := kernedLines(pdf, fontDisplay, "B", coverTitleSize, s.Name, 0, coverColumnWidth)
	titleLineHeight := (baskervilleBoldAscent + baskervilleBoldDescent) * coverTitleSize
	blocks = append(blocks, block{float64(len(titleLines)) * titleLineHeight, func(top float64) {
		pdf.SetFont(fontDisplay, "B", coverTitleSize)
		setColor(pdf, colorInk)
		for i, line := range titleLines {
			baseline := baselineIn(top+float64(i)*titleLineHeight, titleLineHeight, coverTitleSize, baskervilleBoldAscent, baskervilleBoldDescent)
			lineW := kernedWidth(pdf, fontDisplay, "B", coverTitleSize, line, 0)
			drawKerned(pdf, fontDisplay, "B", coverTitleSize, (w-lineW)/2, baseline, line, 0)
		}
	}})

	if s.Description != "" {
		// The rule separates the title from the description, so it goes
		// with it.
		blocks = append(blocks, block{1 + 2*coverRuleMargin, func(top float64) {
			setFill(pdf, colorFainter)
			pdf.Rect((w-coverRuleWidth)/2, top+coverRuleMargin, coverRuleWidth, 1, "F")
		}})

		// Real Markdown + :shortcode: rendering, matching how this field
		// actually renders in-app (MarkdownText.tsx) — ambientItalic=true
		// mirrors index.css's `.italic em { font-style: normal }` rule
		// (see richtext.go's own doc comment): the block's own base style
		// is italic, so a *marked* span inverts to roman instead of
		// double-italicizing.
		paragraphs := parseRichText(s.Description, true)
		lineHeight := coverDescLeading * coverDescSize
		paragraphSpacing := lineHeight / 2
		height := richTextHeight(pdf, coverColumnWidth, lineHeight, paragraphSpacing, fontSans, coverDescSize, coverDescTracking*coverDescSize, paragraphs)
		blocks = append(blocks, block{height, func(top float64) {
			firstBaseline := baselineIn(top, lineHeight, coverDescSize, cabinAscent, cabinDescent)
			drawRichText(pdf, (w-coverColumnWidth)/2, firstBaseline-fpdfCellBaseline*coverDescSize,
				coverColumnWidth, lineHeight, paragraphSpacing, "C", fontSans, coverDescSize, coverDescTracking*coverDescSize, colorInkSoft, paragraphs)
		}})
	}

	blocks = append(blocks, block{coverFleuronSpace + coverFleuronSize, func(top float64) {
		drawFleuron(pdf, (w-fleuronWidth(coverFleuronSize))/2, top+coverFleuronSpace, coverFleuronSize, true, colorFainter)
	}})

	total := coverGap * float64(len(blocks)-1)
	for _, b := range blocks {
		total += b.height
	}
	// Optically centered within the inner frame's content box (inside its
	// 1pt border): centered, then lifted by coverOpticalLift of the page
	// height, since a block centered exactly reads as sitting low. The
	// stack starts and ends with the fleurons, whose ink fills their box,
	// so its measured height is its visible height.
	contentTop := coverInnerInset + 1
	contentHeight := h - 2*contentTop
	top := contentTop + (contentHeight-total)/2 - coverOpticalLift*h
	for _, b := range blocks {
		b.draw(top)
		top += b.height + coverGap
	}
}

// The Generated Program Page's layout, in points — the locked design (an
// unframed interleaf), drawn at these same values by
// SetlistProgramPageMockup.tsx's Generated Program Page.
const (
	programMargin        = 72.0
	programColumnWidth   = 288.0
	programGap           = 10.0
	programDiamondSize   = 6.0 // the square's side, before its 45° turn
	programDiamondAbove  = 3.0
	programDiamondBelow  = 11.0
	programLabelSize     = 11 * cabinOptical
	programLabelTracking = 0.10 // em
	programNameSize      = 24.0
	programNameLeading   = 1.24
	programDurationSpace = 8.0 // extra, above the duration
)

// drawProgramPage draws a custom entry's stand-in page as one optically
// centered stack (see drawCover): a small diamond, the role, the name, a
// short rule and the notes, then the duration. Each part drops out, with
// its gap, when the entry doesn't have it; the rule goes with the notes.
// A stack taller than the space between the margins starts at the top
// margin rather than above it.
func drawProgramPage(pdf *fpdf.Fpdf, size fpdf.SizeType, e Entry) {
	pdf.AddPageFormat("P", size)
	w, h := size.Wd, size.Ht

	type block struct {
		height float64
		draw   func(top float64)
	}
	var blocks []block

	blocks = append(blocks, block{programDiamondAbove + programDiamondSize + programDiamondBelow, func(top float64) {
		cy := top + programDiamondAbove + programDiamondSize/2
		setFill(pdf, colorFainter)
		pdf.TransformBegin()
		pdf.TransformRotate(45, w/2, cy)
		pdf.Rect(w/2-programDiamondSize/2, cy-programDiamondSize/2, programDiamondSize, programDiamondSize, "F")
		pdf.TransformEnd()
	}})

	label := func(text string) block {
		lineHeight := (cabinAscent + cabinDescent) * programLabelSize
		return block{lineHeight, func(top float64) {
			text := toUpper(text)
			tracking := programLabelTracking * programLabelSize
			setColor(pdf, colorInkSoft)
			textW := kernedWidth(pdf, fontSans, "", programLabelSize, text, tracking)
			drawKerned(pdf, fontSans, "", programLabelSize, (w-textW)/2,
				baselineIn(top, lineHeight, programLabelSize, cabinAscent, cabinDescent), text, tracking)
		}}
	}

	if e.CustomRole != nil && *e.CustomRole != "" {
		blocks = append(blocks, label(*e.CustomRole))
	}

	nameLines := kernedLines(pdf, fontDisplay, "I", programNameSize, e.CustomName, 0, programColumnWidth)
	nameLineHeight := programNameLeading * programNameSize
	blocks = append(blocks, block{float64(len(nameLines)) * nameLineHeight, func(top float64) {
		setColor(pdf, colorInk)
		for i, line := range nameLines {
			baseline := baselineIn(top+float64(i)*nameLineHeight, nameLineHeight, programNameSize, baskervilleAscent, baskervilleDescent)
			lineW := kernedWidth(pdf, fontDisplay, "I", programNameSize, line, 0)
			drawKerned(pdf, fontDisplay, "I", programNameSize, (w-lineW)/2, baseline, line, 0)
		}
	}})

	if e.CustomNotes != nil && *e.CustomNotes != "" {
		blocks = append(blocks, block{1 + 2*coverRuleMargin, func(top float64) {
			setFill(pdf, colorFainter)
			pdf.Rect((w-coverRuleWidth)/2, top+coverRuleMargin, coverRuleWidth, 1, "F")
		}})

		// Real Markdown + :shortcode: rendering, as on the cover — but this
		// block's base style isn't italic, so ambientItalic=false: a
		// *marked* span renders italic as normal.
		paragraphs := parseRichText(*e.CustomNotes, false)
		lineHeight := coverDescLeading * coverDescSize
		paragraphSpacing := lineHeight / 2
		tracking := coverDescTracking * coverDescSize
		height := richTextHeight(pdf, programColumnWidth, lineHeight, paragraphSpacing, fontSans, coverDescSize, tracking, paragraphs)
		blocks = append(blocks, block{height, func(top float64) {
			firstBaseline := baselineIn(top, lineHeight, coverDescSize, cabinAscent, cabinDescent)
			drawRichText(pdf, (w-programColumnWidth)/2, firstBaseline-fpdfCellBaseline*coverDescSize,
				programColumnWidth, lineHeight, paragraphSpacing, "C", fontSans, coverDescSize, tracking, colorInkSoft, paragraphs)
		}})
	}

	if e.CustomDurationSeconds != nil {
		b := label(formatDuration(*e.CustomDurationSeconds))
		draw := b.draw
		blocks = append(blocks, block{programDurationSpace + b.height, func(top float64) {
			draw(top + programDurationSpace)
		}})
	}

	total := programGap * float64(len(blocks)-1)
	for _, b := range blocks {
		total += b.height
	}
	top := programMargin + (h-2*programMargin-total)/2 - coverOpticalLift*h
	top = max(top, programMargin)
	for _, b := range blocks {
		b.draw(top)
		top += b.height + programGap
	}
}

// The colophon's layout, in points — the locked design, drawn at these
// same values by SetlistProgramPageMockup.tsx's Colophon.
const (
	colophonMargin     = 72.0
	colophonTextSize   = 10.0
	colophonLeading    = 1.5
	colophonGap        = 14.0
	colophonMarkHeight = 24.0
)

// drawColophon sets the colophon at the foot of the last page, where a
// book's colophon traditionally goes, sitting on the bottom margin: two
// lines of Libre Baskerville italic, the 24pt rule, and the S mark.
func drawColophon(pdf *fpdf.Fpdf, size fpdf.SizeType, generated string) {
	pdf.AddPageFormat("P", size)
	w, h := size.Wd, size.Ht

	lineHeight := colophonLeading * colophonTextSize
	var lines []string
	for _, sentence := range []string{"Set in Libre Baskerville and Cabin.", "Generated " + generated + "."} {
		lines = append(lines, kernedLines(pdf, fontDisplay, "I", colophonTextSize, sentence, 0, w-2*colophonMargin)...)
	}
	textHeight := float64(len(lines)) * lineHeight
	markH := colophonMarkHeight
	markW := markH * (1024.0 / 1396.0) // the PNG's own aspect

	top := h - colophonMargin - (textHeight + colophonGap + 1 + colophonGap + markH)

	setColor(pdf, colorInkSoft)
	for i, line := range lines {
		baseline := baselineIn(top+float64(i)*lineHeight, lineHeight, colophonTextSize, baskervilleAscent, baskervilleDescent)
		lineW := kernedWidth(pdf, fontDisplay, "I", colophonTextSize, line, 0)
		drawKerned(pdf, fontDisplay, "I", colophonTextSize, (w-lineW)/2, baseline, line, 0)
	}
	top += textHeight + colophonGap

	setFill(pdf, colorFainter)
	pdf.Rect((w-coverRuleWidth)/2, top, coverRuleWidth, 1, "F")
	top += 1 + colophonGap

	opt := fpdf.ImageOptions{ImageType: "PNG", ReadDpi: true}
	pdf.RegisterImageOptionsReader("sonneck-s-mark", opt, bytesReader(sonneckSMarkPNG))
	pdf.ImageOptions("sonneck-s-mark", (w-markW)/2, top, markW, markH, false, opt, 0, "")
}
