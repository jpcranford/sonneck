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
//
// Birth/death years are enriched from Wikidata, not just the lead-
// paragraph regex below (added 2026-09-01, direct report that the regex
// heuristic misses real people) — confirmed live that Wikidata is
// genuinely the more complete, standardized source, not just a cleaner
// format of the same data: "Randy Hall" (a real musician the regex
// heuristic missed) has no birth *date* anywhere on his rendered
// Wikipedia page at all — his own infobox lists only a birthplace — yet
// his linked Wikidata item (Q16729582) has one (1958-04-19) on record.
// Each search result's Wikidata item id comes free in the same request
// (prop=pageprops&ppprop=wikibase_item, no extra round trip), and all of
// a page's item ids are looked up in one batched wbgetentities call
// (confirmed live: multiple "|"-joined ids in one request works) — so
// this is still exactly 2 HTTP calls per Search, not 1-per-candidate.
// Wikidata enrichment is best-effort and non-fatal: a Wikidata outage or
// a page with no linked item / no P569/P570 claims just leaves the
// extract-regex's own value in place (which itself may be nil) rather
// than failing the whole search.
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
			Title     string `json:"title"`
			Extract   string `json:"extract"`
			Index     int    `json:"index"`
			PageProps struct {
				WikibaseItem string `json:"wikibase_item"`
			} `json:"pageprops"`
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

	// exsentences=2, not 1 (changed 2026-09-01, direct report: "just one
	// often isn't enough" for a human to actually disambiguate) — a second
	// sentence routinely adds the real disambiguating context a bare first
	// sentence lacks: confirmed live, "Randy Hall" 's own second sentence
	// ("Hall helped Davis arrange The Man with the Horn...") is what
	// actually explains why he shows up in a "Miles Davis" search at all,
	// and "Miles Davis discography" 's second sentence is what confirms
	// it's the same Miles Davis rather than an unrelated list. extractYears
	// below is unaffected — a biographical lede's birth/death parenthetical
	// is always in the first sentence, so a second sentence never changes
	// what that regex finds.
	reqURL := searchAPIBaseURL +
		"?action=query&format=json&generator=search&gsrsearch=" + url.QueryEscape(query) +
		"&gsrlimit=" + strconv.Itoa(resultLimit) +
		"&prop=extracts|pageprops&ppprop=wikibase_item&exintro&explaintext&exsentences=2"
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
		qid    string
		result SearchResult
	}, 0, len(body.Query.Pages))
	for _, page := range body.Query.Pages {
		birthYear, deathYear := extractYears(page.Extract)
		ranked = append(ranked, struct {
			index  int
			qid    string
			result SearchResult
		}{
			index: page.Index,
			qid:   page.PageProps.WikibaseItem,
			result: SearchResult{
				Title:       page.Title,
				Description: strings.TrimSpace(page.Extract),
				BirthYear:   birthYear,
				DeathYear:   deathYear,
			},
		})
	}
	sort.Slice(ranked, func(i, j int) bool { return ranked[i].index < ranked[j].index })

	// Wikidata enrichment (see this package's own doc comment) — best-
	// effort: gather every result's own Wikidata item id (a page with no
	// linked item, e.g. some disambiguation/list pages, contributes
	// nothing here, which is fine — that result just keeps whatever the
	// extract regex already found, possibly nil), one batched lookup for
	// all of them, then overlay onto each matching result. A Wikidata
	// failure is swallowed, not propagated as this whole call's error —
	// the extract-based values are already a complete, usable result on
	// their own.
	qids := make([]string, 0, len(ranked))
	seen := make(map[string]bool, len(ranked))
	for _, r := range ranked {
		if r.qid != "" && !seen[r.qid] {
			qids = append(qids, r.qid)
			seen[r.qid] = true
		}
	}
	if len(qids) > 0 {
		if years, err := fetchWikidataYears(ctx, qids); err == nil {
			for i, r := range ranked {
				y, ok := years[r.qid]
				if !ok {
					continue
				}
				if y.birth != nil {
					ranked[i].result.BirthYear = y.birth
				}
				if y.death != nil {
					ranked[i].result.DeathYear = y.death
				}
			}
		}
	}

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
// the real Wikidata, same convention as searchAPIBaseURL/summaryAPIBaseURL.
var wikidataAPIBaseURL = "https://www.wikidata.org/w/api.php"

// wikidataYears is one item's own P569 (date of birth) / P570 (date of
// death) claims, already reduced to plain years — nil for a claim that's
// absent, or present but not precise enough to name a specific year (see
// parseWikidataYear).
type wikidataYears struct {
	birth *int
	death *int
}

// A real Wikidata item's `claims` object carries dozens of properties
// beyond P569/P570 — occupation, external database IDs, sitelinks-in-
// disguise, etc. — each with a wildly different `mainsnak.datavalue.value`
// shape (an item reference, a plain string, a quantity, ...), not just the
// {time, precision} shape a date claim has. A single fixed struct type
// applied uniformly to every property (the first version of this) fails
// to decode the *entire* claims map the moment any other property is
// present — confirmed live 2026-09-01 against a real response ("cannot
// unmarshal string into ... value of type struct"), not a made-up edge
// case. Claims is deliberately json.RawMessage per property instead, so
// only P569/P570 (below) ever get decoded into the date-specific shape;
// every other property's claims are never even looked at.
type wikidataEntitiesResponse struct {
	Entities map[string]struct {
		Claims map[string]json.RawMessage `json:"claims"`
	} `json:"entities"`
}

// wikidataDateClaim is P569/P570's own claim shape — decoded from the raw
// per-property JSON above, not the response's top-level struct.
type wikidataDateClaim struct {
	MainSnak struct {
		DataValue struct {
			Value struct {
				Time      string `json:"time"`
				Precision int    `json:"precision"`
			} `json:"value"`
		} `json:"datavalue"`
	} `json:"mainsnak"`
}

// fetchWikidataYears looks up P569/P570 for every id in one batched
// request (confirmed live: wbgetentities accepts multiple "|"-joined ids
// in a single call) — never called with an empty ids slice by Search
// above. Only the *first* claim per property is used (a person has at
// most one canonical birth/death date on record in the overwhelming
// majority of cases; a rare multi-claim item — e.g. disputed dates — just
// takes whichever Wikidata itself lists first, same "good enough, a human
// still confirms the pick" posture the rest of this package already has).
func fetchWikidataYears(ctx context.Context, ids []string) (map[string]wikidataYears, error) {
	reqURL := wikidataAPIBaseURL + "?action=wbgetentities&format=json&props=claims&ids=" + url.QueryEscape(strings.Join(ids, "|"))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("wikidata: building entities request: %w", err)
	}
	req.Header.Set("User-Agent", "Sonneck/dev (https://github.com/jpcranford/sonneck)")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("wikidata: entities request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("wikidata: entities request returned %s", resp.Status)
	}

	var body wikidataEntitiesResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("wikidata: could not decode entities response: %w", err)
	}

	years := make(map[string]wikidataYears, len(body.Entities))
	for qid, entity := range body.Entities {
		years[qid] = wikidataYears{
			birth: firstDateClaimYear(entity.Claims["P569"]),
			death: firstDateClaimYear(entity.Claims["P570"]),
		}
	}
	return years, nil
}

// firstDateClaimYear decodes one property's own raw claims array (P569 or
// P570, see wikidataEntitiesResponse's own comment on why this is decoded
// lazily/per-property rather than as part of the response's fixed
// struct) and returns the first claim's year, if any. raw is nil for a
// property the entity simply doesn't have (a normal, common case — most
// entities don't have every property) or a decode failure (a claim with
// no usable value at all, e.g. Wikidata's own "unknown value" snaktype) —
// both return nil here rather than erroring, same "blank is a normal
// result" posture the rest of this package already has.
func firstDateClaimYear(raw json.RawMessage) *int {
	if raw == nil {
		return nil
	}
	var claims []wikidataDateClaim
	if err := json.Unmarshal(raw, &claims); err != nil || len(claims) == 0 {
		return nil
	}
	return parseWikidataYear(claims[0].MainSnak.DataValue.Value.Time, claims[0].MainSnak.DataValue.Value.Precision)
}

// parseWikidataYear pulls the year out of a Wikidata time value —
// "+1958-04-19T00:00:00Z" (a leading sign, ISO-ish thereafter; Wikidata's
// own convention, confirmed live). precision follows Wikidata's own scale
// (11=day, 10=month, 9=year, 8=decade, ...) — anything coarser than 9
// isn't a specific year at all (a "1950s"-precision claim would otherwise
// silently masquerade as exactly 1950), so those return nil rather than
// guessing. Bounded to the same plausible 1000-2099 range yearPattern
// already enforces for the extract-regex fallback, so a parsing edge case
// can't leak a nonsensical value into Person.BirthYear/DeathYear either
// way — this also means a BCE value (a leading "-") is rejected by the
// range check alone with no separate sign handling needed, since no BCE
// year can ever land in [1000, 2099]; not a realistic case for this app's
// composer/arranger domain regardless.
func parseWikidataYear(timeStr string, precision int) *int {
	if precision < 9 || len(timeStr) < 2 || timeStr[0] != '+' {
		return nil
	}
	rest := timeStr[1:]
	dashIdx := strings.Index(rest, "-")
	if dashIdx <= 0 {
		return nil
	}
	year, err := strconv.Atoi(rest[:dashIdx])
	if err != nil {
		return nil
	}
	if year < 1000 || year > 2099 {
		return nil
	}
	return &year
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
