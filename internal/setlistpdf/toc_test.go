package setlistpdf

import (
	"strings"
	"testing"
)

func TestShortKey(t *testing.T) {
	cases := map[string]string{
		"E Major":     "E",
		"A Minor":     "Am",
		"E♭ Major":    "E♭",
		"C♯ Minor":    "C♯m",
		"b♭  MINOR":   "B♭m", // case and spacing ignored
		"f major":     "F",
		"Dorian on D": "Dorian on D", // not "<note> major/minor": as stored
		"Major":       "Major",
	}
	for in, want := range cases {
		if got := shortKey(in); got != want {
			t.Errorf("shortKey(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestFormatApproximately(t *testing.T) {
	cases := map[int]string{
		10:   "approximately 1 minute",
		850:  "approximately 14 minutes",
		3600: "approximately 1 hour",
		5265: "approximately 1 hour 28 minutes",
		7230: "approximately 2 hours 1 minute",
	}
	for secs, want := range cases {
		if got := formatApproximately(secs); got != want {
			t.Errorf("formatApproximately(%d) = %q, want %q", secs, got, want)
		}
	}
}

func TestFormatDurationHours(t *testing.T) {
	if got := formatDuration(165); got != "2:45" {
		t.Errorf("formatDuration(165) = %q", got)
	}
	if got := formatDuration(5265); got != "1:27:45" {
		t.Errorf("formatDuration(5265) = %q, want 1:27:45", got)
	}
}

func TestTocParenthetical(t *testing.T) {
	role := "Anthem"
	secs := 320
	runs := tocParenthetical(Entry{IsPiece: true, PieceRole: &role, PieceKeys: []string{"E Major", "A Minor", "C Major"}, PieceDuration: &secs})
	var text strings.Builder
	chevrons := 0
	for _, r := range runs {
		text.WriteString(r.text)
		if r.text == "›" {
			chevrons++
			if r.color != colorFainter || r.marginL == 0 || r.marginR == 0 {
				t.Errorf("chevron run = %+v, want the fainter ink with space each side", r)
			}
		}
	}
	if got := text.String(); got != "(Anthem • E›Am›C • 5:20)" {
		t.Errorf("parenthetical = %q", got)
	}
	if chevrons != 2 {
		t.Errorf("chevrons = %d, want 2", chevrons)
	}
	if tocParenthetical(Entry{CustomName: "Bidding Prayer"}) != nil {
		t.Error("an entry with no role, keys or duration should have no parenthetical")
	}
}

// lessonsAndCarols is the long program the TOC design was settled against
// (SetlistProgramPageMockup.tsx's TOC_PROGRAMS), for checking the measured
// pagination against what the mockup measures in the browser.
func lessonsAndCarols() []Entry {
	type e struct {
		title       string
		piece       bool
		keys        []string
		role        string
		secs, pages int
	}
	src := []e{
		{"Organ Voluntary", false, nil, "Prelude", 300, 1}, {"Once in Royal David’s City", true, []string{"F Major"}, "Processional", 270, 2},
		{"Bidding Prayer", false, nil, "", 0, 1}, {"First Lesson", false, nil, "Genesis 3", 120, 1},
		{"Adam Lay Ybounden", true, []string{"C♯ Minor"}, "", 100, 1}, {"Second Lesson", false, nil, "Genesis 22", 150, 1},
		{"The Truth from Above", true, []string{"D Minor"}, "", 190, 2}, {"Third Lesson", false, nil, "Isaiah 9", 120, 1},
		{"In the Bleak Midwinter (Cranham), with Descant for Upper Voices", true, []string{"F Major", "G Major"}, "", 285, 3},
		{"Es ist ein Ros entsprungen", true, []string{"F Major"}, "", 170, 1}, {"Fourth Lesson", false, nil, "Isaiah 11", 135, 1},
		{"Lo, How a Rose E’er Blooming", true, []string{"F Major"}, "", 180, 2}, {"Gabriel’s Message", true, []string{"G Minor"}, "", 160, 1},
		{"Fifth Lesson", false, nil, "Luke 1", 150, 1}, {"Ave Maria", true, []string{"F Major"}, "", 270, 3},
		{"Magnificat", true, []string{"E Major", "A Minor", "C Major"}, "Anthem", 320, 4}, {"Sixth Lesson", false, nil, "Luke 2", 120, 1},
		{"Infant Holy, Infant Lowly", true, []string{"F Major"}, "", 130, 1}, {"A Spotless Rose", true, []string{"E♭ Major"}, "", 175, 2},
		{"Seventh Lesson", false, nil, "Luke 2", 120, 1}, {"Shepherd’s Pipe Carol", true, []string{"E♭ Major"}, "", 200, 4},
		{"While Shepherds Watched Their Flocks", true, []string{"D Major"}, "", 180, 1}, {"Eighth Lesson", false, nil, "Matthew 2", 150, 1},
		{"Coventry Carol", true, []string{"G Minor"}, "", 165, 1}, {"The Three Kings", true, []string{"C Major"}, "", 210, 2},
		{"Ninth Lesson", false, nil, "John 1", 180, 1}, {"Hark! The Herald Angels Sing", true, []string{"F Major", "G Major"}, "Recessional", 220, 2},
		{"O Come, All Ye Faithful (Adeste Fideles), with Last-Verse Reharmonization", true, []string{"G Major", "A Major"}, "", 255, 3},
		{"Collect and Blessing", false, nil, "Closing", 0, 1}, {"Organ Voluntary", false, nil, "Postlude", 240, 1}, {"Reception", false, nil, "", 0, 1},
	}
	var out []Entry
	num := 0
	for _, s := range src {
		s := s
		var role *string
		if s.role != "" {
			role = &s.role
		}
		var secs *int
		if s.secs > 0 {
			secs = &s.secs
		}
		if s.piece {
			num++
			n := num
			out = append(out, Entry{IsPiece: true, DisplayNumber: &n, PieceTitle: s.title, PieceKeys: s.keys, PieceRole: role, PieceDuration: secs, PiecePageCount: s.pages})
		} else {
			out = append(out, Entry{CustomName: s.title, CustomRole: role, CustomDurationSeconds: secs})
		}
	}
	return out
}

func TestTOCPaginationMatchesTheMockup(t *testing.T) {
	for _, tc := range []struct {
		shape     Shape
		firstPage int // rows on page 1, as the mockup measures them in the browser
	}{{ShapeLetter, 18}, {ShapeA4, 20}} {
		in := Input{Setlist: Setlist{Name: "A Festival of Nine Lessons and Carols", GigDate: "December 13, 2026"}, Entries: lessonsAndCarols(), Shape: tc.shape}
		_, plan := paginate(in)
		if len(plan.pages) != 2 {
			t.Fatalf("%s: %d TOC pages, want 2", tc.shape, len(plan.pages))
		}
		if got := len(plan.pages[0]); got != tc.firstPage {
			t.Errorf("%s: %d rows on the first page, want %d", tc.shape, got, tc.firstPage)
		}
		wrapped := 0
		for _, r := range plan.rows {
			if len(r.lines) > 1 {
				wrapped++
			}
		}
		if wrapped != 2 {
			t.Errorf("%s: %d wrapped rows, want 2 (the two long carol titles)", tc.shape, wrapped)
		}
	}
}

// Every page fills until the next row would cross the bottom margin, and
// no row ever crosses it.
func TestTOCPagesStopAtTheBottomMargin(t *testing.T) {
	entries := append(lessonsAndCarols(), lessonsAndCarols()...)
	for _, shape := range []Shape{ShapeLetter, ShapeA4} {
		in := Input{Setlist: Setlist{Name: "Carols"}, Entries: entries, Shape: shape}
		_, plan := paginate(in)
		size := pageSize[shape]
		bottom := size.Ht - tocMargin
		for pi, rows := range plan.pages {
			y := tocMargin + tocLabelBlock + tocRowsTopGap
			if pi == 0 {
				y = tocFirstRowsTop(plan)
			}
			for _, i := range rows {
				y += plan.rows[i].height
				if y > bottom+1e-9 {
					t.Errorf("%s page %d: row %d ends at %.1f, past the %.1f margin", shape, pi+1, i, y, bottom)
				}
				y += tocRowGap
			}
			if pi < len(plan.pages)-1 {
				next := plan.pages[pi+1][0]
				if y+plan.rows[next].height <= bottom {
					t.Errorf("%s page %d: row %d would still have fit", shape, pi+1, next)
				}
			}
		}
	}
}

// A setlist name long enough to wrap takes rows away from the first page.
func TestLongSetlistNameLeavesFewerRows(t *testing.T) {
	short := Input{Setlist: Setlist{Name: "Carols"}, Entries: lessonsAndCarols()}
	long := Input{Setlist: Setlist{Name: "A Festival of Nine Lessons and Carols, With Readings, Anthems and Congregational Hymns for the Season of Advent"}, Entries: lessonsAndCarols()}
	_, sp := paginate(short)
	_, lp := paginate(long)
	if len(lp.nameLines) < 3 {
		t.Fatalf("long name wrapped to %d lines, want 3+", len(lp.nameLines))
	}
	if len(lp.pages[0]) >= len(sp.pages[0]) {
		t.Errorf("first page rows: long name %d, short name %d — the long name should leave fewer", len(lp.pages[0]), len(sp.pages[0]))
	}
}
