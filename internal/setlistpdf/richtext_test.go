package setlistpdf

import "testing"

func TestParseRichText_ShortcodesAndEmphasis(t *testing.T) {
	// The exact real-world string a real setlist's description used
	// (setlist id 5, "Test Setlist I" in the dev library) that first
	// surfaced this as un-rendered literal markdown/shortcode syntax —
	// note :pp: sits *inside* the italic span, not after it.
	paras := parseRichText("This is to test the system. Beware the :ff: before the *subito :pp:*.", true)
	if len(paras) != 1 {
		t.Fatalf("got %d paragraphs, want 1", len(paras))
	}
	words := paras[0].words

	var got []richWord
	got = append(got, words...)

	find := func(text string) richWord {
		for _, w := range got {
			if w.text == text {
				return w
			}
		}
		t.Fatalf("word %q not found among %+v", text, got)
		return richWord{}
	}

	ff := find(string(rune(0xE52F)))
	if !ff.symbol {
		t.Errorf(":ff: did not resolve to a symbol word")
	}
	pp := find(string(rune(0xE52B)))
	if !pp.symbol {
		t.Errorf(":pp: (nested inside the italic span) did not resolve to a symbol word")
	}
	subito := find("subito")
	// ambientItalic=true, so *subito :pp:* should invert to roman
	// (italic=false), matching index.css's real
	// `.italic em { font-style: normal }` rule.
	if subito.italic {
		t.Errorf("*subito ...* under an italic ambient should render roman, got italic=true")
	}
	if subito.bold {
		t.Errorf("*subito ...* should not be bold")
	}
	if pp.italic || pp.bold {
		t.Errorf("a symbol word should never carry bold/italic, got %+v", pp)
	}

	plain := find("Beware")
	if !plain.italic {
		t.Errorf("plain text under an italic ambient should stay italic, got italic=false")
	}
}

func TestParseRichText_BoldUnderItalicAmbientStaysItalic(t *testing.T) {
	paras := parseRichText("plain **bold** text", true)
	words := paras[0].words
	for _, w := range words {
		if w.text == "bold" {
			if !w.bold || !w.italic {
				t.Errorf("bold word under italic ambient = %+v, want bold=true italic=true", w)
			}
		}
	}
}

func TestParseRichText_EmphasisWithoutAmbientItalicRendersItalic(t *testing.T) {
	paras := parseRichText("plain *emph* text", false)
	words := paras[0].words
	for _, w := range words {
		if w.text == "emph" {
			if !w.italic || w.bold {
				t.Errorf("emphasis word without ambient italic = %+v, want italic=true bold=false", w)
			}
		}
	}
}

func TestParseRichText_ForcedLineBreak(t *testing.T) {
	paras := parseRichText("line one\nline two", false)
	words := paras[0].words
	var lineTwoFirst richWord
	// "line" appears twice, so walk in order and take the word right
	// after the first "one" — that's the second line's own first word.
	for i, w := range words {
		if w.text == "one" && i+1 < len(words) {
			lineTwoFirst = words[i+1]
			break
		}
	}
	if !lineTwoFirst.breakBefore {
		t.Errorf("first word after a single \\n should carry breakBefore=true, got %+v", lineTwoFirst)
	}
}

func TestParseRichText_BlankLineStartsNewParagraph(t *testing.T) {
	paras := parseRichText("first paragraph\n\nsecond paragraph", false)
	if len(paras) != 2 {
		t.Fatalf("got %d paragraphs, want 2", len(paras))
	}
}

func TestParseRichText_UnknownShortcodeLeftLiteral(t *testing.T) {
	paras := parseRichText("not a :realshortcode: here", false)
	var found bool
	for _, w := range paras[0].words {
		if w.symbol {
			t.Errorf("unrecognized shortcode should not resolve to a symbol word, got %+v", w)
		}
		if w.text == ":realshortcode:" {
			found = true
		}
	}
	if !found {
		t.Errorf("unrecognized shortcode text should be left as literal plain text")
	}
}
