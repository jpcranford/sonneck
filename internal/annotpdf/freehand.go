package annotpdf

import "math"

// A Go port of perfect-freehand's getStroke (v1.2.2, MIT, Steve Ruiz), the
// library the Sheet Viewer draws pen and highlighter strokes with
// (frontend/src/lib/sheetViewerMarks.ts's strokePath), so a stroke's
// outline in the PDF is the exact shape drawn in the viewer, pressure
// included. Only the options the viewer passes are carried over: no
// tapers, both ends capped, linear pressure easing. Ported line for line
// from the published build; freehand_test.go checks it against outlines
// the JavaScript library produced.

type vec [2]float64

func add(a, b vec) vec             { return vec{a[0] + b[0], a[1] + b[1]} }
func sub(a, b vec) vec             { return vec{a[0] - b[0], a[1] - b[1]} }
func mul(a vec, n float64) vec     { return vec{a[0] * n, a[1] * n} }
func per(a vec) vec                { return vec{a[1], -a[0]} }
func neg(a vec) vec                { return vec{-a[0], -a[1]} }
func dot(a, b vec) float64         { return a[0]*b[0] + a[1]*b[1] }
func dist(a, b vec) float64        { return math.Hypot(a[1]-b[1], a[0]-b[0]) }
func dist2(a, b vec) float64       { d := sub(a, b); return d[0]*d[0] + d[1]*d[1] }
func lerp(a, b vec, t float64) vec { return add(a, mul(sub(b, a), t)) }
func unit(a vec) vec {
	l := math.Hypot(a[0], a[1])
	return vec{a[0] / l, a[1] / l}
}

// rotAround rotates a around c by r radians.
func rotAround(a, c vec, r float64) vec {
	s, co := math.Sin(r), math.Cos(r)
	x, y := a[0]-c[0], a[1]-c[1]
	return vec{x*co - y*s + c[0], x*s + y*co + c[1]}
}

// strokeOptions are the getStroke options the viewer sets.
type strokeOptions struct {
	size, thinning, smoothing, streamline float64
	simulatePressure, last                bool
}

// noPressure marks an input point that carries no pressure of its own
// (JavaScript's undefined): the library then assumes one.
const noPressure = -1

type strokePoint struct {
	point                   vec
	pressure                float64
	vector                  vec
	distance, runningLength float64
}

// strokePoints is getStrokePoints: the input points, streamlined, with
// each one's direction, distance and running length.
func strokePoints(in [][3]float64, o strokeOptions) []strokePoint {
	if len(in) == 0 {
		return nil
	}
	t := 0.15 + (1-o.streamline)*0.85
	pts := append([][3]float64(nil), in...)
	if len(pts) == 2 {
		end := pts[1]
		pts = pts[:1]
		for i := 1; i < 5; i++ {
			p := lerp(vec{pts[0][0], pts[0][1]}, vec{end[0], end[1]}, float64(i)/4)
			pts = append(pts, [3]float64{p[0], p[1], noPressure})
		}
	}
	if len(pts) == 1 {
		pts = append(pts, [3]float64{pts[0][0] + 1, pts[0][1] + 1, pts[0][2]})
	}
	first := strokePoint{point: vec{pts[0][0], pts[0][1]}, pressure: 0.25, vector: vec{1, 1}}
	if pts[0][2] >= 0 {
		first.pressure = pts[0][2]
	}
	out := []strokePoint{first}
	reachedSize := false
	running := 0.0
	prev := first
	last := len(pts) - 1
	for i := 1; i < len(pts); i++ {
		var p vec
		if o.last && i == last {
			p = vec{pts[i][0], pts[i][1]}
		} else {
			p = lerp(prev.point, vec{pts[i][0], pts[i][1]}, t)
		}
		if p == prev.point {
			continue
		}
		d := dist(p, prev.point)
		running += d
		if i < last && !reachedSize {
			if running < o.size {
				continue
			}
			reachedSize = true
		}
		pressure := 0.5
		if pts[i][2] >= 0 {
			pressure = pts[i][2]
		}
		prev = strokePoint{point: p, pressure: pressure, vector: unit(sub(prev.point, p)), distance: d, runningLength: running}
		out = append(out, prev)
	}
	if len(out) > 1 {
		out[0].vector = out[1].vector
	} else {
		out[0].vector = vec{0, 0}
	}
	return out
}

const rateOfPressureChange = 0.275

// fixedPi is the library's FIXED_PI: a hair over π, so a cap's last
// rotation step lands past the half turn.
const fixedPi = math.Pi + 1e-4

func strokeRadius(size, thinning, pressure float64) float64 {
	return size * (0.5 - thinning*(0.5-pressure))
}

// strokeOutline is getStrokeOutlinePoints: the polygon around the stroke.
func strokeOutline(points []strokePoint, o strokeOptions) []vec {
	if len(points) == 0 || o.size <= 0 {
		return nil
	}
	n := len(points)
	totalLength := points[n-1].runningLength
	minDistance := math.Pow(o.size*o.smoothing, 2)
	var left, right []vec

	prevPressure := points[0].pressure
	for _, p := range points[:min(10, n)] {
		pressure := p.pressure
		if o.simulatePressure {
			sp := math.Min(1, p.distance/o.size)
			rp := math.Min(1, 1-sp)
			pressure = math.Min(1, prevPressure+(rp-prevPressure)*(sp*rateOfPressureChange))
		}
		prevPressure = (prevPressure + pressure) / 2
	}

	radius := strokeRadius(o.size, o.thinning, points[n-1].pressure)
	firstRadius, haveFirst := 0.0, false
	prevVector := points[0].vector
	pl, pr := points[0].point, points[0].point
	tl, tr := pl, pr
	isPrevSharp := false

	for i := 0; i < n; i++ {
		pressure := points[i].pressure
		point, vector, distance, running := points[i].point, points[i].vector, points[i].distance, points[i].runningLength
		if i < n-1 && totalLength-running < 3 {
			continue
		}
		if o.thinning != 0 {
			if o.simulatePressure {
				sp := math.Min(1, distance/o.size)
				rp := math.Min(1, 1-sp)
				pressure = math.Min(1, prevPressure+(rp-prevPressure)*(sp*rateOfPressureChange))
			}
			radius = strokeRadius(o.size, o.thinning, pressure)
		} else {
			radius = o.size / 2
		}
		if !haveFirst {
			firstRadius, haveFirst = radius, true
		}
		radius = math.Max(0.01, radius)

		nextVector := points[i].vector
		nextDot := 1.0
		if i < n-1 {
			nextVector = points[i+1].vector
			nextDot = dot(vector, nextVector)
		}
		prevDot := dot(vector, prevVector)
		isPointSharp := prevDot < 0 && !isPrevSharp
		isNextSharp := nextDot < 0
		if isPointSharp || isNextSharp {
			off := mul(per(prevVector), radius)
			for step, t := 1.0/13, 0.0; t <= 1; t += step {
				tl = rotAround(sub(point, off), point, fixedPi*t)
				left = append(left, tl)
				tr = rotAround(add(point, off), point, fixedPi*-t)
				right = append(right, tr)
			}
			pl, pr = tl, tr
			if isNextSharp {
				isPrevSharp = true
			}
			continue
		}
		isPrevSharp = false
		if i == n-1 {
			off := mul(per(vector), radius)
			left = append(left, sub(point, off))
			right = append(right, add(point, off))
			continue
		}
		off := mul(per(lerp(nextVector, vector, nextDot)), radius)
		tl = sub(point, off)
		if i <= 1 || dist2(pl, tl) > minDistance {
			left = append(left, tl)
			pl = tl
		}
		tr = add(point, off)
		if i <= 1 || dist2(pr, tr) > minDistance {
			right = append(right, tr)
			pr = tr
		}
		prevPressure = pressure
		prevVector = vector
	}

	first := points[0].point
	lastPoint := add(points[0].point, vec{1, 1})
	if n > 1 {
		lastPoint = points[n-1].point
	}
	if n == 1 {
		r := firstRadius
		if r == 0 {
			r = radius
		}
		start := add(first, mul(unit(per(sub(first, lastPoint))), -r))
		var dot []vec
		for step, t := 1.0/13, 1.0/13; t <= 1; t += step {
			dot = append(dot, rotAround(start, first, fixedPi*2*t))
		}
		return dot
	}
	var startCap []vec
	for step, t := 1.0/13, 1.0/13; t <= 1; t += step {
		startCap = append(startCap, rotAround(right[0], first, fixedPi*t))
	}
	var endCap []vec
	direction := per(neg(points[n-1].vector))
	start := add(lastPoint, mul(direction, radius))
	for step, t := 1.0/29, 1.0/29; t < 1; t += step {
		endCap = append(endCap, rotAround(start, lastPoint, fixedPi*3*t))
	}
	out := append(left, endCap...)
	for i := len(right) - 1; i >= 0; i-- {
		out = append(out, right[i])
	}
	return append(out, startCap...)
}

// getStroke is the library's getStroke.
func getStroke(points [][3]float64, o strokeOptions) []vec {
	return strokeOutline(strokePoints(points, o), o)
}
