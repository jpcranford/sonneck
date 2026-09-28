package setlistpdf

import (
	"math"
	"testing"

	"codeberg.org/go-pdf/fpdf"
)

func newTestPDF() *fpdf.Fpdf {
	pdf := fpdf.NewCustom(&fpdf.InitType{OrientationStr: "P", UnitStr: unit, Size: pageSize[ShapeLetter]})
	registerFonts(pdf)
	pdf.AddPage()
	return pdf
}

func TestKerningReadsEveryTextFont(t *testing.T) {
	// "To" is kerned tighter in all of them; a font whose GPOS kerning
	// stopped being readable would come back 0 here.
	for key := range kerningFonts {
		k := &kerner{font: kerningFonts[key], scale: 12 / float64(kerningFonts[key].UnitsPerEm())}
		if got := k.pair('T', 'o'); got >= 0 {
			t.Errorf("%s: kerning for \"To\" = %.3fpt, want negative", key, got)
		}
	}
}

func TestKernedWidth(t *testing.T) {
	pdf := newTestPDF()
	pdf.SetFont(fontSans, "", 12)
	plain := pdf.GetStringWidth("To")
	kerned := kernedWidth(pdf, fontSans, "", 12, "To", 0)
	if kerned >= plain {
		t.Errorf("kerned \"To\" = %.2f, want narrower than unkerned %.2f", kerned, plain)
	}
	// Tracking goes between characters only: 4 characters, 3 gaps.
	tracked := kernedWidth(pdf, fontSans, "", 12, "Tote", 0.5)
	untracked := kernedWidth(pdf, fontSans, "", 12, "Tote", 0)
	if diff := tracked - untracked; math.Abs(diff-1.5) > 1e-9 {
		t.Errorf("tracking added %.3fpt, want 1.5", diff)
	}
	// The symbol font has no kerning data: its width is the plain width.
	pdf.SetFont(fontSymbol, "", 12)
	sym := "\U0001D11E\U0001D122"
	if got, want := kernedWidth(pdf, fontSymbol, "", 12, sym, 0), pdf.GetStringWidth(sym); math.Abs(got-want) > 1e-9 {
		t.Errorf("symbol width = %.3f, want unkerned %.3f", got, want)
	}
}

func TestKernedLines(t *testing.T) {
	pdf := newTestPDF()
	pdf.SetFont(fontDisplay, "B", 24)
	lines := kernedLines(pdf, fontDisplay, "B", 24, "An Evening of Sacred Choral Music", 0, 233)
	if len(lines) < 2 {
		t.Fatalf("lines = %q, want it wrapped", lines)
	}
	for _, l := range lines {
		if w := kernedWidth(pdf, fontDisplay, "B", 24, l, 0); w > 233 {
			t.Errorf("line %q is %.1fpt wide, over the 233pt column", l, w)
		}
	}
	// A word longer than the column stays whole.
	if got := kernedLines(pdf, fontDisplay, "B", 24, "Supercalifragilisticexpialidocious", 0, 100); len(got) != 1 {
		t.Errorf("single long word split into %q", got)
	}
}

func TestMusicSymbolsFallBackToBravura(t *testing.T) {
	pdf := newTestPDF()
	for _, family := range []string{fontSans, fontDisplay} {
		adv, fonts := kernedAdvances(pdf, family, "", 12, "B♭", 0)
		if fonts[0][0] != family {
			t.Errorf("%s: \"B\" drawn in %s, want the text's own font", family, fonts[0][0])
		}
		if fonts[1][0] != fontSymbol {
			t.Errorf("%s: \"♭\" drawn in %s, want %s (the text font has no flat)", family, fonts[1][0], fontSymbol)
		}
		// Measured in Bravura's own width, with no cross-font kerning.
		pdf.SetFont(fontSymbol, "", 12)
		if want := pdf.GetStringWidth("♭"); math.Abs(adv[1]-want) > 1e-9 {
			t.Errorf("%s: flat advance %.3f, want Bravura's %.3f", family, adv[1], want)
		}
	}
}
