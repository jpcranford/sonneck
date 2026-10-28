package annotpdf

import (
	"encoding/json"
	"math"
	"os"
	"testing"
	"time"
)

// sampleMarks is a page of every kind of mark: pen strokes with and without
// pressure, a highlighter, a dot, and text with bold, italic, a symbol, a
// line break and a wrap.
func sampleMarks() json.RawMessage {
	var pen, pressed, hl [][3]float64
	for i := 0; i <= 60; i++ {
		t := float64(i) / 60
		pen = append(pen, [3]float64{0.15 + 0.3*t, 0.30 + 0.02*math.Sin(t*9), 0.5})
		pressed = append(pressed, [3]float64{0.55 + 0.3*t, 0.30 + 0.03*math.Cos(t*6), 0.2 + 0.7*math.Sin(t*math.Pi)})
		hl = append(hl, [3]float64{0.15 + 0.7*t, 0.42, 0.5})
	}
	marks := []map[string]any{
		{"id": "a", "kind": "stroke", "tool": "pen", "layer": 5, "size": 0.39, "points": pen, "pressure": false},
		{"id": "b", "kind": "stroke", "tool": "pen", "layer": 0, "size": 0.58, "points": pressed, "pressure": true},
		{"id": "c", "kind": "stroke", "tool": "highlighter", "layer": 1, "size": 2, "points": hl, "pressure": false},
		{"id": "d", "kind": "stroke", "tool": "pen", "layer": 3, "size": 0.58, "points": [][3]float64{{0.5, 0.5, 0.5}}, "pressure": false},
		{"id": "e", "kind": "text", "layer": 2, "x": 0.15, "y": 0.55, "size": 1.8, "text": "Breathe **here**, then *subito* :pp:\nB:flat: in the left hand"},
		{"id": "f", "kind": "text", "layer": 4, "x": 0.6, "y": 0.65, "size": 2.4, "text": "A long note that has to wrap at the edge of the page", "italic": true},
		{"id": "g", "kind": "text", "layer": 0, "x": 0.15, "y": 0.8, "size": 1.4, "text": "Hidden color", "hidden": true},
	}
	raw, _ := json.Marshal(marks)
	return raw
}

// With ANNOTPDF_SAMPLE=<in.pdf>:<out.pdf>, writes sampleMarks on the first
// page of in.pdf, for looking at in PDF viewers.
func TestWriteSample(t *testing.T) {
	paths := os.Getenv("ANNOTPDF_SAMPLE")
	if paths == "" {
		t.Skip("set ANNOTPDF_SAMPLE=<in.pdf>:<out.pdf>")
	}
	var in, out string
	for i := len(paths) - 1; i >= 0; i-- {
		if paths[i] == ':' {
			in, out = paths[:i], paths[i+1:]
			break
		}
	}
	src, err := os.Open(in)
	if err != nil {
		t.Fatal(err)
	}
	defer src.Close()
	dst, err := os.Create(out)
	if err != nil {
		t.Fatal(err)
	}
	defer dst.Close()
	if err := Write(src, dst, map[int]json.RawMessage{1: sampleMarks()}, Options{Author: "Sample", Now: time.Now()}); err != nil {
		t.Fatal(err)
	}
}
