package setlistpdf

import (
	"fmt"
	"time"

	"codeberg.org/go-pdf/fpdf"
)

// centeredLine draws one line of already-set-font text, horizontally
// centered on the page.
func centeredLine(pdf *fpdf.Fpdf, pageWidth, y float64, text string) {
	w := pdf.GetStringWidth(text)
	pdf.SetXY((pageWidth-w)/2, y)
	pdf.CellFormat(w, 0, text, "", 0, "C", false, 0, "")
}

// centeredParagraph wraps text within a centered column of the given
// width, returning the y position just past the last line drawn.
func centeredParagraph(pdf *fpdf.Fpdf, pageWidth, y, colWidth, lineHeight float64, text string) float64 {
	pdf.SetXY((pageWidth-colWidth)/2, y)
	pdf.MultiCell(colWidth, lineHeight, text, "", "C", false)
	return pdf.GetY()
}

func drawCover(pdf *fpdf.Fpdf, size fpdf.SizeType, s Setlist) {
	pdf.AddPageFormat("P", size)
	w := size.Wd

	outerInset := 24.0
	innerInset := 36.0
	setDraw(pdf, colorBorder)
	pdf.SetLineWidth(1)
	pdf.Rect(outerInset, outerInset, w-2*outerInset, size.Ht-2*outerInset, "D")
	pdf.Rect(innerInset, innerInset, w-2*innerInset, size.Ht-2*innerInset, "D")

	y := size.Ht/2 - 110

	diamondDivider(pdf, w/2, y, 0) // a bare centered mark, no flanking rules at the very top
	y += 30

	if s.GigDate != "" {
		pdf.SetFont(fontSans+"SemiBold", "", 13)
		setColor(pdf, colorInkSoft)
		centeredLine(pdf, w, y, upperTracked(s.GigDate))
		y += 26
	}

	pdf.SetFont(fontDisplay, "B", 30)
	setColor(pdf, colorInk)
	y = centeredParagraph(pdf, w, y, w-2*innerInset-40, 34, s.Name)
	y += 18

	diamondDivider(pdf, w/2, y, 34)
	y += 28

	if s.Description != "" {
		// Real Markdown + :shortcode: rendering, matching how this field
		// actually renders in-app (MarkdownText.tsx) — ambientItalic=true
		// mirrors index.css's `.italic em { font-style: normal }` rule
		// (see richtext.go's own doc comment): the block's own base style
		// is italic, so a *marked* span inverts to roman instead of
		// double-italicizing.
		drawRichText(pdf, innerInset+30, y, w-2*innerInset-60, 19, 6, "C", fontSans, 15, colorInkSoft, parseRichText(s.Description, true))
	}
}

// upperTracked is a plain uppercase-with-spaces approximation of the
// app's own letter-spaced/tracked small-caps labels — fpdf has no
// built-in letter-spacing primitive, so visual "tracking" is approximated
// by uppercasing (the weight/size drop already does most of the work the
// browser's own tracking-wide utility does).
func upperTracked(s string) string {
	return toUpper(s)
}

func drawTOC(pdf *fpdf.Fpdf, size fpdf.SizeType, layout Layout, s Setlist, entries []Entry) {
	const (
		marginX   = 36.0
		marginTop = 44.0
		rowHeight = 22.0
		numColW   = 26.0
		pageColW  = 34.0
	)
	w := size.Wd
	contentW := w - 2*marginX

	rowsPerPage := rowsPerTOCPage
	pageIdx := 0
	rowOnPage := 0
	var y float64

	newPage := func(first bool) {
		pdf.AddPageFormat("P", size)
		y = marginTop
		if first {
			pdf.SetFont(fontDisplay, "B", 21)
			setColor(pdf, colorInk)
			pdf.SetXY(marginX, y)
			pdf.CellFormat(contentW, 0, s.Name, "", 0, "L", false, 0, "")
			y += 24

			pdf.SetFont(fontSans, "", 14)
			setColor(pdf, colorInkSoft)
			line := s.GigDate
			if total := TotalDurationSeconds(entries); total != nil {
				if line != "" {
					line += "  •  "
				}
				line += "approx. " + formatDuration(*total)
			}
			pdf.SetXY(marginX, y)
			pdf.CellFormat(contentW, 0, line, "", 0, "L", false, 0, "")
			y += 22

			pdf.SetFont(fontSans+"SemiBold", "", 11)
			setColor(pdf, colorInkSoft)
			pdf.SetXY(marginX, y)
			pdf.CellFormat(contentW, 0, upperTracked("Program"), "", 0, "L", false, 0, "")
			y += 20
		} else {
			pdf.SetFont(fontSans, "I", 12)
			setColor(pdf, colorInkSoft)
			pdf.SetXY(marginX, y)
			pdf.CellFormat(contentW, 0, "Program, continued", "", 0, "L", false, 0, "")
			y += 20
		}

		pdf.SetFont(fontSans+"SemiBold", "", 10)
		setColor(pdf, colorInkSoft)
		pdf.SetXY(marginX, y)
		pdf.CellFormat(numColW, 0, "", "", 0, "L", false, 0, "")
		pdf.CellFormat(contentW-numColW-pageColW, 0, upperTracked("Title"), "", 0, "L", false, 0, "")
		pdf.CellFormat(pageColW, 0, upperTracked("Pg."), "", 0, "R", false, 0, "")
		y += 6
		setDraw(pdf, colorBorder)
		pdf.SetLineWidth(1)
		pdf.Line(marginX, y, w-marginX, y)
		y += 14
		rowOnPage = 0
	}

	newPage(true)

	for i, e := range entries {
		if rowOnPage >= rowsPerPage {
			pageIdx++
			newPage(false)
		}
		rowOnPage++

		numStr := "–"
		if e.DisplayNumber != nil {
			numStr = fmt.Sprintf("%d", *e.DisplayNumber)
		}
		pdf.SetFont(fontSans, "", 13)
		setColor(pdf, colorInkSoft)
		pdf.SetXY(marginX, y)
		pdf.CellFormat(numColW, rowHeight, numStr, "", 0, "R", false, 0, "")

		title := e.PieceTitle
		meta := ""
		if e.IsPiece {
			pdf.SetFont(fontDisplay, "", 15)
			setColor(pdf, colorInk)
			if len(e.PieceKeys) > 0 {
				meta = joinKeys(e.PieceKeys)
			}
			if e.PieceDuration != nil {
				if meta != "" {
					meta += " • "
				}
				meta += formatDuration(*e.PieceDuration)
			}
		} else {
			title = e.CustomName
			pdf.SetFont(fontSans, "I", 13)
			setColor(pdf, colorInkSoft)
			if e.CustomRole != nil {
				meta = *e.CustomRole
			}
			if e.CustomDurationSeconds != nil {
				if meta != "" {
					meta += " • "
				}
				meta += formatDuration(*e.CustomDurationSeconds)
			}
		}

		pageStr := fmt.Sprintf("%d", layout.EntryStartPage[i])
		pageStrW := pdf.GetStringWidth(pageStr) + 2

		titleX := marginX + numColW + 6
		leaderEndX := w - marginX - pageStrW
		availW := leaderEndX - titleX - 8 // leave a small gap before the leader/page number

		fullTitle := title
		if meta != "" {
			fullTitle = title + "  (" + meta + ")"
		}
		titleW := pdf.GetStringWidth(fullTitle)

		pdf.SetXY(titleX, y)
		var lineEndY, leaderStartX float64
		if titleW <= availW {
			// The common case: fits on one line. Position the dotted
			// leader right after the title's own real rendered width —
			// not a fixed reserved offset — so it never overlaps a long
			// title or leaves an oddly wide gap after a short one (found
			// live: the original fixed-offset version did both).
			pdf.CellFormat(titleW, rowHeight, fullTitle, "", 0, "L", false, 0, "")
			lineEndY = y + rowHeight
			leaderStartX = titleX + titleW + 4
		} else {
			// A genuinely long title: wrap rather than truncate (a real
			// generated program must never silently drop text) — fpdf
			// has no ellipsis primitive worth the complexity here. The
			// leader/page number still anchor to the row's first line,
			// but with nothing reliable to measure that first line's own
			// wrapped width against, the leader is omitted for this row
			// rather than risking the same overlap this fix addresses.
			pdf.MultiCell(availW, rowHeight, fullTitle, "", "L", false)
			lineEndY = pdf.GetY()
			leaderStartX = leaderEndX
		}

		if leaderStartX < leaderEndX-2 {
			setDraw(pdf, colorBorder)
			pdf.SetLineWidth(0.5)
			pdf.SetDashPattern([]float64{1, 1.5}, 0)
			pdf.Line(leaderStartX, y+rowHeight-6, leaderEndX-2, y+rowHeight-6)
			pdf.SetDashPattern(nil, 0)
		}

		pdf.SetFont(fontSans, "", 13)
		setColor(pdf, colorInk)
		pdf.SetXY(leaderEndX, y)
		pdf.CellFormat(pageStrW, rowHeight, pageStr, "", 0, "R", false, 0, "")

		if lineEndY > y+rowHeight {
			y = lineEndY
		} else {
			y += rowHeight
		}
	}
}

func drawProgramPage(pdf *fpdf.Fpdf, size fpdf.SizeType, e Entry) {
	pdf.AddPageFormat("P", size)
	w := size.Wd

	inset := 32.0
	setDraw(pdf, colorBorder)
	pdf.SetLineWidth(1)
	pdf.Rect(inset, inset, w-2*inset, size.Ht-2*inset, "D")

	colWidth := w - 2*inset - 60
	x0 := (w - colWidth) / 2
	y := size.Ht/2 - 95

	diamondDivider(pdf, w/2, y, 0)
	y += 30

	if e.CustomRole != nil && *e.CustomRole != "" {
		pdf.SetFont(fontSans+"SemiBold", "", 13)
		setColor(pdf, colorInkSoft)
		centeredLine(pdf, w, y, upperTracked(*e.CustomRole))
		y += 26
	}

	pdf.SetFont(fontDisplay, "I", 28)
	setColor(pdf, colorInk)
	y = centeredParagraph(pdf, w, y, colWidth, 32, e.CustomName)
	y += 14

	hasInfo := e.CustomDurationSeconds != nil || (e.CustomNotes != nil && *e.CustomNotes != "")
	if hasInfo {
		diamondDivider(pdf, w/2, y, 34)
		y += 26
	}

	if e.CustomNotes != nil && *e.CustomNotes != "" {
		// Real Markdown + :shortcode: rendering — see drawCover's own
		// identical call for the ambientItalic rationale. This block's
		// base style isn't italic (unlike the cover description), so
		// ambientItalic=false here: a *marked* span renders italic as
		// normal, matching index.css when there's no ancestor `.italic`
		// to invert against.
		y = drawRichText(pdf, x0, y, colWidth, 18, 6, "C", fontSans, 14, colorInkSoft, parseRichText(*e.CustomNotes, false))
		y += 10
	}

	if e.CustomDurationSeconds != nil {
		pdf.SetFont(fontSans, "", 14)
		setColor(pdf, colorInkSoft)
		centeredLine(pdf, w, y, formatDuration(*e.CustomDurationSeconds))
	}
}

func drawColophon(pdf *fpdf.Fpdf, size fpdf.SizeType, now time.Time) {
	pdf.AddPageFormat("P", size)
	w := size.Wd

	y := size.Ht/2 - 50

	pdf.SetFont(fontSans, "", 11)
	setColor(pdf, colorInkSoft)
	centeredLine(pdf, w, y, "Set in Libre Baskerville and Cabin.")
	y += 16
	centeredLine(pdf, w, y, "Generated "+now.Format("January 2, 2006")+".")
	y += 28

	setDraw(pdf, colorBorder)
	pdf.SetLineWidth(0.75)
	ruleW := 30.0
	pdf.Line(w/2-ruleW/2, y, w/2+ruleW/2, y)
	y += 24

	markW := 26.0
	markH := markW * (1396.0 / 1024.0)
	opt := fpdf.ImageOptions{ImageType: "PNG", ReadDpi: true}
	pdf.RegisterImageOptionsReader("sonneck-s-mark", opt, bytesReader(sonneckSMarkPNG))
	pdf.ImageOptions("sonneck-s-mark", w/2-markW/2, y, markW, markH, false, opt, 0, "")
}
