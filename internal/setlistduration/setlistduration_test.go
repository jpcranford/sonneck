package setlistduration_test

import (
	"testing"

	"github.com/jpcranford/sonneck/internal/setlistduration"
)

func intp(n int) *int { return &n }

// Same worked example as the frontend's lib/setlistEstimate.test.ts: a 4:00
// piece, two pieces, a plain custom entry, and a custom entry counted as
// music, the last four without a duration.
func TestTotal_AssumesTypicalLengths(t *testing.T) {
	seconds, estimated := setlistduration.Total([]setlistduration.Entry{
		{Seconds: intp(240), IsMusic: true},
		{IsMusic: true},
		{IsMusic: true},
		{IsMusic: false},
		{IsMusic: true},
	})
	if want := 240 + 150 + 150 + 90 + 150; seconds != want || !estimated {
		t.Errorf("Total = (%d, %v), want (%d, true)", seconds, estimated, want)
	}
}

func TestTotal_RealDurationsAreNotAnEstimate(t *testing.T) {
	seconds, estimated := setlistduration.Total([]setlistduration.Entry{
		{Seconds: intp(240), IsMusic: true},
		{Seconds: intp(0), IsMusic: false},
	})
	if seconds != 240 || estimated {
		t.Errorf("Total = (%d, %v), want (240, false)", seconds, estimated)
	}
}

func TestTotal_EmptyProgram(t *testing.T) {
	if seconds, estimated := setlistduration.Total(nil); seconds != 0 || estimated {
		t.Errorf("Total(nil) = (%d, %v), want (0, false)", seconds, estimated)
	}
}
