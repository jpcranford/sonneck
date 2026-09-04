package yearparse

import "testing"

func TestLeadingYear(t *testing.T) {
	tests := []struct {
		name   string
		input  string
		want   int
		wantOK bool
	}{
		{"bare year", "1685", 1685, true},
		{"circa abbreviation prefix", "ca. 1685", 1685, true},
		{"c dot prefix", "c. 1685", 1685, true},
		{"full word prefix", "circa 1685", 1685, true},
		{"range takes first number", "1830-1832", 1830, true},
		{"range with spaces", "1830 - 1832", 1830, true},
		{"trailing question mark", "1685?", 1685, true},
		{"embedded in longer sentence", "written sometime around 1708-1711", 1708, true},
		{"empty string", "", 0, false},
		{"whitespace only", "   ", 0, false},
		{"no digits at all", "unknown", 0, false},
		{"only punctuation", "n/a", 0, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := LeadingYear(tt.input)
			if ok != tt.wantOK {
				t.Fatalf("LeadingYear(%q) ok = %v, want %v", tt.input, ok, tt.wantOK)
			}
			if ok && got != tt.want {
				t.Errorf("LeadingYear(%q) = %d, want %d", tt.input, got, tt.want)
			}
		})
	}
}
