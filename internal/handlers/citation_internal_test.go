package handlers

import "testing"

func TestIsSelfPublished(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want bool
	}{
		{"Self-Published", true},
		{"self published", true},
		{"SELF PUBLISHED.", true},
		{"Self–published", true},
		{"  self_published!  ", true},
		{"Selfpublished", true},
		{"Self-Published Music", false},
		{"G. Schirmer", false},
		{"Self", false},
		{"", false},
	} {
		if got := isSelfPublished(tc.in); got != tc.want {
			t.Errorf("isSelfPublished(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}
