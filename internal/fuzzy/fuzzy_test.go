package fuzzy_test

import (
	"testing"

	"github.com/jpcranford/sonneck/internal/fuzzy"
)

func TestDamerauLevenshtein(t *testing.T) {
	for _, tc := range []struct {
		a, b string
		want int
	}{
		{"", "", 0},
		{"abc", "abc", 0},
		{"Abc", "abc", 0}, // case-insensitive
		{"abc", "abd", 1}, // substitution
		{"abc", "ab", 1},  // deletion
		{"ab", "abc", 1},  // insertion
		{"ab", "ba", 1},   // adjacent transposition — the reason for Damerau over plain Levenshtein
		{"nutkracker", "nutcracker", 1},
		{"sostenato", "sostenuto", 1}, // single substitution: "a"→"u"
		{"kitten", "sitting", 3}, // classic textbook example
	} {
		if got := fuzzy.DamerauLevenshtein(tc.a, tc.b); got != tc.want {
			t.Errorf("DamerauLevenshtein(%q, %q) = %d, want %d", tc.a, tc.b, got, tc.want)
		}
	}
}

func TestMinWordDistance(t *testing.T) {
	for _, tc := range []struct {
		text, query string
		want        int
	}{
		{"", "sostenato", 1 << 30},
		{"Andante Sostenuto", "", 1 << 30},
		// Whole-text comparison wins: a typo across an otherwise-complete
		// multi-word phrase.
		{"Nutcracker Suite", "nutkracker suite", 1},
		// Per-word comparison wins: a single, out-of-context word doesn't
		// resemble the whole (longer) text, but does resemble one word in it.
		{"Andante Sostenuto", "sostenato", 1},
		{"Andante Sostenuto", "andantno", 2},
		// A real non-match: an unrelated word should be far from both the
		// whole text and every individual word in it.
		{"Nutcracker Suite", "xylophone", 8},
	} {
		if got := fuzzy.MinWordDistance(tc.text, tc.query); got != tc.want {
			t.Errorf("MinWordDistance(%q, %q) = %d, want %d", tc.text, tc.query, got, tc.want)
		}
	}
}

func TestMaxDistance(t *testing.T) {
	for _, tc := range []struct {
		query string
		want  int
	}{
		{"a", 1},                             // floored at 1, never zero
		{"an", 1},
		{"boelu", 2},                         // ceil(5/4) = 2, not floor(5/4) = 1 — the case this was widened for
		{"andantno", 2},                      // 8 chars: exact multiple of 4, ceiling == floor here
		{"nutkracker suite", 3},               // 16 chars / 4 = 4, capped at 3
		{"a very long search query here", 3}, // capped regardless of length
	} {
		if got := fuzzy.MaxDistance(tc.query); got != tc.want {
			t.Errorf("MaxDistance(%q) = %d, want %d", tc.query, got, tc.want)
		}
	}
}
