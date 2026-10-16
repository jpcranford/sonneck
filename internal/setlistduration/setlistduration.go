// Package setlistduration is a setlist's running time — the one Go copy of
// the rule, used by the setlist API (Setlists Library cards) and the Set
// PDF's table of contents. The frontend's copy, for Setlist Details, is
// lib/setlistEstimate.ts; keep the two in step.
//
// Each entry counts its own duration, or for one without, a typical length
// — AssumedMusicSeconds for music (a piece, or a custom entry counted as
// music), AssumedEntrySeconds for anything else (a reading, an
// announcement) — so a program with gaps still gets a usable total. When
// any length was assumed the total is shown as an estimate ("~", "Est.",
// "estimated") rather than an approximation.
package setlistduration

const (
	AssumedMusicSeconds = 150
	AssumedEntrySeconds = 90
)

// Entry is what the total needs from one program entry.
type Entry struct {
	Seconds *int
	IsMusic bool
}

// Total sums entries, assuming a typical length for each one without a
// duration. estimated reports whether any length was assumed.
func Total(entries []Entry) (seconds int, estimated bool) {
	for _, e := range entries {
		switch {
		case e.Seconds != nil:
			seconds += *e.Seconds
		case e.IsMusic:
			seconds, estimated = seconds+AssumedMusicSeconds, true
		default:
			seconds, estimated = seconds+AssumedEntrySeconds, true
		}
	}
	return seconds, estimated
}
