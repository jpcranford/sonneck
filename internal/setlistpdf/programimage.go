package setlistpdf

import (
	"bytes"
	"strconv"
	"strings"

	"codeberg.org/go-pdf/fpdf"
)

// The program as an image (Setlist Details' "Copy program as image",
// design F of https://claude.ai/artifact/8Z7qPoVzws8L5SZih6WkAW): the
// contents page without page numbers, inside the cover's thin double
// frame, on white in the print colors. Drawn as a one-page PDF exactly as
// tall as the program, 540pt wide, which the handler renders at 144ppi into
// a PNG 1080 pixels wide. The values are the design's (the frontend
// mockup's ProgramImagePreview carries the same numbers at 540px).
const (
	piWidth        = 540.0
	piOuter        = 18.0 // white margin around the outer frame
	piFrameGap     = 6.0  // between the two frames
	piPadX         = 28.0 // inner frame to the text, each side
	piPadTop       = 30.0
	piPadBottom    = 26.0
	piFleuron      = 22.0
	piFleuronGap   = 14.0
	piNameSize     = 24.0
	piNameLeading  = 1.2
	piNameDateGap  = 6.0
	piDateSize     = 10.0
	piDateLeading  = 1.4
	piCapsTracking = 0.1 // em, the date and the roles
	piRowsTopGap   = 26.0
	piRowSize      = 13.0
	piRowLeading   = 1.375
	piRoleSize     = 10.0
	piRowGap       = 11.0
	piNumberWidth  = 22.0
	piNumberGap    = 4.0
	piCreditSize   = 11.5
	piLeaderMin    = 20.0
	piLeaderPad    = 6.0  // title to the leader, and the leader to the credit
	piLeaderRise   = 3.75 // the dots sit this far above the baseline
	piLeaderPitch  = 3.0
	piLeaderDot    = 0.75 // radius
)

// ProgramImageRow is one program line: a numbered entry (a piece, or a
// custom entry counted as music) or, with no Number, another custom entry,
// set in italics.
type ProgramImageRow struct {
	Number *int
	Role   string // a piece's role, set above its title in small capitals
	Title  string
	Opus   string // shown after the title in parentheses
	Credit string // "Composer, arr. Arranger", on a leader at the right
}

// ProgramImageInput is what the program image shows.
type ProgramImageInput struct {
	Name string
	Date string // the gig date with its day of the week, or ""
	Rows []ProgramImageRow
}

// ProgramImage draws the program image as a one-page PDF, 540pt wide and as
// tall as the program.
func ProgramImage(in ProgramImageInput) ([]byte, error) {
	measure := newDocument(fpdf.SizeType{Wd: piWidth, Ht: piWidth})
	measure.AddPage()
	height := layoutProgramImage(measure, in, false)

	pdf := newDocument(fpdf.SizeType{Wd: piWidth, Ht: height})
	pdf.AddPage()
	layoutProgramImage(pdf, in, true)
	if pdf.Err() {
		return nil, pdf.Error()
	}
	var out bytes.Buffer
	if err := pdf.Output(&out); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// layoutProgramImage walks the image top to bottom, drawing it when draw is
// set, and returns the page height it needs.
func layoutProgramImage(pdf *fpdf.Fpdf, in ProgramImageInput, draw bool) float64 {
	innerFrame := piOuter + 1 + piFrameGap // the inner frame's 1pt line starts here
	left := innerFrame + 1 + piPadX
	right := piWidth - left
	width := right - left
	y := innerFrame + 1 + piPadTop

	// The fleuron, centered.
	if draw {
		drawFleuron(pdf, (piWidth-fleuronWidth(piFleuron))/2, y, piFleuron, false, colorFainter)
	}
	y += piFleuron + piFleuronGap

	// The name, centered, wrapping if it must.
	nameLH := piNameSize * piNameLeading
	pdf.SetFont(fontDisplay, "B", piNameSize)
	for _, line := range kernedLines(pdf, fontDisplay, "B", piNameSize, in.Name, 0, width) {
		if draw {
			pdf.SetFont(fontDisplay, "B", piNameSize)
			setColor(pdf, colorInk)
			w := kernedWidth(pdf, fontDisplay, "B", piNameSize, line, 0)
			baseline := baselineIn(y, nameLH, piNameSize, baskervilleBoldAscent, baskervilleBoldDescent)
			drawKerned(pdf, fontDisplay, "B", piNameSize, (piWidth-w)/2, baseline, line, 0)
		}
		y += nameLH
	}

	// The date, in small capitals.
	if in.Date != "" {
		y += piNameDateGap
		dateLH := piDateSize * piDateLeading
		if draw {
			date := strings.ToUpper(in.Date)
			tracking := piCapsTracking * piDateSize
			pdf.SetFont(fontSans, "", piDateSize)
			setColor(pdf, colorInkSoft)
			w := kernedWidth(pdf, fontSans, "", piDateSize, date, tracking)
			baseline := baselineIn(y, dateLH, piDateSize, cabinAscent, cabinDescent)
			drawKerned(pdf, fontSans, "", piDateSize, (piWidth-w)/2, baseline, date, tracking)
		}
		y += dateLH
	}

	y += piRowsTopGap
	rowLH := piRowSize * piRowLeading
	textLeft := left + piNumberWidth + piNumberGap
	textWidth := right - textLeft
	for i, row := range in.Rows {
		if i > 0 {
			y += piRowGap
		}
		if row.Number == nil {
			pdf.SetFont(fontDisplay, "I", piRowSize)
			for _, line := range kernedLines(pdf, fontDisplay, "I", piRowSize, row.Title, 0, textWidth) {
				if draw {
					pdf.SetFont(fontDisplay, "I", piRowSize)
					setColor(pdf, colorInkSoft)
					drawKerned(pdf, fontDisplay, "I", piRowSize, textLeft,
						baselineIn(y, rowLH, piRowSize, baskervilleAscent, baskervilleDescent), line, 0)
				}
				y += rowLH
			}
			continue
		}

		// The role, in small capitals above the title.
		if row.Role != "" {
			roleLH := piRoleSize * piRowLeading
			if draw {
				tracking := piCapsTracking * piRoleSize
				pdf.SetFont(fontSans, "", piRoleSize)
				setColor(pdf, colorInkSoft)
				drawKerned(pdf, fontSans, "", piRoleSize, textLeft,
					baselineIn(y, roleLH, piRoleSize, cabinAscent, cabinDescent),
					strings.ToUpper(row.Role), tracking)
			}
			y += roleLH
		}

		// The title (and opus), leaving room on its last line for the
		// leader and the credit.
		creditW := 0.0
		if row.Credit != "" {
			pdf.SetFont(fontSans, "", piCreditSize)
			creditW = kernedWidth(pdf, fontSans, "", piCreditSize, row.Credit, 0)
		}
		room := textWidth
		if row.Credit != "" {
			room -= creditW + piLeaderMin + 2*piLeaderPad
		}
		opus := ""
		if row.Opus != "" {
			opus = " (" + row.Opus + ")"
		}
		pdf.SetFont(fontDisplayMedium, "", piRowSize)
		lines := kernedLines(pdf, fontDisplayMedium, "", piRowSize, row.Title, 0, room)
		if len(lines) == 0 {
			lines = []string{""}
		}
		pdf.SetFont(fontDisplay, "", piRowSize)
		opusW := kernedWidth(pdf, fontDisplay, "", piRowSize, opus, 0)
		pdf.SetFont(fontDisplayMedium, "", piRowSize)
		lastW := kernedWidth(pdf, fontDisplayMedium, "", piRowSize, lines[len(lines)-1], 0)
		opusOwnLine := opus != "" && lastW+opusW > room
		count := len(lines)
		if opusOwnLine {
			count++
		}
		for li := 0; li < count; li++ {
			baseline := baselineIn(y, rowLH, piRowSize, baskervilleAscent, baskervilleDescent)
			if draw {
				setColor(pdf, colorInk)
				if li == 0 {
					pdf.SetFont(fontDisplayMedium, "", piRowSize)
					drawKerned(pdf, fontDisplayMedium, "", piRowSize, left, baseline, strconv.Itoa(*row.Number)+".", 0)
				}
				end := textLeft
				if li < len(lines) {
					pdf.SetFont(fontDisplayMedium, "", piRowSize)
					end = drawKerned(pdf, fontDisplayMedium, "", piRowSize, textLeft, baseline, lines[li], 0)
				}
				last := li == count-1
				if opus != "" && last {
					pdf.SetFont(fontDisplay, "", piRowSize)
					text := opus
					if opusOwnLine {
						text = strings.TrimPrefix(opus, " ")
					}
					end = drawKerned(pdf, fontDisplay, "", piRowSize, end, baseline, text, 0)
				}
				if row.Credit != "" && last {
					creditX := right - creditW
					drawPiLeader(pdf, end+piLeaderPad, creditX-piLeaderPad, baseline-piLeaderRise)
					pdf.SetFont(fontSans, "", piCreditSize)
					setColor(pdf, colorInkSoft)
					drawKerned(pdf, fontSans, "", piCreditSize, creditX, baseline, row.Credit, 0)
				}
			}
			y += rowLH
		}
	}

	y += piPadBottom
	innerBottom := y + 1
	outerBottom := innerBottom + piFrameGap + 1
	height := outerBottom + piOuter
	if draw {
		// A 1pt stroke is centered on its path, so each frame's path sits
		// half a point inside its edge, as on the cover.
		setDraw(pdf, colorFainter)
		pdf.SetLineWidth(1)
		pdf.Rect(piOuter+0.5, piOuter+0.5, piWidth-2*piOuter-1, outerBottom-piOuter-1, "D")
		pdf.Rect(innerFrame+0.5, innerFrame+0.5, piWidth-2*innerFrame-1, innerBottom-innerFrame-1, "D")
	}
	return height
}

// drawPiLeader fills [from, to] with small dots at y, counted back from the
// right end at a fixed pitch so they line up down the image.
func drawPiLeader(pdf *fpdf.Fpdf, from, to, y float64) {
	setFill(pdf, colorFainter)
	for x := to - piLeaderDot; x-piLeaderDot >= from; x -= piLeaderPitch {
		pdf.Circle(x, y, piLeaderDot, "F")
	}
}
