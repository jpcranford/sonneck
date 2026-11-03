package annotpdf

import (
	"math"
	"strings"
	"testing"

	"golang.org/x/image/font/sfnt"

	"github.com/jpcranford/sonneck/internal/richtext"
)

// Bold text is set in Lexend Bold, as the browser does with a real bold
// cut, and the space inside a bold phrase is Bold's wider one; a space
// beside a bold word but outside it stays Medium's.
func TestBoldUsesLexendBold(t *testing.T) {
	var buf sfnt.Buffer
	medSpace := handFont.widths[handFont.glyph(&buf, ' ')] / 1000
	boldSpace := handBold.widths[handBold.glyph(&buf, ' ')] / 1000
	if medSpace == boldSpace {
		t.Fatalf("Medium and Bold spaces are both %v; the test can't tell them apart", medSpace)
	}
	slowBold := wordWidth(&buf, richtext.Word{Text: "slow", Bold: true})
	slowMed := wordWidth(&buf, richtext.Word{Text: "slow"})
	if slowBold <= slowMed {
		t.Errorf("bold \"slow\" is %v em, Medium %v; want bold wider", slowBold, slowMed)
	}

	second := func(text string) float64 {
		l := layoutText(text, false, 100)
		if len(l.lines) != 1 || len(l.lines[0]) != 2 {
			t.Fatalf("%q laid out as %+v, want two words on one line", text, l.lines)
		}
		return l.lines[0][1].x
	}
	near := func(a, b float64) bool { return math.Abs(a-b) < 1e-9 }
	if got, want := second("**slow practice**"), slowBold+boldSpace; !near(got, want) {
		t.Errorf("**slow practice**: second word at %v em, want %v (bold space)", got, want)
	}
	if got, want := second("**slow** practice"), slowBold+medSpace; !near(got, want) {
		t.Errorf("**slow** practice: second word at %v em, want %v (Medium space)", got, want)
	}

	var b strings.Builder
	drawText(&b, layoutText("**slow** practice", false, 100), 12, 0, 0, [3]float64{0, 0, 0})
	if s := b.String(); !strings.Contains(s, "/HandBold ") || !strings.Contains(s, "/Hand ") || strings.Contains(s, "2 Tr") {
		t.Errorf("appearance should draw bold in HandBold and the rest in Hand, with no drawn-on bold:\n%s", s)
	}
}
