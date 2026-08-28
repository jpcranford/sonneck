// Package fuzzy implements typo-tolerant matching for the Piece Library's
// search box (design doc §11) — the third and last of three search tiers
// (CLAUDE.md > Search): exact/prefix matching (pieces_fts), then
// substring-anywhere matching (pieces_fts_trigram), then this. Kept as its
// own leaf package (no database dependency) so the matching algorithm
// itself is unit-testable in isolation from the SQL integration that calls
// it — internal/db registers MinWordDistance as a real SQLite scalar
// function (modernc.org/sqlite's RegisterDeterministicScalarFunction, no
// CGO needed — see the research trail in project memory for why this beats
// both spellfix1, which isn't compiled into this project's pure-Go driver,
// and a fetch-then-rank-in-Go approach, which would need its own
// pagination handling since a Go-computed score isn't otherwise
// SQL-sortable).
package fuzzy

import "strings"

// DamerauLevenshtein computes the restricted edit distance (the "Optimal
// String Alignment" variant — Levenshtein plus one adjacent-transposition
// swap counted as a single edit) between a and b, case-insensitive. OSA
// specifically (not full unrestricted Damerau-Levenshtein) because it's
// the simpler, standard practical choice for typo-tolerance and doesn't
// need the more complex bookkeeping the unrestricted variant requires to
// stay correct across repeated transpositions of the same characters —
// nothing about this app's real usage (a person's own typo in a title or
// composer name) exercises that edge case.
func DamerauLevenshtein(a, b string) int {
	a, b = strings.ToLower(a), strings.ToLower(b)
	ra, rb := []rune(a), []rune(b)
	m, n := len(ra), len(rb)

	d := make([][]int, m+1)
	for i := range d {
		d[i] = make([]int, n+1)
		d[i][0] = i
	}
	for j := 0; j <= n; j++ {
		d[0][j] = j
	}

	for i := 1; i <= m; i++ {
		for j := 1; j <= n; j++ {
			cost := 1
			if ra[i-1] == rb[j-1] {
				cost = 0
			}
			del := d[i-1][j] + 1
			ins := d[i][j-1] + 1
			sub := d[i-1][j-1] + cost
			min := del
			if ins < min {
				min = ins
			}
			if sub < min {
				min = sub
			}
			if i > 1 && j > 1 && ra[i-1] == rb[j-2] && ra[i-2] == rb[j-1] {
				if t := d[i-2][j-2] + 1; t < min {
					min = t
				}
			}
			d[i][j] = min
		}
	}
	return d[m][n]
}

// sentinel is returned when either input is empty — larger than any real
// distance a genuine query could produce, so it never satisfies a
// threshold comparison. Not int64 max: stays a plain, printable int for
// easy debugging/logging, and is still enormous relative to any real
// title/query length.
const sentinel = 1 << 30

// MinWordDistance is the smallest edit distance between query and either
// text as a whole, or any individual whitespace-split word within it —
// one function that handles both "typo somewhere in an otherwise-complete
// phrase" (query "nutkracker suite" against text "Nutcracker Suite": the
// whole-text comparison wins, distance 1) and "a single, correctly-scoped
// but misspelled word typed out of context" (query "sostenato" against
// text "Andante Sostenuto": no whole-text comparison would ever score well
// against a much longer string, but the per-word comparison against just
// "Sostenuto" does). Comparing only the whole string would miss the
// second case entirely; comparing only individual words would handle the
// first case poorly (a query spanning several words has no single "word"
// in the text it's close to). Empty text or query returns the sentinel
// (never matches), not an error — this is called from SQL per-row, where
// a blank field (no arranger set, for instance) is routine, not
// exceptional.
func MinWordDistance(text, query string) int {
	text = strings.TrimSpace(text)
	query = strings.TrimSpace(query)
	if text == "" || query == "" {
		return sentinel
	}

	best := DamerauLevenshtein(text, query)
	for _, word := range strings.Fields(text) {
		if d := DamerauLevenshtein(word, query); d < best {
			best = d
		}
	}
	return best
}

// MaxDistance is the threshold a query must fall within to count as a
// fuzzy match — roughly one edit per four characters, rounded UP rather
// than down (widened a notch 2026-08-28: a 5-character query like "boelu"
// against "Boëly" is 2 edits — the diaeresis and one more substitution —
// and floor(5/4)=1 missed it; ceiling division fixes exactly this without
// changing the threshold at all for a query whose length is already an
// exact multiple of 4, so this is a narrow correction, not a general
// loosening). Floored at 1 (even a very short query tolerates one edit)
// and capped at 3 (an unbounded threshold on a long query would start
// matching too broadly — this is a last-resort fallback tier, not the
// primary search path, so staying conservative here matters more than
// catching every possible typo).
func MaxDistance(query string) int {
	n := len([]rune(strings.TrimSpace(query)))
	d := (n + 3) / 4 // ceiling division
	if d < 1 {
		d = 1
	}
	if d > 3 {
		d = 3
	}
	return d
}
