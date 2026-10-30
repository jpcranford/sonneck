package handlers

import (
	"net/http"
	"regexp"
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
	return longDate(r, true, false)
}

// weekdayDateFormatter is longDateFormatter with the day of the week
// ("Sunday, October 4, 2026", "dimanche 4 octobre 2026") — the Set PDF's
// table of contents.
func weekdayDateFormatter(r *http.Request) func(time.Time) string {
	return longDate(r, true, true)
}

// weekdayDateFormatterText is weekdayDateFormatter for text that isn't
// drawn by the PDF (the setlist program copy): any script is fine there.
func weekdayDateFormatterText(r *http.Request) func(time.Time) string {
	return longDate(r, false, true)
}

// zeroPaddedDay is a layout's zero-padded day ("02"), not part of a longer
// number.
var zeroPaddedDay = regexp.MustCompile(`(^|[^0-9])02([^0-9]|$)`)

func longDate(r *http.Request, pdfFonts, weekday bool) func(time.Time) string {
	var locale monday.Locale = monday.LocaleEnUS
	if prefs, _, err := language.ParseAcceptLanguage(r.Header.Get("Accept-Language")); err == nil && len(prefs) > 0 {
		if _, i, conf := mondayMatcher.Match(prefs...); conf != language.No {
			locale = mondayLocales[i]
		}
	}
	layout := monday.LongFormatsByLocale[locale]
	if layout == "" {
		locale = monday.LocaleEnUS
		layout = monday.LongFormatsByLocale[locale]
	}
	if weekday {
		// The locale's full date, which names the weekday where it has one
		// (it matches the browser's in the common European languages);
		// otherwise the weekday's name before the long date.
		if full := monday.FullFormatsByLocale[locale]; full != "" {
			layout = full
		} else {
			layout = "Monday, " + layout
		}
	}
	// Some layouts zero-pad the day ("04 de outubro"); the browser's long
	// date never does.
	layout = zeroPaddedDay.ReplaceAllString(layout, "${1}2${2}")
	fallback := "January 2, 2006"
	if weekday {
		fallback = "Monday, January 2, 2006"
	}
	return func(t time.Time) string {
		out := monday.Format(t, layout, locale)
		if pdfFonts && !setlistpdf.CanDraw(out) {
			return t.Format(fallback)
		}
		return out
	}
}
