package handlers

import "testing"

// TestDetectImslpNumber_StripsPrefix covers a real bug: detectImslpNumber
// used to return the whole regex match ("IMSLP04154"), not just the
// digits, so a freshly detected value carried a redundant "IMSLP" label
// that then doubled up wherever the app renders its own "IMSLP #{number}"
// citation prefix (buildCitation's stripImslpPrefix) — inconsistent with
// EditBookModal.tsx/EditPieceModal.tsx, which already strip on every
// manual save.
func TestDetectImslpNumber_StripsPrefix(t *testing.T) {
	got := detectImslpNumber("IMSLP04154-Chopin-Ballade.pdf")
	if got == nil || *got != "04154" {
		t.Errorf("detectImslpNumber = %v, want \"04154\" (no IMSLP prefix)", got)
	}
}

func TestDetectImslpNumber_NoMatch(t *testing.T) {
	got := detectImslpNumber("Chopin-Ballade.pdf")
	if got != nil {
		t.Errorf("detectImslpNumber = %v, want nil for a filename with no IMSLP number", *got)
	}
}

// TestDownloadFilename covers the composer/arranger/publisher priority
// fallback and the two optional segments (name, year) each being omitted
// cleanly — including their separator — rather than leaving a stray "- "
// or "()" when unset.
func TestDownloadFilename(t *testing.T) {
	tests := []struct {
		name                          string
		composer, arranger, publisher string
		title, yearWritten            string
		want                          string
	}{
		{
			name:     "composer wins over arranger and publisher",
			composer: "Robert Schumann", arranger: "Someone Else", publisher: "G. Schirmer",
			title: "Album für die Jugend", yearWritten: "1848",
			want: "Robert Schumann - Album für die Jugend (1848)",
		},
		{
			name:     "arranger used when composer is blank",
			arranger: "Louis Köhler", publisher: "G. Schirmer",
			title: "No. 9, Volksliedchen", yearWritten: "1848",
			want: "Louis Köhler - No. 9, Volksliedchen (1848)",
		},
		{
			name:      "publisher used when composer and arranger are blank",
			publisher: "Hal Leonard",
			title:     "The Real Book", yearWritten: "2004",
			want: "Hal Leonard - The Real Book (2004)",
		},
		{
			name:  "no name segment at all",
			title: "Anthology of American Folk Songs",
			want:  "Anthology of American Folk Songs",
		},
		{
			name:     "name but no year",
			composer: "J.S. Bach",
			title:    "Toccata in D Minor",
			want:     "J.S. Bach - Toccata in D Minor",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := downloadFilename(tt.composer, tt.arranger, tt.publisher, tt.title, tt.yearWritten)
			if got != sanitizeFilename(tt.want) {
				t.Errorf("downloadFilename(...) = %q, want %q", got, sanitizeFilename(tt.want))
			}
		})
	}
}

// TestDownloadFilename_PreservesCommas is a real bug found live (2026-09-02):
// unsafeFilenameChars used to exclude comma, so joinPersonNames' own
// Oxford-comma join of a multi-person composer credit ("Jimmy Page, John
// Paul Jones, and John Bonham") came out of downloadFilename with every
// comma replaced by "_" — confirmed against a real download's
// Content-Disposition header before fixing it. Asserts the literal comma
// survives, not just a sanitized-vs-sanitized comparison (which wouldn't
// have caught this — TestDownloadFilename's own "arranger used when
// composer is blank" case has a comma in its title too, but compares
// against sanitizeFilename(want), so it silently expected the comma to be
// stripped on both sides and never actually verified it was preserved).
func TestDownloadFilename_PreservesCommas(t *testing.T) {
	got := downloadFilename(
		"Jimmy Page, John Paul Jones, and John Bonham", "", "",
		"Communication Breakdown", "1969",
	)
	want := "Jimmy Page, John Paul Jones, and John Bonham - Communication Breakdown (1969)"
	if got != want {
		t.Errorf("downloadFilename(...) = %q, want %q (commas must survive, not become \"_\")", got, want)
	}
}
