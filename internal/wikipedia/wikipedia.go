// Package wikipedia does a live search against Wikipedia for the Edit
// Person modal's own Wikipedia autofill (composer/arranger overhaul,
// approved mockup: EditPersonModalMockup.tsx). Unlike internal/imslp's
// number-based lookup (a precise identifier resolving to exactly one
// work), a person's *name* is inherently ambiguous — this returns a real
// disambiguation list, letting the human pick, same reasoning the
// mockup's own design already settled on ("Chopin (crater)"/"Chopin
// Airport" alongside the real composer).
//
// Confirmed directly against real requests before writing any parsing
// logic (2026-08-31): the standard MediaWiki Action API supports
// combining a search with each result's own lead-paragraph extract in one
// request (generator=search + prop=extracts), so this needs exactly one
// HTTP call, not a search call plus N follow-up calls per candidate. Real
// examples confirmed live:
//   - "Yo-Yo Ma (born October 7, 1955) is an American cellist." — a
//     living person, single year only.
//   - "Alexandre Pierre-François Boëly (19 April 1785 – 27 December
//     1858) was a French composer..." — found even when the query was
//     typed without the diaeresis ("Alexandre Boely"), confirming
//     MediaWiki's own search already does this normalization; no extra
//     fuzzy-matching needed on this package's side.
//   - A query with no matches at all returns a bare {"batchcomplete":""}
//     response with no "query" key present — a normal empty result, not
//     an error.
//
// Response object keys (one per page) are NOT returned in search-rank
// order — each page carries its own "index" field for that, which must
// be sorted on explicitly (Go's map decoding drops any ordering the raw
// JSON object might otherwise have implied).
package wikipedia

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// SearchResult is one candidate person, in search-relevance order.
// BirthYear/DeathYear are parsed out of the lead sentence's own
// parenthetical when present — nil for a page with no such pattern
// (a non-biographical result, e.g. "Warsaw Chopin Airport") or a living
// person's page with no death year, both normal, not errors.
type SearchResult struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	BirthYear   *int   `json:"birthYear"`
	DeathYear   *int   `json:"deathYear"`
}

// Overridable so tests can point this at an httptest.Server instead of
// the real Wikipedia — same convention as internal/imslp's own package-
// level vars.
var searchAPIBaseURL = "https://en.wikipedia.org/w/api.php"

const requestTimeout = 10 * time.Second

var httpClient = &http.Client{Timeout: requestTimeout}

// resultLimit mirrors the approved mockup's own fixture size (a handful
// of candidates, not an exhaustive list) — Wikipedia's own search
// relevance ranking already does the real filtering work.
const resultLimit = 6

type searchAPIResponse struct {
	Query *struct {
		Pages map[string]struct {
			Title   string `json:"title"`
			Extract string `json:"extract"`
			Index   int    `json:"index"`
		} `json:"pages"`
	} `json:"query"`
}

// Search returns real Wikipedia search results for query, in relevance
// order. An empty/whitespace-only query returns an empty slice rather
// than making a request — same "nothing to search for" treatment the
// frontend's own valid-name gate already applies before this is ever
// called.
func Search(ctx context.Context, query string) ([]SearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []SearchResult{}, nil
	}

	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()

	reqURL := searchAPIBaseURL +
		"?action=query&format=json&generator=search&gsrsearch=" + url.QueryEscape(query) +
		"&gsrlimit=" + strconv.Itoa(resultLimit) +
		"&prop=extracts&exintro&explaintext&exsentences=1"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("wikipedia: building search request: %w", err)
	}
	// Wikipedia's own API etiquette asks for a descriptive User-Agent
	// identifying the calling application — see
	// https://meta.wikimedia.org/wiki/User-Agent_policy.
	req.Header.Set("User-Agent", "Sonneck/dev (https://github.com/jpcranford/sonneck)")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("wikipedia: search request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("wikipedia: search request returned %s", resp.Status)
	}

	var body searchAPIResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("wikipedia: could not decode search response: %w", err)
	}

	// A query with no matches at all comes back with no "query" key
	// present rather than an empty pages map — confirmed live, a normal
	// empty result, not an error.
	if body.Query == nil {
		return []SearchResult{}, nil
	}

	// Sort by the API's own relevance ranking (each page's own "index"
	// field), not map iteration order — Go's JSON decoding into a map
	// drops whatever ordering the raw response object might otherwise
	// have implied, and MediaWiki's own object-key order isn't guaranteed
	// to be rank order anyway.
	ranked := make([]struct {
		index  int
		result SearchResult
	}, 0, len(body.Query.Pages))
	for _, page := range body.Query.Pages {
		birthYear, deathYear := extractYears(page.Extract)
		ranked = append(ranked, struct {
			index  int
			result SearchResult
		}{
			index: page.Index,
			result: SearchResult{
				Title:       page.Title,
				Description: strings.TrimSpace(page.Extract),
				BirthYear:   birthYear,
				DeathYear:   deathYear,
			},
		})
	}
	sort.Slice(ranked, func(i, j int) bool { return ranked[i].index < ranked[j].index })

	results := make([]SearchResult, len(ranked))
	for i, r := range ranked {
		results[i] = r.result
	}
	return results, nil
}

// parenGroupPattern matches one non-nested parenthetical group — a real
// Wikipedia biographical lede almost always opens with "Name (born ...;
// <birth date> – <death date>)" or "Name (born <date>)" for a living
// person, so the *first* parenthetical containing a plausible year is
// treated as that person's own dates.
var parenGroupPattern = regexp.MustCompile(`\(([^()]*)\)`)

// yearPattern matches a bare 4-digit year (1000-2099) — deliberately not
// trying to parse full dates (month names, ordinal days, "circa"/"born"
// prefixes vary too much to be worth matching structurally) since only
// the year itself is ever stored on Person.
var yearPattern = regexp.MustCompile(`\b(1[0-9]{3}|20[0-9]{2})\b`)

// extractYears never errors — a page with no birth/death pattern at all
// (a disambiguation page, an airport, ...) is a normal result with both
// fields blank, not a failure. Returns nil, nil rather than guessing when
// the first year-bearing parenthetical has none.
func extractYears(extract string) (birthYear, deathYear *int) {
	for _, m := range parenGroupPattern.FindAllStringSubmatch(extract, -1) {
		years := yearPattern.FindAllString(m[1], -1)
		if len(years) == 0 {
			continue
		}
		if b, err := strconv.Atoi(years[0]); err == nil {
			birthYear = &b
		}
		if len(years) > 1 {
			if d, err := strconv.Atoi(years[1]); err == nil {
				deathYear = &d
			}
		}
		return birthYear, deathYear
	}
	return nil, nil
}

// Overridable so tests can point this at an httptest.Server instead of
// the real Wikipedia, same as searchAPIBaseURL above.
var summaryAPIBaseURL = "https://en.wikipedia.org/api/rest_v1/page/summary"

// ErrPageNotFound covers a title that doesn't resolve to a real Wikipedia
// page at all — shouldn't normally happen (callers pass a title Search
// itself just returned), but handled explicitly rather than left to
// surface as an opaque JSON-decode error.
var ErrPageNotFound = fmt.Errorf("wikipedia: page not found")

type summaryAPIResponse struct {
	OriginalImage *struct {
		Source string `json:"source"`
	} `json:"originalimage"`
	Thumbnail *struct {
		Source string `json:"source"`
	} `json:"thumbnail"`
}

// PageImage resolves a Wikipedia page title (as returned by Search) to
// its lead image URL — Upload Portrait's own "pick a Wikipedia result as
// your portrait source" flow (composer/arranger overhaul). Prefers the
// full-resolution originalimage over the (deliberately width-capped)
// thumbnail, since the frontend does its own crop/zoom against whatever
// image this returns. Returns "" (not an error) when the page genuinely
// has no lead image at all — confirmed live against a real such page —
// same "normal, incomplete result" posture as internal/imslp's own blank
// fields.
func PageImage(ctx context.Context, title string) (string, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return "", fmt.Errorf("wikipedia: title must not be empty")
	}

	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()

	reqURL := summaryAPIBaseURL + "/" + url.PathEscape(title)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return "", fmt.Errorf("wikipedia: building page-image request: %w", err)
	}
	req.Header.Set("User-Agent", "Sonneck/dev (https://github.com/jpcranford/sonneck)")

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("wikipedia: page-image request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return "", ErrPageNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("wikipedia: page-image request returned %s", resp.Status)
	}

	var body summaryAPIResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", fmt.Errorf("wikipedia: could not decode page-image response: %w", err)
	}

	if body.OriginalImage != nil {
		return body.OriginalImage.Source, nil
	}
	if body.Thumbnail != nil {
		return body.Thumbnail.Source, nil
	}
	return "", nil
}
