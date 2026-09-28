package handlers

import (
	"net/http/httptest"
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
