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
// simulated pressure, the highlighter's even width.
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
		Outline  [][2]float64 `json:"outline"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		got := getStroke(c.Points, strokeOptions{
			size: c.Size, thinning: c.Thinning, smoothing: 0.5, streamline: 0.5,
			simulatePressure: !c.Pressure, last: true,
		})
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
