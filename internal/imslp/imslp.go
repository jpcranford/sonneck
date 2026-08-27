// Package imslp does a live lookup against IMSLP (imslp.org) for a work's
// composer, opus/catalogue number, and composition year, given the site's
// own per-file "IMSLP#####" identifier — design doc §13's "IMSLP live
// autofill," deferred there specifically because "the API/parsing
// integration" needed real research first. That research (2026-08-27):
//
//   - The number itself isn't part of IMSLP's own wikitext/MediaWiki
//     content model at all — every file on a real work page's wikitext is
//     keyed by a "PMLPxxxxx-filename.pdf" string, never an "IMSLP#####"
//     one (confirmed directly: pulled the real wikitext for Schumann's
//     Album für die Jugend, Op.68 and grepped every file entry). The
//     number is injected into *rendered* HTML by a separate extension.
//   - The human-facing page meant to resolve a bare number
//     (Special:ImagefromIndex/#####) sits behind a JS-based redirect a
//     server-side HTTP client can't follow: a real request against it
//     returns a 302 to "/friendlyredirect.html#/wiki/Special:...", with
//     the actual target only in the URL fragment — browsers never send
//     that back to the server, so this genuinely needs a JS-executing
//     client (a headless browser) to resolve at all.
//   - Special:ReverseLookup — already used by this app's own "open on
//     IMSLP" links (see the frontend's imslpUrl helpers) — resolves the
//     same number with a *real*, followable redirect instead: a GET to
//     index.php?title=Special:ReverseLookup&action=submit&indexsearch=<n>
//     302s straight to "/wiki/<Work Page Title>#IMSLP<n>". Confirmed
//     against a real number (101781 -> "Povera Maria! (Tosti, Francesco
//     Paolo)"). A number IMSLP doesn't recognize (e.g. a made-up one)
//     responds 200 with a "No Results" page instead of a redirect.
//   - The resolved work page title is then fed to the standard, stable
//     MediaWiki Action API (api.php?action=parse&prop=wikitext) — no
//     scraping of rendered /wiki/ pages needed at all, since that's a
//     completely different code path from the JS-redirect-gated one above
//     (api.php itself is not JS-gated, confirmed by real requests
//     returning normal JSON with no redirect involved).
//
// Publisher/Publisher ID *are* extracted too (added after a first version
// of this package shipped without them, on a real correction: the
// resolved redirect doesn't just identify the work, its "#IMSLP<number>"
// fragment identifies the exact *file/edition* the user's own number
// refers to — a single work can have many scanned editions with
// different publishers, but there's no ambiguity to resolve here at all,
// since the number already picks one out). That per-file publisher data
// only exists in *rendered* HTML, though, not wikitext — its wikitext
// form is one of dozens of different citation templates ({{P|...}},
// {{SchumannComplete|...}}, {{MssAu|...}}, ...) that only resolve to
// plain text through the render pipeline. Confirmed directly against
// real files: the extension IMSLP renders file listings with wraps each
// one in `<div id="IMSLP<number>" ...>`, immediately followed by a
// `<table class="we_edition_info">` containing a "Publisher Info." row
// whose <td> holds something like `Milan: <a ...>Ricordi</a>, 1897.
// Plate 49939.` — the first link's text is the publisher name, "Plate
// <digits>" is this app's own "Publisher ID" concept (already described
// that way in EditPieceModal's own field tooltip: "Publisher serial or
// engraving plate number"). A file with no real publisher on record
// (e.g. an unpublished manuscript) simply has no link and no plate
// number in that <td> — parseEditionInfo returns blank for both rather
// than guessing.
package imslp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"golang.org/x/net/html"
)

// ErrNotFound covers both "IMSLP has no work with that number" (a 200
// "No Results" response from Special:ReverseLookup) and any other
// response shape this package doesn't know how to resolve to a page.
var ErrNotFound = errors.New("imslp: no work found for that number")

// ErrInvalidNumber is returned before any request is made — number must
// already be the bare digits (the app's own stored-value-is-prefix-free
// convention, same as detectImslpNumber/stripImslpPrefix elsewhere).
var ErrInvalidNumber = errors.New("imslp: number must be non-empty digits only")

var digitsOnly = regexp.MustCompile(`^\d+$`)

// Overridable so tests can point these at an httptest.Server instead of
// the real imslp.org — there's no dependency-injection convention
// elsewhere in this codebase to follow, and package-level vars are the
// simplest thing that works for a single external service like this.
var (
	reverseLookupBaseURL = "https://imslp.org/index.php"
	actionAPIBaseURL     = "https://imslp.org/api.php"
)

const requestTimeout = 10 * time.Second

// httpClient never follows redirects automatically — resolveWorkTitle
// needs to read the Location header itself rather than have it silently
// followed, and the actionAPIBaseURL call is a plain GET that was never
// expected to redirect in the first place, so disabling redirect-
// following costs it nothing.
var httpClient = &http.Client{
	Timeout: requestTimeout,
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// WorkInfo is the subset of a work's IMSLP data this app can reliably
// extract — see this file's own top comment for why Publisher isn't
// among them. Any field can come back empty if that particular work page
// doesn't have it filled in (real IMSLP data is community-maintained and
// often incomplete) — that's a normal result, not an error.
type WorkInfo struct {
	Composer       string `json:"composer"`
	WorkOpusNumber string `json:"workOpusNumber"`
	YearWritten    string `json:"yearWritten"`
	Publisher      string `json:"publisher"`
	PublisherID    string `json:"publisherId"`
}

// Lookup resolves a bare IMSLP file number to its containing work page
// and returns whatever of Composer/WorkOpusNumber/YearWritten that page's
// wikitext (and its own title, for Composer) actually has on record, plus
// Publisher/PublisherID for the *specific* file/edition that number
// refers to (from the rendered page — see this file's own top comment
// for why that pair alone needs rendered HTML rather than wikitext).
func Lookup(ctx context.Context, number string) (*WorkInfo, error) {
	number = strings.TrimSpace(number)
	if number == "" || !digitsOnly.MatchString(number) {
		return nil, ErrInvalidNumber
	}

	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()

	title, err := resolveWorkTitle(ctx, number)
	if err != nil {
		return nil, err
	}

	wikitext, err := fetchWikitext(ctx, title)
	if err != nil {
		return nil, err
	}
	info := parseWorkInfo(title, wikitext)

	// Best-effort, deliberately not fatal — a real failure fetching or
	// parsing the rendered page (IMSLP hiccup, a template shape this
	// parser doesn't recognize) shouldn't sink an otherwise-successful
	// lookup that already has composer/opus/year from the wikitext call
	// above. Publisher/PublisherID just stay blank in that case, same as
	// a real file that genuinely has neither on record.
	if renderedHTML, err := fetchRenderedHTML(ctx, title); err == nil {
		info.Publisher, info.PublisherID = parseEditionInfo(renderedHTML, number)
	}

	return info, nil
}

func resolveWorkTitle(ctx context.Context, number string) (string, error) {
	reqURL := reverseLookupBaseURL + "?title=Special:ReverseLookup&action=submit&indexsearch=" + url.QueryEscape(number)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return "", fmt.Errorf("imslp: building reverse-lookup request: %w", err)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("imslp: reverse-lookup request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusFound {
		// A number IMSLP doesn't recognize responds 200 with a "No
		// Results" page rather than a redirect — anything other than a
		// clean 302 is treated the same way, not found.
		return "", ErrNotFound
	}

	location := resp.Header.Get("Location")
	if location == "" {
		return "", ErrNotFound
	}
	return parseWorkTitleFromLocation(location)
}

// parseWorkTitleFromLocation turns a redirect target like
// "//imslp.org/wiki/Povera_Maria!_(Tosti,_Francesco_Paolo)#IMSLP101781"
// into the plain work page title "Povera Maria! (Tosti, Francesco
// Paolo)" — strips the scheme-relative host and "/wiki/" prefix, drops
// the "#IMSLP<number>" fragment IMSLP appends purely to scroll a browser
// to the right file (irrelevant here, the page itself is the whole
// point), URL-decodes percent escapes, and turns MediaWiki's
// underscore-for-space page-title convention back into real spaces.
func parseWorkTitleFromLocation(location string) (string, error) {
	// Fragment stripped *before* looking for "/wiki/" — a location like
	// "//imslp.org/friendlyredirect.html#/wiki/Special:ImagefromIndex/04154"
	// (the JS-redirect-gated shape this package deliberately doesn't
	// follow) has "/wiki/" sitting inside its fragment, not its real
	// path; searching the whole string would wrongly treat that as a
	// resolved title instead of rejecting it.
	if hash := strings.IndexByte(location, '#'); hash != -1 {
		location = location[:hash]
	}
	const marker = "/wiki/"
	idx := strings.Index(location, marker)
	if idx == -1 {
		return "", fmt.Errorf("imslp: unexpected redirect location %q", location)
	}
	path := location[idx+len(marker):]
	decoded, err := url.PathUnescape(path)
	if err != nil {
		return "", fmt.Errorf("imslp: could not decode redirect location %q: %w", location, err)
	}
	return strings.ReplaceAll(decoded, "_", " "), nil
}

type actionAPIResponse struct {
	Parse *struct {
		Wikitext struct {
			Content string `json:"*"`
		} `json:"wikitext"`
	} `json:"parse"`
	Error *struct {
		Info string `json:"info"`
	} `json:"error"`
}

func fetchWikitext(ctx context.Context, title string) (string, error) {
	reqURL := actionAPIBaseURL + "?action=parse&format=json&prop=wikitext&page=" + url.QueryEscape(title)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return "", fmt.Errorf("imslp: building wikitext request: %w", err)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("imslp: wikitext request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("imslp: wikitext request returned %s", resp.Status)
	}

	var body actionAPIResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", fmt.Errorf("imslp: could not decode wikitext response: %w", err)
	}
	if body.Error != nil {
		return "", fmt.Errorf("imslp: %s", body.Error.Info)
	}
	if body.Parse == nil || body.Parse.Wikitext.Content == "" {
		return "", ErrNotFound
	}
	return body.Parse.Wikitext.Content, nil
}

type actionAPIRenderedResponse struct {
	Parse *struct {
		Text struct {
			Content string `json:"*"`
		} `json:"text"`
	} `json:"parse"`
	Error *struct {
		Info string `json:"info"`
	} `json:"error"`
}

// fetchRenderedHTML is fetchWikitext's counterpart for the one thing this
// package needs from *rendered* output rather than wikitext — see this
// file's own top comment for why Publisher/PublisherID specifically need
// this. Still api.php, not a /wiki/ page load — no JS-redirect gate here
// either, same as fetchWikitext.
func fetchRenderedHTML(ctx context.Context, title string) (string, error) {
	reqURL := actionAPIBaseURL + "?action=parse&format=json&prop=text&page=" + url.QueryEscape(title)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return "", fmt.Errorf("imslp: building rendered-html request: %w", err)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("imslp: rendered-html request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("imslp: rendered-html request returned %s", resp.Status)
	}

	var body actionAPIRenderedResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", fmt.Errorf("imslp: could not decode rendered-html response: %w", err)
	}
	if body.Error != nil {
		return "", fmt.Errorf("imslp: %s", body.Error.Info)
	}
	if body.Parse == nil {
		return "", ErrNotFound
	}
	return body.Parse.Text.Content, nil
}

// platePattern pulls the plate number out of a Publisher Info cell like
// "Milan: Ricordi, 1897. Plate 49939." — every real plate number seen so
// far is purely numeric; a rare non-numeric one is left uncaptured
// rather than guessed at.
var platePattern = regexp.MustCompile(`(?i)plate\.?\s*(\d+)`)

// parseEditionInfo finds the one file entry the caller's IMSLP number
// actually refers to (marked by IMSLP's own file-listing extension as
// `<div id="IMSLP<number>" ...>`) and reads its Publisher Info cell —
// first link's text as the publisher name, platePattern above for the
// plate/"Publisher ID" number. Both come back blank, not an error, for a
// file with no real publisher on record (e.g. an unpublished manuscript
// — confirmed for real: Schumann's own holograph-manuscript file has a
// Publisher Info row reading just "Holograph manuscript, 1848." with no
// link and no plate number at all).
func parseEditionInfo(htmlContent, number string) (publisher, publisherID string) {
	marker := `id="IMSLP` + number + `"`
	idx := strings.Index(htmlContent, marker)
	if idx == -1 {
		return "", ""
	}
	segment := htmlContent[idx:]

	// Bounded to this one file's own block, not the whole rest of the
	// page — otherwise a later file entry's Publisher Info would be
	// mistaken for this one's once this file's own row is missing.
	// tagEnd skips past the *current* div's own closing ">" first (its
	// opening tag carries both the id and a "we_file_first"-style class
	// together on one element), so the boundary search below doesn't
	// immediately match that same tag's own class attribute.
	if tagEnd := strings.IndexByte(segment, '>'); tagEnd != -1 {
		if next := strings.Index(segment[tagEnd+1:], `we_file_first`); next != -1 {
			segment = segment[:tagEnd+1+next]
		}
	}

	z := html.NewTokenizer(strings.NewReader(segment))
	var (
		inTH, thIsPublisherInfo bool
		thText                  strings.Builder
		inTD                    bool
		tdText                  strings.Builder
		inA                     bool
		linkText                strings.Builder
	)

	for {
		switch z.Next() {
		case html.ErrorToken:
			return "", ""
		case html.StartTagToken, html.SelfClosingTagToken:
			name, _ := z.TagName()
			switch string(name) {
			case "th":
				inTH = true
				thText.Reset()
			case "td":
				if thIsPublisherInfo {
					inTD = true
					tdText.Reset()
					linkText.Reset()
				}
			case "a":
				if inTD && linkText.Len() == 0 {
					inA = true
				}
			}
		case html.TextToken:
			text := string(z.Text())
			if inTH {
				thText.WriteString(text)
			}
			if inTD {
				tdText.WriteString(text)
				if inA {
					linkText.WriteString(text)
				}
			}
		case html.EndTagToken:
			name, _ := z.TagName()
			switch string(name) {
			case "th":
				inTH = false
				label := strings.ToLower(thText.String())
				thIsPublisherInfo = strings.Contains(label, "publish") && strings.Contains(label, "info")
			case "a":
				inA = false
			case "td":
				if inTD {
					publisher = strings.TrimSpace(linkText.String())
					if m := platePattern.FindStringSubmatch(tdText.String()); m != nil {
						publisherID = m[1]
					}
					return publisher, publisherID
				}
			}
		}
	}
}

// titleComposerPattern matches a work page title's trailing "(Last,
// First)" — IMSLP's standard page-title convention (e.g. "Album für die
// Jugend, Op.68 (Schumann, Robert)"). Anchored at the end of the string
// and excludes nested parens, so a title that happens to contain an
// unrelated parenthetical earlier on doesn't get mistaken for this.
var titleComposerPattern = regexp.MustCompile(`\(([^()]+),\s*([^()]+)\)\s*$`)

// The three wikitext fields this app can use, each "|Key=value" on its
// own line inside the "*****WORK INFO*****" template block. (?m) so ^/$
// match per line, not just start/end of the whole wikitext blob. \s*
// only appears *before* "=" (safe — that's just spacing around the key
// name) — a trailing \s* after "=" was a real bug caught by this
// package's own tests: \s matches \n too, so it silently swallowed the
// line break on a blank field and bled into capturing the *next* line's
// entire "|Key=value" text instead of stopping at end-of-line. Leading/
// trailing space in the captured value itself is trimmed by the caller
// (strings.TrimSpace) instead.
var (
	opusPattern                 = regexp.MustCompile(`(?m)^\|Opus/Catalogue Number\s*=(.*)$`)
	compositionYearPattern      = regexp.MustCompile(`(?m)^\|Year/Date of Composition\s*=(.*)$`)
	firstPublicationYearPattern = regexp.MustCompile(`(?m)^\|Year of First Publication\s*=(.*)$`)
)

// parseWorkInfo never errors — a real work page missing one of these
// fields (common; IMSLP is community-maintained and often incomplete) is
// a normal result, not a failure. Composer comes from the page title, not
// the wikitext, since work pages have no "|Composer=" field of their own
// (confirmed directly — composer is only ever encoded in the title's own
// "(Last, First)" suffix).
func parseWorkInfo(title, wikitext string) *WorkInfo {
	info := &WorkInfo{}

	if m := titleComposerPattern.FindStringSubmatch(title); m != nil {
		last, first := strings.TrimSpace(m[1]), strings.TrimSpace(m[2])
		switch {
		case first != "" && last != "":
			info.Composer = first + " " + last
		default:
			info.Composer = first + last
		}
	}

	if m := opusPattern.FindStringSubmatch(wikitext); m != nil {
		info.WorkOpusNumber = strings.TrimSpace(m[1])
	}

	if m := compositionYearPattern.FindStringSubmatch(wikitext); m != nil {
		info.YearWritten = strings.TrimSpace(m[1])
	}
	if info.YearWritten == "" {
		if m := firstPublicationYearPattern.FindStringSubmatch(wikitext); m != nil {
			info.YearWritten = strings.TrimSpace(m[1])
		}
	}

	return info
}
