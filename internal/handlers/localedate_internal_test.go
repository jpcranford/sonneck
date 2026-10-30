package handlers

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestLongDateFormatter(t *testing.T) {
	day := time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		acceptLanguage, want string
	}{
		{"", "October 4, 2026"},
		{"en-US,en;q=0.9", "October 4, 2026"},
		{"en-GB,en;q=0.9", "4 October 2026"},
		{"de-DE,de;q=0.9", "4. Oktober 2026"},
		{"fr-FR", "4 octobre 2026"},
		{"es-ES", "4 de octubre de 2026"},
		{"pt-BR", "4 de outubro de 2026"}, // not "04": the browser never zero-pads
		{"ja-JP", "October 4, 2026"},      // no Japanese glyphs in the PDF's fonts
		{"x-klingon", "October 4, 2026"},  // unmatched: the US English fallback
		{"not a header;;", "October 4, 2026"},
	}
	for _, c := range cases {
		r := httptest.NewRequest("GET", "/", nil)
		if c.acceptLanguage != "" {
			r.Header.Set("Accept-Language", c.acceptLanguage)
		}
		if got := longDateFormatter(r)(day); got != c.want {
			t.Errorf("Accept-Language %q: %q, want %q", c.acceptLanguage, got, c.want)
		}
	}
}

// The table of contents' and program copy's date names the weekday, worded
// as the browser's toLocaleDateString({weekday: 'long', ...}) words it.
func TestWeekdayDateFormatter(t *testing.T) {
	day := time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		acceptLanguage, want string
	}{
		{"", "Sunday, October 4, 2026"},
		{"en-GB,en;q=0.9", "Sunday, 4 October 2026"},
		{"de-DE,de;q=0.9", "Sonntag, 4. Oktober 2026"},
		{"fr-FR", "dimanche 4 octobre 2026"},
		{"es-ES", "domingo, 4 de octubre de 2026"},
		{"pt-BR", "domingo, 4 de outubro de 2026"},
		{"ja-JP", "Sunday, October 4, 2026"}, // no Japanese glyphs in the PDF's fonts
		{"x-klingon", "Sunday, October 4, 2026"},
	}
	for _, c := range cases {
		r := httptest.NewRequest("GET", "/", nil)
		if c.acceptLanguage != "" {
			r.Header.Set("Accept-Language", c.acceptLanguage)
		}
		if got := weekdayDateFormatter(r)(day); got != c.want {
			t.Errorf("Accept-Language %q: %q, want %q", c.acceptLanguage, got, c.want)
		}
	}
	// The program copy isn't drawn by the PDF: any script is fine there.
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Accept-Language", "ru-RU")
	if got := weekdayDateFormatterText(r)(day); !strings.Contains(strings.ToLower(got), "воскресенье") {
		t.Errorf("ru-RU program copy: %q, want the Russian weekday", got)
	}
}
