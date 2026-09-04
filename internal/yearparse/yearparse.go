// Package yearparse extracts a sortable year out of a free-text
// yearWritten/yearPublished value — both are plain TEXT columns (design
// doc §3, "ca. 1708-1711" is real, expected data), not INTEGER, so a
// year-based sort needs to look past whatever surrounds the actual digits
// rather than requiring the field to be a bare number.
package yearparse

import (
	"regexp"
	"strconv"
)

var leadingDigits = regexp.MustCompile(`\d+`)

// LeadingYear finds the first run of digits anywhere in s and parses it as
// a year — "ca. 1685" and "1830-1832" both resolve to their first number
// (1685, 1830), matching a texty prefix or a range the same way. Mirrors
// the frontend's own workYearSortKey (PersonDetailsPage.tsx:
// `piece.yearWritten.value.match(/\d+/)`) exactly, so a piece with a
// prefixed/ranged year sorts identically whichever of the two independent
// implementations is doing the sorting — Person Details client-side, the
// backend SQL sort (registered as the leading_year scalar function,
// internal/db/db.go) everywhere else. ok is false when s has no digits at
// all (blank, or free text like "unknown").
func LeadingYear(s string) (year int, ok bool) {
	match := leadingDigits.FindString(s)
	if match == "" {
		return 0, false
	}
	n, err := strconv.Atoi(match)
	if err != nil {
		// A digit run too long to fit an int — astronomically unlikely for
		// a year field, but treated the same as "no usable year" rather
		// than erroring, consistent with every other "can't parse this as
		// a year" case here.
		return 0, false
	}
	return n, true
}
