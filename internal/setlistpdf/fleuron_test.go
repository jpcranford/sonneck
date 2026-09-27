package setlistpdf

import (
	"bytes"
	"os"
	"testing"
)

func TestFleuronMatchesFrontendCopy(t *testing.T) {
	frontend, err := os.ReadFile("../../frontend/src/assets/ornaments/garamond-fleuron.svg")
	if err != nil {
		t.Fatalf("reading the frontend copy: %v", err)
	}
	if !bytes.Equal(frontend, garamondFleuronSVG) {
		t.Fatal("assets/garamond-fleuron.svg differs from frontend/src/assets/ornaments/garamond-fleuron.svg — copy the frontend file over this one")
	}
}

func TestParseFleuron(t *testing.T) {
	f := garamondFleuron
	if f.width != 99.55 || f.height != 100 {
		t.Errorf("viewBox size = %v×%v, want 99.55×100", f.width, f.height)
	}
	// The outline plus the two counters (the stem's slot and the bud).
	if len(f.subpaths) != 3 {
		t.Fatalf("subpaths = %d, want 3", len(f.subpaths))
	}
	curves := 0
	for _, sp := range f.subpaths {
		curves += len(sp.curves)
	}
	if curves != 157 {
		t.Errorf("curves = %d, want 157", curves)
	}
}

func TestParseFleuronRejectsUnsupportedCommands(t *testing.T) {
	for _, d := range []string{"M0 0L1 1Z", "M0 0c1 1 2 2 3 3Z", "C0 0 1 1 2 2Z", "M0 0C1 2 3Z"} {
		svg := []byte(`<svg viewBox="0 0 10 10"><path d="` + d + `"/></svg>`)
		if _, err := parseFleuron(svg); err == nil {
			t.Errorf("parseFleuron(%q) succeeded, want an error", d)
		}
	}
}
