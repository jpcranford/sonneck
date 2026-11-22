package annotpdf

import (
	"encoding/json"
	"math"
	"os"
	"testing"
)

// The port draws the same outline as perfect-freehand itself: outlines the
// JavaScript library produced (testdata/freehand-fixtures.mjs) for strokes
// that hit its branches — a dot, two points, a sharp reversal, real and
// simulated pressure, the highlighter's even width — and from the viewer's
// own pipeline (viewerStroke: traced with no size, at 10x scale, with the
// pen's tuning), short strokes included.
func TestGetStrokeMatchesPerfectFreehand(t *testing.T) {
	raw, err := os.ReadFile("testdata/freehand.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name     string       `json:"name"`
		Points   [][3]float64 `json:"points"`
		Size     float64      `json:"size"`
		Thinning float64      `json:"thinning"`
		Pressure bool         `json:"pressure"`
		Smooth   float64      `json:"smoothing"`
		Stream   float64      `json:"streamline"`
		Viewer   bool         `json:"viewer"`
		Outline  [][2]float64 `json:"outline"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		o := strokeOptions{
			size: c.Size, thinning: c.Thinning, smoothing: c.Smooth, streamline: c.Stream,
			simulatePressure: !c.Pressure, last: true,
		}
		got := getStroke(c.Points, o)
		if c.Viewer {
			got = viewerStroke(c.Points, o)
		}
		if len(got) != len(c.Outline) {
			t.Errorf("%s: %d outline points, want %d", c.Name, len(got), len(c.Outline))
			continue
		}
		for i, p := range got {
			if math.Abs(p[0]-c.Outline[i][0]) > 1e-9 || math.Abs(p[1]-c.Outline[i][1]) > 1e-9 {
				t.Errorf("%s: point %d = %v, want %v", c.Name, i, p, c.Outline[i])
				break
			}
		}
	}
}
