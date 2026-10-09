package handlers

import "testing"

func intPtr(n int) *int { return &n }

// The program copy (design D) for the shape every real setlist has: a role,
// an unnumbered custom entry between pieces, a piece with no opus and an
// arranger credit, plus Markdown-special characters that must be escaped.
func TestBuildSetlistProgram(t *testing.T) {
	entries := []programEntry{
		{number: intPtr(1), title: "Allegro", opus: "Op. 105 VI.", credit: "Charles Villiers Stanford",
			citation: `Charles Villiers Stanford, "Allegro", 1908.`},
		{number: intPtr(2), role: "Prelude", title: "Toccata in G Major", opus: "BuxWV 165", credit: "Dieterich Buxtehude",
			citation: `Dieterich Buxtehude, "Toccata in G Major" (BuxWV 165), 1903.`},
		{custom: true, title: "Audience work"},
		{number: intPtr(3), title: "Angels *We* Have Heard", credit: "Traditional, arr. Janet Linker",
			citation: `Traditional, "Angels *We* Have Heard", arr. Janet Linker, 1994.`},
	}
	md, text := buildSetlistProgram("Test Setlist I", "October 31, 2026", entries)

	wantMD := `# Test Setlist I

October 31, 2026

1. **Allegro** (Op. 105 VI.) — Charles Villiers Stanford
2. *Prelude:* **Toccata in G Major** (BuxWV 165) — Dieterich Buxtehude

*Audience work*

3. **Angels \*We\* Have Heard** — Traditional, arr. Janet Linker

## Sources

1. Charles Villiers Stanford, "Allegro", 1908.
2. Dieterich Buxtehude, "Toccata in G Major" (BuxWV 165), 1903.
3. Traditional, "Angels \*We\* Have Heard", arr. Janet Linker, 1994.
`
	wantText := `TEST SETLIST I
October 31, 2026

1. Allegro (Op. 105 VI.) — Charles Villiers Stanford
2. Prelude: Toccata in G Major (BuxWV 165) — Dieterich Buxtehude
   Audience work
3. Angels *We* Have Heard — Traditional, arr. Janet Linker

SOURCES
1. Charles Villiers Stanford, "Allegro", 1908.
2. Dieterich Buxtehude, "Toccata in G Major" (BuxWV 165), 1903.
3. Traditional, "Angels *We* Have Heard", arr. Janet Linker, 1994.
`
	if md != wantMD {
		t.Errorf("markdown:\n%s\nwant:\n%s", md, wantMD)
	}
	if text != wantText {
		t.Errorf("text:\n%s\nwant:\n%s", text, wantText)
	}
}

// No gig date and no pieces: no date line and no Sources section.
func TestBuildSetlistProgram_NoDateNoPieces(t *testing.T) {
	md, text := buildSetlistProgram("Ideas", "", []programEntry{{custom: true, title: "Welcome"}})
	if want := "# Ideas\n\n*Welcome*\n"; md != want {
		t.Errorf("markdown = %q, want %q", md, want)
	}
	if want := "IDEAS\n\n   Welcome\n"; text != want {
		t.Errorf("text = %q, want %q", text, want)
	}
}

func TestProgramCredit(t *testing.T) {
	for _, c := range []struct {
		composers, arrangers []string
		want                 string
	}{
		{[]string{"J.S. Bach"}, nil, "J.S. Bach"},
		{[]string{"Traditional"}, []string{"Janet Linker"}, "Traditional, arr. Janet Linker"},
		{nil, []string{"Janet Linker"}, "arr. Janet Linker"},
		{nil, nil, ""},
	} {
		if got := programCredit(c.composers, c.arrangers); got != c.want {
			t.Errorf("programCredit(%v, %v) = %q, want %q", c.composers, c.arrangers, got, c.want)
		}
	}
}
