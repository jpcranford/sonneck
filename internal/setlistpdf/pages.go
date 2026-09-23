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

	y := size.Ht/2 - 90

	diamondDivider(pdf, w/2, y, 0) // a bare centered mark, no flanking rules at the very top
	y += 22

	if s.GigDate != "" {
		pdf.SetFont(fontSans+"SemiBold", "", 9)
		setColor(pdf, colorInkSoft)
		centeredLine(pdf, w, y, upperTracked(s.GigDate))
		y += 20
	}

	pdf.SetFont(fontDisplay, "B", 24)
	setColor(pdf, colorInk)
	y = centeredParagraph(pdf, w, y, w-2*innerInset-40, 28, s.Name)
	y += 14

	diamondDivider(pdf, w/2, y, 28)
	y += 22

	if s.Description != "" {
		pdf.SetFont(fontSans, "I", 11)
		setColor(pdf, colorInkSoft)
		centeredParagraph(pdf, w, y, w-2*innerInset-60, 15, s.Description)
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
		marginX   = 34.0
		marginTop = 40.0
		rowHeight = 15.0
		numColW   = 20.0
		pageColW  = 26.0
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
			pdf.SetFont(fontDisplay, "B", 15)
			setColor(pdf, colorInk)
			pdf.SetXY(marginX, y)
			pdf.CellFormat(contentW, 0, s.Name, "", 0, "L", false, 0, "")
			y += 18

			pdf.SetFont(fontSans, "", 10)
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
			y += 16

			pdf.SetFont(fontSans+"SemiBold", "", 8)
			setColor(pdf, colorInkSoft)
			pdf.SetXY(marginX, y)
			pdf.CellFormat(contentW, 0, upperTracked("Program"), "", 0, "L", false, 0, "")
			y += 14
		} else {
			pdf.SetFont(fontSans, "I", 9)
			setColor(pdf, colorInkSoft)
			pdf.SetXY(marginX, y)
			pdf.CellFormat(contentW, 0, "Program, continued", "", 0, "L", false, 0, "")
			y += 14
		}

		pdf.SetFont(fontSans+"SemiBold", "", 7)
		setColor(pdf, colorInkSoft)
		pdf.SetXY(marginX, y)
		pdf.CellFormat(numColW, 0, "", "", 0, "L", false, 0, "")
		pdf.CellFormat(contentW-numColW-pageColW, 0, upperTracked("Title"), "", 0, "L", false, 0, "")
		pdf.CellFormat(pageColW, 0, upperTracked("Pg."), "", 0, "R", false, 0, "")
		y += 4
		setDraw(pdf, colorBorder)
		pdf.SetLineWidth(0.75)
		pdf.Line(marginX, y, w-marginX, y)
		y += 8
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
		pdf.SetFont(fontSans, "", 9)
		setColor(pdf, colorInkSoft)
		pdf.SetXY(marginX, y)
		pdf.CellFormat(numColW, rowHeight, numStr, "", 0, "R", false, 0, "")

		title := e.PieceTitle
		meta := ""
		if e.IsPiece {
			pdf.SetFont(fontDisplay, "", 10.5)
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
			pdf.SetFont(fontSans, "I", 9)
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

		titleX := marginX + numColW + 4
		leaderEndX := w - marginX - pageStrW
		titleMaxW := leaderEndX - titleX - 60 // leave room for the dotted leader

		fullTitle := title
		if meta != "" {
			fullTitle = title + "  (" + meta + ")"
		}
		pdf.SetXY(titleX, y)
		// fpdf has no ellipsis/truncate primitive worth the complexity here
		// — a real generated program must never silently drop a real
		// piece/entry title, so this deliberately wraps onto a second line
		// rather than truncating the way the browser mockup's CSS does.
		pdf.MultiCell(titleMaxW+60, rowHeight, fullTitle, "", "L", false)
		lineEndY := pdf.GetY()

		setDraw(pdf, colorBorder)
		pdf.SetLineWidth(0.5)
		pdf.SetDashPattern([]float64{1, 1.5}, 0)
		pdf.Line(titleX+titleMaxW, y+rowHeight-4, leaderEndX-2, y+rowHeight-4)
		pdf.SetDashPattern(nil, 0)

		pdf.SetFont(fontSans, "", 9)
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
	y := size.Ht/2 - 70

	diamondDivider(pdf, w/2, y, 0)
	y += 22

	if e.CustomRole != nil && *e.CustomRole != "" {
		pdf.SetFont(fontSans+"SemiBold", "", 9)
		setColor(pdf, colorInkSoft)
		centeredLine(pdf, w, y, upperTracked(*e.CustomRole))
		y += 20
	}

	pdf.SetFont(fontDisplay, "I", 20)
	setColor(pdf, colorInk)
	y = centeredParagraph(pdf, w, y, colWidth, 24, e.CustomName)
	y += 10

	hasInfo := e.CustomDurationSeconds != nil || (e.CustomNotes != nil && *e.CustomNotes != "")
	if hasInfo {
		diamondDivider(pdf, w/2, y, 24)
		y += 20
	}

	if e.CustomNotes != nil && *e.CustomNotes != "" {
		pdf.SetFont(fontSans, "", 10)
		setColor(pdf, colorInkSoft)
		y = centeredParagraph(pdf, w, y, colWidth, 14, *e.CustomNotes)
		y += 8
	}

	if e.CustomDurationSeconds != nil {
		pdf.SetFont(fontSans, "", 10)
		setColor(pdf, colorInkSoft)
		centeredLine(pdf, w, y, formatDuration(*e.CustomDurationSeconds))
	}
}

func drawColophon(pdf *fpdf.Fpdf, size fpdf.SizeType, now time.Time) {
	pdf.AddPageFormat("P", size)
	w := size.Wd

	y := size.Ht/2 - 40

	pdf.SetFont(fontSans, "", 8)
	setColor(pdf, colorInkSoft)
	centeredLine(pdf, w, y, "Set in Libre Baskerville and Cabin.")
	y += 12
	centeredLine(pdf, w, y, "Generated "+now.Format("January 2, 2006")+".")
	y += 22

	setDraw(pdf, colorBorder)
	pdf.SetLineWidth(0.75)
	ruleW := 24.0
	pdf.Line(w/2-ruleW/2, y, w/2+ruleW/2, y)
	y += 20

	markW := 20.0
	markH := markW * (1396.0 / 1024.0)
	opt := fpdf.ImageOptions{ImageType: "PNG", ReadDpi: true}
	pdf.RegisterImageOptionsReader("sonneck-s-mark", opt, bytesReader(sonneckSMarkPNG))
	pdf.ImageOptions("sonneck-s-mark", w/2-markW/2, y, markW, markH, false, opt, 0, "")
}
