package handlers

import (
	"net/http"
	"strings"
	"time"

	"github.com/goodsign/monday"
	"golang.org/x/text/language"

	"github.com/jpcranford/sonneck/internal/setlistpdf"
)

// The locales goodsign/monday can write a long date in, as language tags,
// with US English first — the matcher's fallback.
var (
	mondayLocales = func() []monday.Locale {
		all := monday.ListLocales()
		out := []monday.Locale{monday.LocaleEnUS}
		for _, l := range all {
			if l != monday.LocaleEnUS {
				out = append(out, l)
			}
		}
		return out
	}()
	mondayMatcher = func() language.Matcher {
		tags := make([]language.Tag, len(mondayLocales))
		for i, l := range mondayLocales {
			tags[i] = language.Make(strings.ReplaceAll(string(l), "_", "-"))
		}
		return language.NewMatcher(tags)
	}()
)

// longDateFormatter returns a formatter for the long, written-out date
// ("October 4, 2026", "4 octobre 2026") in the requester's own locale, read
// from Accept-Language — the header a browser sends with every request,
// the same preference its own toLocaleDateString follows in the app. A
// locale whose dates the PDF's fonts can't draw (a non-Latin script) falls
// back to US English.
func longDateFormatter(r *http.Request) func(time.Time) string {
	return longDate(r, true)
}

// longDateFormatterText is longDateFormatter for text that isn't drawn by
// the PDF (the setlist program copy): any script is fine there.
func longDateFormatterText(r *http.Request) func(time.Time) string {
	return longDate(r, false)
}

func longDate(r *http.Request, pdfFonts bool) func(time.Time) string {
	var locale monday.Locale = monday.LocaleEnUS
	if prefs, _, err := language.ParseAcceptLanguage(r.Header.Get("Accept-Language")); err == nil && len(prefs) > 0 {
		if _, i, conf := mondayMatcher.Match(prefs...); conf != language.No {
			locale = mondayLocales[i]
		}
	}
	layout := monday.LongFormatsByLocale[locale]
	if layout == "" {
		layout = monday.LongFormatsByLocale[monday.LocaleEnUS]
	}
	// Some layouts zero-pad the day ("04 de outubro"); the browser's long
	// date never does.
	if rest, ok := strings.CutPrefix(layout, "02"); ok {
		layout = "2" + rest
	}
	return func(t time.Time) string {
		out := monday.Format(t, layout, locale)
		if pdfFonts && !setlistpdf.CanDraw(out) {
			return t.Format("January 2, 2006")
		}
		return out
	}
}
