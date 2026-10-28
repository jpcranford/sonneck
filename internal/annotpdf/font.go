package annotpdf

import (
	_ "embed"
	"fmt"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
	"golang.org/x/image/font"
	"golang.org/x/image/font/sfnt"
	"golang.org/x/image/math/fixed"

	"github.com/jpcranford/sonneck/internal/setlistpdf"
)

// Quintessential (Brian J. Bonislawsky, Astigmatic, SIL OFL 1.1), the Sheet
// Viewer's text-mark font (--font-hand), as Google Fonts ships it: the web
// app's woff2 files can't be embedded in a PDF.
//
//go:embed assets/Quintessential-Regular.ttf
var quintessentialTTF []byte

// textFont is a TrueType font as text marks embed it: whole (a few dozen KB,
// compressed), as a Type 0 font with 2-byte glyph ids, so any of its glyphs
// can be drawn and copied back out as text.
type textFont struct {
	name     string
	data     []byte
	sf       *sfnt.Font
	upem     float64
	symbolic bool
	// widths of every glyph, in thousandths of an em.
	widths []float64
	// ascent and descent (positive) as shares of an em, as the browser's
	// line layout reads them (hhea).
	ascent, descent float64
	capHeight       float64
	bbox            [4]float64
	toUnicode       map[sfnt.GlyphIndex]rune
}

var (
	handFont   = mustFont("Quintessential-Regular", quintessentialTTF, false)
	symbolFont = mustFont("BravuraText", setlistpdf.BravuraTextFont(), true)
)

func mustFont(name string, data []byte, symbolic bool) *textFont {
	sf, err := sfnt.Parse(data)
	if err != nil {
		panic("annotpdf: parsing " + name + ": " + err.Error())
	}
	var buf sfnt.Buffer
	upem := float64(sf.UnitsPerEm())
	ppem := fixed.Int26_6(sf.UnitsPerEm()) << 6
	units := func(v fixed.Int26_6) float64 { return float64(v) / 64 }
	f := &textFont{name: name, data: data, sf: sf, upem: upem, symbolic: symbolic, toUnicode: map[sfnt.GlyphIndex]rune{}}
	for g := 0; g < sf.NumGlyphs(); g++ {
		adv, err := sf.GlyphAdvance(&buf, sfnt.GlyphIndex(g), ppem, font.HintingNone)
		if err != nil {
			panic("annotpdf: " + name + " glyph advance: " + err.Error())
		}
		f.widths = append(f.widths, units(adv)*1000/upem)
	}
	m, err := sf.Metrics(&buf, ppem, font.HintingNone)
	if err != nil {
		panic("annotpdf: " + name + " metrics: " + err.Error())
	}
	f.ascent, f.descent, f.capHeight = units(m.Ascent)/upem, units(m.Descent)/upem, units(m.CapHeight)/upem
	b, err := sf.Bounds(&buf, ppem, font.HintingNone)
	if err != nil {
		panic("annotpdf: " + name + " bounds: " + err.Error())
	}
	// sfnt's y axis points down.
	f.bbox = [4]float64{units(b.Min.X) * 1000 / upem, -units(b.Max.Y) * 1000 / upem, units(b.Max.X) * 1000 / upem, -units(b.Min.Y) * 1000 / upem}
	// Which character each glyph is, for copying text back out: the first
	// character found for it, over the ranges the two fonts cover.
	for _, span := range [][2]rune{{0x20, 0x2FFF}, {0xE000, 0xF8FF}} {
		for r := span[0]; r <= span[1]; r++ {
			if g, err := sf.GlyphIndex(&buf, r); err == nil && g != 0 {
				if _, ok := f.toUnicode[g]; !ok {
					f.toUnicode[g] = r
				}
			}
		}
	}
	return f
}

// glyph returns r's glyph, 0 (.notdef) when the font hasn't one.
func (f *textFont) glyph(buf *sfnt.Buffer, r rune) sfnt.GlyphIndex {
	g, err := f.sf.GlyphIndex(buf, r)
	if err != nil {
		return 0
	}
	return g
}

// kern returns the kerning between two glyphs in thousandths of an em
// (negative pulls them together).
func (f *textFont) kern(buf *sfnt.Buffer, a, b sfnt.GlyphIndex) float64 {
	if a == 0 || b == 0 {
		return 0
	}
	v, err := f.sf.Kern(buf, a, b, fixed.Int26_6(f.sf.UnitsPerEm())<<6, font.HintingNone)
	if err != nil {
		return 0
	}
	return float64(v) / 64 * 1000 / f.upem
}

// embed adds the font to a document and returns its Type 0 font dict.
func (f *textFont) embed(x *model.XRefTable) (*types.IndirectRef, error) {
	file, err := x.NewStreamDictForBuf(f.data)
	if err != nil {
		return nil, err
	}
	file.InsertInt("Length1", len(f.data))
	if err := file.Encode(); err != nil {
		return nil, err
	}
	fileRef, err := x.IndRefForNewObject(*file)
	if err != nil {
		return nil, err
	}
	flags := 32 // nonsymbolic
	if f.symbolic {
		flags = 4
	}
	descriptor, err := x.IndRefForNewObject(types.Dict{
		"Type":        types.Name("FontDescriptor"),
		"FontName":    types.Name(f.name),
		"Flags":       types.Integer(flags),
		"FontBBox":    types.NewNumberArray(f.bbox[0], f.bbox[1], f.bbox[2], f.bbox[3]),
		"ItalicAngle": types.Integer(0),
		"Ascent":      types.Float(f.ascent * 1000),
		"Descent":     types.Float(-f.descent * 1000),
		"CapHeight":   types.Float(f.capHeight * 1000),
		"StemV":       types.Integer(80),
		"FontFile2":   *fileRef,
	})
	if err != nil {
		return nil, err
	}
	widths := make([]float64, len(f.widths))
	copy(widths, f.widths)
	cid, err := x.IndRefForNewObject(types.Dict{
		"Type":     types.Name("Font"),
		"Subtype":  types.Name("CIDFontType2"),
		"BaseFont": types.Name(f.name),
		"CIDSystemInfo": types.Dict{
			"Registry":   types.StringLiteral("Adobe"),
			"Ordering":   types.StringLiteral("Identity"),
			"Supplement": types.Integer(0),
		},
		"FontDescriptor": *descriptor,
		"W":              types.Array{types.Integer(0), types.NewNumberArray(widths...)},
		"CIDToGIDMap":    types.Name("Identity"),
	})
	if err != nil {
		return nil, err
	}
	cmap, err := x.NewStreamDictForBuf([]byte(f.toUnicodeCMap()))
	if err != nil {
		return nil, err
	}
	if err := cmap.Encode(); err != nil {
		return nil, err
	}
	cmapRef, err := x.IndRefForNewObject(*cmap)
	if err != nil {
		return nil, err
	}
	return x.IndRefForNewObject(types.Dict{
		"Type":            types.Name("Font"),
		"Subtype":         types.Name("Type0"),
		"BaseFont":        types.Name(f.name),
		"Encoding":        types.Name("Identity-H"),
		"DescendantFonts": types.Array{*cid},
		"ToUnicode":       *cmapRef,
	})
}

// toUnicodeCMap maps each glyph back to its character, so text marks copy
// and search as text.
func (f *textFont) toUnicodeCMap() string {
	var b strings.Builder
	b.WriteString("/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n" +
		"/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n" +
		"/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n" +
		"1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n")
	var lines []string
	for g := 0; g < len(f.widths); g++ {
		if r, ok := f.toUnicode[sfnt.GlyphIndex(g)]; ok {
			lines = append(lines, fmt.Sprintf("<%04X> <%04X>", g, r))
		}
	}
	// bfchar blocks hold at most 100 entries each.
	for len(lines) > 0 {
		n := min(100, len(lines))
		fmt.Fprintf(&b, "%d beginbfchar\n%s\nendbfchar\n", n, strings.Join(lines[:n], "\n"))
		lines = lines[n:]
	}
	b.WriteString("endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n")
	return b.String()
}
