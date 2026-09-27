package setlistpdf

import (
	_ "embed"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"codeberg.org/go-pdf/fpdf"
)

// garamond-fleuron.svg is a byte-for-byte copy of the frontend's
// assets/ornaments/garamond-fleuron.svg (credited in the README's
// Acknowledgements): go:embed can't reach outside this
// package, and the Docker frontend build can't see internal/, so each side
// keeps its own copy. TestFleuronMatchesFrontendCopy fails if they drift.
//
//go:embed assets/garamond-fleuron.svg
var garamondFleuronSVG []byte

// fleuronShape is the parsed ornament: its viewBox size and its subpaths,
// each a start point followed by cubic Bézier segments.
type fleuronShape struct {
	width, height float64
	subpaths      []fleuronSubpath
}

type fleuronSubpath struct {
	startX, startY float64
	curves         [][6]float64 // cx0, cy0, cx1, cy1, x, y
}

var garamondFleuron = mustParseFleuron(garamondFleuronSVG)

var (
	svgViewBoxRe = regexp.MustCompile(`viewBox="([^"]+)"`)
	svgPathDRe   = regexp.MustCompile(` d="([^"]+)"`)
	svgTokenRe   = regexp.MustCompile(`[MCZmcz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?`)
)

func mustParseFleuron(svg []byte) fleuronShape {
	shape, err := parseFleuron(svg)
	if err != nil {
		panic(fmt.Sprintf("setlistpdf: embedded fleuron: %v", err))
	}
	return shape
}

// parseFleuron reads the one path the fleuron is drawn with. It handles only
// what that file actually uses — absolute M, C and Z — and rejects anything
// else rather than drawing it wrong.
func parseFleuron(svg []byte) (fleuronShape, error) {
	var shape fleuronShape
	vb := svgViewBoxRe.FindSubmatch(svg)
	if vb == nil {
		return shape, fmt.Errorf("no viewBox")
	}
	nums := strings.Fields(string(vb[1]))
	if len(nums) != 4 {
		return shape, fmt.Errorf("malformed viewBox %q", vb[1])
	}
	var err error
	if shape.width, err = strconv.ParseFloat(nums[2], 64); err != nil {
		return shape, err
	}
	if shape.height, err = strconv.ParseFloat(nums[3], 64); err != nil {
		return shape, err
	}

	d := svgPathDRe.FindSubmatch(svg)
	if d == nil {
		return shape, fmt.Errorf("no path data")
	}
	tokens := svgTokenRe.FindAllString(string(d[1]), -1)
	numbers := func(i, n int) ([]float64, error) {
		if i+n > len(tokens) {
			return nil, fmt.Errorf("path data ends mid-command")
		}
		out := make([]float64, n)
		for j := range n {
			v, err := strconv.ParseFloat(tokens[i+j], 64)
			if err != nil {
				return nil, fmt.Errorf("expected a number, got %q", tokens[i+j])
			}
			out[j] = v
		}
		return out, nil
	}

	var current *fleuronSubpath
	for i := 0; i < len(tokens); {
		switch tokens[i] {
		case "M":
			v, err := numbers(i+1, 2)
			if err != nil {
				return shape, err
			}
			shape.subpaths = append(shape.subpaths, fleuronSubpath{startX: v[0], startY: v[1]})
			current = &shape.subpaths[len(shape.subpaths)-1]
			i += 3
		case "C":
			if current == nil {
				return shape, fmt.Errorf("curve before any moveto")
			}
			i++
			// A C may be followed by further implicit coordinate sextets.
			for i < len(tokens) && !strings.ContainsAny(tokens[i], "MCZmcz") {
				v, err := numbers(i, 6)
				if err != nil {
					return shape, err
				}
				current.curves = append(current.curves, [6]float64{v[0], v[1], v[2], v[3], v[4], v[5]})
				i += 6
			}
		case "Z":
			current = nil
			i++
		default:
			return shape, fmt.Errorf("unsupported path command %q", tokens[i])
		}
	}
	if len(shape.subpaths) == 0 {
		return shape, fmt.Errorf("empty path")
	}
	return shape, nil
}

// drawFleuron fills the fleuron into the box whose top-left corner is
// (x, y), scaled to the given height, in color c — even-odd, as the SVG's
// own fill-rule specifies, so its inner counters stay open. rotated turns it
// 180° within that same box (the cover's lower ornament).
func drawFleuron(pdf *fpdf.Fpdf, x, y, height float64, rotated bool, c rgbColor) {
	f := garamondFleuron
	scale := height / f.height
	width := f.width * scale
	pt := func(vx, vy float64) (float64, float64) {
		if rotated {
			return x + width - vx*scale, y + height - vy*scale
		}
		return x + vx*scale, y + vy*scale
	}
	setFill(pdf, c)
	for _, sp := range f.subpaths {
		pdf.MoveTo(pt(sp.startX, sp.startY))
		for _, cv := range sp.curves {
			cx0, cy0 := pt(cv[0], cv[1])
			cx1, cy1 := pt(cv[2], cv[3])
			ex, ey := pt(cv[4], cv[5])
			pdf.CurveBezierCubicTo(cx0, cy0, cx1, cy1, ex, ey)
		}
		pdf.ClosePath()
	}
	pdf.DrawPath("F*")
}

// fleuronWidth is the fleuron's width when drawn at the given height.
func fleuronWidth(height float64) float64 {
	return garamondFleuron.width * height / garamondFleuron.height
}
