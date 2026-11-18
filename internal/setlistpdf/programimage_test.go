package setlistpdf

import (
	"bytes"
	"testing"

	"codeberg.org/go-pdf/fpdf"
)

// The program image is 540pt wide and grows with its program: a row more,
// a wrapped title, or a role makes it taller, and an empty program or an
// empty title still draws.
func TestProgramImage_GrowsWithProgram(t *testing.T) {
	n := func(i int) *int { return &i }
	height := func(in ProgramImageInput) float64 {
		t.Helper()
		doc, err := ProgramImage(in)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.HasPrefix(doc, []byte("%PDF")) {
			t.Fatal("not a PDF")
		}
		m := newDocument(fpdf.SizeType{Wd: piWidth, Ht: piWidth})
		m.AddPage()
		return layoutProgramImage(m, in, false)
	}
	base := ProgramImageInput{Name: "Recital", Date: "Sunday, December 6, 2026"}
	empty := height(base)
	one := height(ProgramImageInput{Name: base.Name, Date: base.Date, Rows: []ProgramImageRow{
		{Number: n(1), Title: "Ave Maria", Credit: "Franz Schubert"},
	}})
	withRole := height(ProgramImageInput{Name: base.Name, Date: base.Date, Rows: []ProgramImageRow{
		{Number: n(1), Role: "Offertory", Title: "Ave Maria", Credit: "Franz Schubert"},
	}})
	wrapped := height(ProgramImageInput{Name: base.Name, Date: base.Date, Rows: []ProgramImageRow{
		{Number: n(1), Title: "A Very Long Anthem Title That Has To Wrap Onto A Second Line Here", Credit: "Ralph Vaughan Williams"},
	}})
	if !(empty < one && one < withRole && one < wrapped) {
		t.Errorf("heights: empty %.1f, one row %.1f, with role %.1f, wrapped %.1f", empty, one, withRole, wrapped)
	}
	height(ProgramImageInput{Name: "Untitled", Rows: []ProgramImageRow{{Number: n(1)}, {}}})
}
