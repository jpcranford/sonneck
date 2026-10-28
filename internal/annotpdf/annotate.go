// Package annotpdf writes a reader's Sheet Viewer marks into a copy of a
// piece's PDF as real PDF annotations — never drawn into the page — so other
// apps (Acrobat, Preview, forScore, MobileSheets) can still move, edit,
// hide or delete them: Download PDF + Annotations.
//
// Pen and highlighter strokes become /Ink annotations: the stroke's path
// for apps that edit it, and an appearance drawing the exact outline the
// viewer draws (freehand.go), pressure included; the highlighter's is
// multiplied over the page at the viewer's 42%. Text marks become /FreeText
// annotations whose appearance is the text laid out as the viewer lays it
// out (text.go), in an embedded Quintessential; an app that edits one
// redraws it in a font of its own. Marks are placed through the page's
// CropBox and /Rotate, as the viewer's page images are rendered.
//
// The PDF is read and rewritten whole with pdfcpu (Apache-2.0): its own
// pages, objects and existing annotations are kept, the new annotations
// added after any already on a page.
package annotpdf

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"

	"github.com/jpcranford/sonneck/internal/repo"
)

func init() {
	// pdfcpu otherwise writes a config folder into the user's home on first
	// use.
	api.DisableConfigDir()
}

// The six annotation colors (lib/sheetViewerTools.ts's LAYER_COLORS, their
// light values: a PDF page is white), by layer.
var layerColors = [6]string{"#d73d2d", "#f2c12e", "#2c71e2", "#1b8749", "#8e5fc3", "#2b2622"}

// The highlighter's strength on a light page (SheetViewerAnnotations.tsx).
const highlighterOpacity = 0.42

// mark is one stored mark (internal/repo's StrokeMark or TextMark).
type mark struct {
	ID       string       `json:"id"`
	Kind     string       `json:"kind"`
	Tool     string       `json:"tool"`
	Layer    int          `json:"layer"`
	Size     float64      `json:"size"`
	Points   [][3]float64 `json:"points"`
	Pressure bool         `json:"pressure"`
	X        float64      `json:"x"`
	Y        float64      `json:"y"`
	Text     string       `json:"text"`
	Italic   bool         `json:"italic"`
}

// Options says whose marks these are and which to leave out.
type Options struct {
	// Author names the annotations' author (/T).
	Author string
	// HiddenColors is the piece's hidden colors, bit i for layer i
	// (piece_practice_settings.hidden_colors): their marks are left out.
	HiddenColors int
	Now          time.Time
}

func (o Options) hidden(layer int) bool { return o.HiddenColors&(1<<layer) != 0 }

// Count returns how many of a piece's marks would be exported and how many
// are left out for being in a hidden color. pages maps a page number to
// its stored marks.
func Count(pages map[int]json.RawMessage, hiddenColors int) (shown, hidden int, err error) {
	o := Options{HiddenColors: hiddenColors}
	for _, raw := range pages {
		var marks []mark
		if err := json.Unmarshal(raw, &marks); err != nil {
			return 0, 0, err
		}
		for _, m := range marks {
			if o.hidden(m.Layer) {
				hidden++
			} else {
				shown++
			}
		}
	}
	return shown, hidden, nil
}

// ErrNoMarks means none of the marks would be exported.
var ErrNoMarks = errors.New("no annotations to add")

// Write copies the PDF in src to w with the marks added as annotations.
// pages maps a page number to its stored marks; pages past the PDF's last
// are skipped. ErrNoMarks when there's nothing to add (w untouched).
func Write(src io.ReadSeeker, w io.Writer, pages map[int]json.RawMessage, opts Options) error {
	if opts.Now.IsZero() {
		opts.Now = time.Now()
	}
	decoded := map[int][]mark{}
	for page, raw := range pages {
		var marks []mark
		if err := json.Unmarshal(raw, &marks); err != nil {
			return fmt.Errorf("annotations on page %d: %w", page, err)
		}
		// Strokes are drawn under text in the viewer: keep that order.
		var strokes, texts []mark
		for _, m := range marks {
			if opts.hidden(m.Layer) || m.Layer < 0 || m.Layer >= len(layerColors) {
				continue
			}
			if m.Kind == "text" && repo.TextOnPage(m.X, m.Y, m.Size) {
				texts = append(texts, m)
			} else if m.Kind == "stroke" && repo.StrokeTouchesPage(m.Points) {
				strokes = append(strokes, m)
			}
		}
		if all := append(strokes, texts...); len(all) > 0 {
			decoded[page] = all
		}
	}
	if len(decoded) == 0 {
		return ErrNoMarks
	}

	conf := model.NewDefaultConfiguration()
	conf.ValidationMode = model.ValidationRelaxed
	ctx, err := api.ReadAndValidate(src, conf)
	if err != nil {
		return fmt.Errorf("reading the PDF: %w", err)
	}
	doc := &document{opts: opts}
	add := map[int][]model.AnnotationRenderer{}
	for page, marks := range decoded {
		if page < 1 || page > ctx.PageCount {
			continue
		}
		_, _, attrs, err := ctx.PageDict(page, false)
		if err != nil {
			return fmt.Errorf("page %d: %w", page, err)
		}
		geo := pageGeometry(attrs)
		for _, m := range marks {
			add[page] = append(add[page], annotation{doc: doc, geo: geo, m: m})
		}
	}
	if len(add) == 0 {
		return ErrNoMarks
	}
	if _, err := pdfcpu.AddAnnotationsMap(ctx, add, false); err != nil {
		return fmt.Errorf("adding annotations: %w", err)
	}
	var out bytes.Buffer
	if err := api.Write(ctx, &out, conf); err != nil {
		return fmt.Errorf("writing the PDF: %w", err)
	}
	_, err = w.Write(out.Bytes())
	return err
}

// geometry maps the page as the viewer shows it — its CropBox, turned by
// /Rotate — to the PDF's own coordinates. Display space here is in points
// with y up, from the shown page's bottom left.
type geometry struct {
	width, height float64    // the page as shown, in points
	matrix        [6]float64 // display space → PDF user space
}

func pageGeometry(attrs *model.InheritedPageAttrs) geometry {
	box := attrs.CropBox
	if box == nil {
		box = attrs.MediaBox
	}
	if box == nil {
		box = types.NewRectangle(0, 0, 612, 792)
	}
	if attrs.MediaBox != nil && attrs.CropBox != nil {
		// A CropBox reaching past the MediaBox is cut to it, as renderers do.
		m := attrs.MediaBox
		box = types.NewRectangle(
			math.Max(box.LL.X, m.LL.X), math.Max(box.LL.Y, m.LL.Y),
			math.Min(box.UR.X, m.UR.X), math.Min(box.UR.Y, m.UR.Y))
	}
	x0, y0, x1, y1 := box.LL.X, box.LL.Y, box.UR.X, box.UR.Y
	w, h := x1-x0, y1-y0
	switch ((attrs.Rotate % 360) + 360) % 360 {
	case 90:
		return geometry{width: h, height: w, matrix: [6]float64{0, 1, -1, 0, x1, y0}}
	case 180:
		return geometry{width: w, height: h, matrix: [6]float64{-1, 0, 0, -1, x1, y1}}
	case 270:
		return geometry{width: h, height: w, matrix: [6]float64{0, -1, 1, 0, x0, y1}}
	}
	return geometry{width: w, height: h, matrix: [6]float64{1, 0, 0, 1, x0, y0}}
}

// toUser maps a display-space point to user space.
func (g geometry) toUser(p vec) vec {
	m := g.matrix
	return vec{m[0]*p[0] + m[2]*p[1] + m[4], m[1]*p[0] + m[3]*p[1] + m[5]}
}

// fromShare maps a page share (x of its width, y of its height from the
// top) to display space.
func (g geometry) fromShare(x, y float64) vec { return vec{x * g.width, g.height - y*g.height} }

// clamp cuts a display-space box to the page.
func (g geometry) clamp(ll, ur vec) (vec, vec) {
	return vec{math.Max(ll[0], 0), math.Max(ll[1], 0)}, vec{math.Min(ur[0], g.width), math.Min(ur[1], g.height)}
}

// userRect is the user-space rectangle around display-space corners.
func (g geometry) userRect(ll, ur vec) *types.Rectangle {
	a, b := g.toUser(ll), g.toUser(ur)
	return types.NewRectangle(math.Min(a[0], b[0]), math.Min(a[1], b[1]), math.Max(a[0], b[0]), math.Max(a[1], b[1]))
}

// document holds what annotations in one PDF share: the embedded fonts,
// added once on first use.
type document struct {
	opts  Options
	fonts types.Dict
}

func (d *document) fontResources(x *model.XRefTable) (types.Dict, error) {
	if d.fonts != nil {
		return d.fonts, nil
	}
	fonts := types.Dict{}
	for f, name := range fontNames {
		ref, err := f.embed(x)
		if err != nil {
			return nil, err
		}
		fonts[name] = *ref
	}
	d.fonts = fonts
	return fonts, nil
}

// annotation is one mark, rendered into its annotation dict when pdfcpu
// adds it to its page.
type annotation struct {
	doc *document
	geo geometry
	m   mark
}

func (a annotation) Type() model.AnnotationType {
	if a.m.Kind == "text" {
		return model.AnnFreeText
	}
	return model.AnnInk
}
func (a annotation) Rectangle() types.Rectangle { return types.Rectangle{} }
func (a annotation) RectString() string         { return "" }
func (a annotation) APObjNrInt() int            { return 0 }
func (a annotation) ID() string                 { return "" }
func (a annotation) Content() string            { return "" }
func (a annotation) ContentString() string      { return "" }
func (a annotation) CustomTypeString() string   { return "" }

func (a annotation) RenderDict(x *model.XRefTable, page *types.IndirectRef) (types.Dict, error) {
	color := hexColor(layerColors[a.m.Layer])
	date := types.DateString(a.doc.opts.Now)
	d := types.Dict{
		"Type":         types.Name("Annot"),
		"P":            *page,
		"F":            types.Integer(4), // print
		"NM":           types.StringLiteral("sonneck-" + a.m.ID),
		"M":            types.StringLiteral(date),
		"CreationDate": types.StringLiteral(date),
		"C":            types.NewNumberArray(color[:]...),
	}
	if a.doc.opts.Author != "" {
		author, err := types.EscapedUTF16String(a.doc.opts.Author)
		if err != nil {
			return nil, err
		}
		d["T"] = types.StringLiteral(*author)
	}
	if a.m.Kind == "text" {
		return a.textDict(x, d, color)
	}
	return a.strokeDict(x, d, color)
}

// strokeDict fills in a pen or highlighter stroke's /Ink annotation.
func (a annotation) strokeDict(x *model.XRefTable, d types.Dict, color [3]float64) (types.Dict, error) {
	g, m := a.geo, a.m
	// The viewer works out the outline in a box 1000 units wide (its
	// MARKS_W): the library's few fixed distances are in those units, so
	// the same box gives the same shape.
	const marksW = 1000.0
	marksH := marksW * g.height / g.width
	points := make([][3]float64, len(m.Points))
	for i, p := range m.Points {
		points[i] = [3]float64{p[0] * marksW, p[1] * marksH, p[2]}
	}
	thinning := 0.5
	if m.Tool == "highlighter" {
		thinning = 0
	}
	outline := getStroke(points, strokeOptions{
		size: m.Size / 100 * marksW, thinning: thinning, smoothing: 0.5, streamline: 0.5,
		simulatePressure: !m.Pressure, last: true,
	})
	scale := g.width / marksW
	display := make([]vec, len(outline))
	for i, p := range outline {
		display[i] = vec{p[0] * scale, g.height - p[1]*scale}
	}
	path := outlinePath(display)
	if path == "" {
		return nil, fmt.Errorf("stroke %s has no outline", m.ID)
	}
	ll, ur := bounds(display, 1)

	var content strings.Builder
	var res types.Dict
	if m.Tool == "highlighter" {
		res = types.Dict{"ExtGState": types.Dict{"H": types.Dict{
			"Type": types.Name("ExtGState"), "BM": types.Name("Multiply"),
			"ca": types.Float(highlighterOpacity), "CA": types.Float(highlighterOpacity),
		}}}
		content.WriteString("/H gs\n")
		d["CA"] = types.Float(highlighterOpacity)
		d["IT"] = types.Name("InkHighlight")
	}
	fmt.Fprintf(&content, "%s rg\n%sf\n", num3(color), path)
	ap, err := appearance(x, g, ll, ur, content.String(), res)
	if err != nil {
		return nil, err
	}

	var ink []float64
	for _, p := range m.Points {
		u := g.toUser(g.fromShare(p[0], p[1]))
		ink = append(ink, round2(u[0]), round2(u[1]))
	}
	if len(m.Points) == 1 {
		ink = append(ink, ink[0], ink[1])
	}
	d["Subtype"] = types.Name("Ink")
	d["Rect"] = g.userRect(g.clamp(ll, ur)).Array()
	d["InkList"] = types.Array{types.NewNumberArray(ink...)}
	d["BS"] = types.Dict{"W": types.Float(round2(m.Size / 100 * g.width))}
	d["AP"] = types.Dict{"N": *ap}
	return d, nil
}

// textDict fills in a text mark's /FreeText annotation.
func (a annotation) textDict(x *model.XRefTable, d types.Dict, color [3]float64) (types.Dict, error) {
	g, m := a.geo, a.m
	size := m.Size / 100 * g.width
	maxWidth := ((1-m.X)*g.width - 0.01*g.width) / size
	layout := layoutText(m.Text, m.Italic, math.Max(maxWidth, 1))
	// The box's top is one size above the mark's y (textBoxStyle).
	left, top := m.X*g.width, g.height-m.Y*g.height+size
	// A little room for slanted and heavier glyphs past their advances.
	pad := 0.3 * size
	ll := vec{left - pad, top - layout.height*size - pad}
	ur := vec{left + layout.width*size + pad, top + pad}

	var content strings.Builder
	drawText(&content, layout, size, left, top, color)
	fonts, err := a.doc.fontResources(x)
	if err != nil {
		return nil, err
	}
	ap, err := appearance(x, g, ll, ur, content.String(), types.Dict{"Font": fonts})
	if err != nil {
		return nil, err
	}
	contents, err := types.EscapedUTF16String(layout.plain)
	if err != nil {
		return nil, err
	}
	d["Subtype"] = types.Name("FreeText")
	d["Rect"] = g.userRect(g.clamp(ll, ur)).Array()
	d["Contents"] = types.StringLiteral(*contents)
	// For an app that redraws the text: its size and color (in a font of
	// its own), and no border.
	d["DA"] = types.StringLiteral(fmt.Sprintf("/Helv %s Tf %s rg", num(size), num3(color)))
	d["BS"] = types.Dict{"W": types.Integer(0)}
	d["AP"] = types.Dict{"N": *ap}
	return d, nil
}

// appearance adds a form XObject drawing content (in display space) over
// the display-space box ll–ur; its matrix places it on the page. Nothing
// is drawn past the page's edges: the box is cut to the page, and the
// content clipped to it.
func appearance(x *model.XRefTable, g geometry, ll, ur vec, content string, res types.Dict) (*types.IndirectRef, error) {
	ll, ur = g.clamp(ll, ur)
	content = fmt.Sprintf("0 0 %s %s re W n\n", num(g.width), num(g.height)) + content
	sd, err := x.NewStreamDictForBuf([]byte(content))
	if err != nil {
		return nil, err
	}
	sd.InsertName("Type", "XObject")
	sd.InsertName("Subtype", "Form")
	sd.Insert("BBox", types.NewNumberArray(ll[0], ll[1], ur[0], ur[1]))
	m := g.matrix
	sd.Insert("Matrix", types.NewNumberArray(m[0], m[1], m[2], m[3], m[4], m[5]))
	if res != nil {
		sd.Insert("Resources", res)
	}
	if err := sd.Encode(); err != nil {
		return nil, err
	}
	return x.IndRefForNewObject(*sd)
}

// outlinePath is perfect-freehand's outline-to-path (its README, as
// lib/sheetViewerMarks.ts draws it) in PDF operators: quadratic curves
// through the outline's midpoints, each smooth one's control mirrored from
// the last (SVG's T), written as cubics, closed.
func outlinePath(p []vec) string {
	if len(p) < 4 {
		return ""
	}
	mid := func(a, b vec) vec { return vec{(a[0] + b[0]) / 2, (a[1] + b[1]) / 2} }
	var b strings.Builder
	cur := p[0]
	fmt.Fprintf(&b, "%s %s m\n", num(cur[0]), num(cur[1]))
	quad := func(c, to vec) {
		c1 := add(cur, mul(sub(c, cur), 2.0/3))
		c2 := add(to, mul(sub(c, to), 2.0/3))
		fmt.Fprintf(&b, "%s %s %s %s %s %s c\n", num(c1[0]), num(c1[1]), num(c2[0]), num(c2[1]), num(to[0]), num(to[1]))
		cur = to
	}
	control := p[1]
	quad(control, mid(p[1], p[2]))
	for i := 2; i < len(p)-1; i++ {
		control = sub(mul(cur, 2), control)
		quad(control, mid(p[i], p[i+1]))
	}
	b.WriteString("h\n")
	return b.String()
}

// bounds is the box around points, grown by pad.
func bounds(points []vec, pad float64) (vec, vec) {
	ll := vec{math.Inf(1), math.Inf(1)}
	ur := vec{math.Inf(-1), math.Inf(-1)}
	for _, p := range points {
		ll = vec{math.Min(ll[0], p[0]), math.Min(ll[1], p[1])}
		ur = vec{math.Max(ur[0], p[0]), math.Max(ur[1], p[1])}
	}
	return vec{ll[0] - pad, ll[1] - pad}, vec{ur[0] + pad, ur[1] + pad}
}

func hexColor(h string) [3]float64 {
	v, _ := strconv.ParseUint(strings.TrimPrefix(h, "#"), 16, 32)
	return [3]float64{float64(v>>16&255) / 255, float64(v>>8&255) / 255, float64(v&255) / 255}
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

// num writes a number for a content stream: at most 3 decimals, no
// exponent.
func num(v float64) string {
	s := strconv.FormatFloat(math.Round(v*1000)/1000, 'f', -1, 64)
	if s == "-0" {
		return "0"
	}
	return s
}

func num3(c [3]float64) string { return num(c[0]) + " " + num(c[1]) + " " + num(c[2]) }
