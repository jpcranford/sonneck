package wikipedia

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestExtractYears covers the locked heuristic (this file's own top
// comment): the first non-nested parenthetical group containing at least
// one 4-digit year is treated as the subject's own birth/death dates.
// Every case here is a real extract confirmed live against en.wikipedia.org
// (2026-08-31), not invented shapes.
func TestExtractYears(t *testing.T) {
	tests := []struct {
		name      string
		extract   string
		wantBirth *int
		wantDeath *int
	}{
		{
			name:      "full birth-death range with a 'born X;' prefix",
			extract:   `Frédéric François Chopin (born Fryderyk Franciszek Chopin; 1 March 1810 – 17 October 1849) was a Polish composer and virtuoso pianist.`,
			wantBirth: intPtr(1810),
			wantDeath: intPtr(1849),
		},
		{
			name:      "plain year range, no prefix",
			extract:   `Alexandre Pierre-François Boëly (19 April 1785 – 27 December 1858) was a French composer, organist, pianist, and violist.`,
			wantBirth: intPtr(1785),
			wantDeath: intPtr(1858),
		},
		{
			name:      "living person, birth year only",
			extract:   `Yo-Yo Ma (born October 7, 1955) is an American cellist.`,
			wantBirth: intPtr(1955),
			wantDeath: nil,
		},
		{
			name:      "no parenthetical at all",
			extract:   `Discography for the cellist Yo-Yo Ma.`,
			wantBirth: nil,
			wantDeath: nil,
		},
		{
			name:      "a parenthetical with no year in it is skipped in favor of a later one that has one",
			extract:   `Some Thing (not a year) is a concept invented in (1990).`,
			wantBirth: intPtr(1990),
			wantDeath: nil,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			birth, death := extractYears(tc.extract)
			if !intPtrEqual(birth, tc.wantBirth) {
				t.Errorf("birthYear = %v, want %v", deref(birth), deref(tc.wantBirth))
			}
			if !intPtrEqual(death, tc.wantDeath) {
				t.Errorf("deathYear = %v, want %v", deref(death), deref(tc.wantDeath))
			}
		})
	}
}

func intPtr(n int) *int { return &n }
func deref(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}
func intPtrEqual(a, b *int) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// TestSearch_OrdersByRelevanceRank confirms the sort-by-"index" fix is
// real and load-bearing — Go's JSON decoding into the response's
// pages map drops any ordering the raw object might have implied, so a
// fixture response with the pages object written in a different order
// than their own "index" fields is exactly the case that would silently
// return scrambled results without it.
func TestSearch_OrdersByRelevanceRank(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api.php", func(w http.ResponseWriter, r *http.Request) {
		// Deliberately out of index order in the object itself.
		w.Write([]byte(`{
			"query": {
				"pages": {
					"3": {"pageid": 3, "title": "Third", "extract": "c", "index": 3},
					"1": {"pageid": 1, "title": "First", "extract": "a", "index": 1},
					"2": {"pageid": 2, "title": "Second", "extract": "b", "index": 2}
				}
			}
		}`))
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	orig := searchAPIBaseURL
	searchAPIBaseURL = server.URL + "/api.php"
	defer func() { searchAPIBaseURL = orig }()

	results, err := Search(context.Background(), "test")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(results) != 3 {
		t.Fatalf("got %d results, want 3", len(results))
	}
	got := []string{results[0].Title, results[1].Title, results[2].Title}
	want := []string{"First", "Second", "Third"}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("results[%d].Title = %q, want %q (full order: %v)", i, got[i], want[i], got)
		}
	}
}

// TestSearch_NoMatches confirms the real observed "no query key present"
// shape (not an empty pages map) is treated as a normal empty result.
func TestSearch_NoMatches(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api.php", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"batchcomplete":""}`))
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	orig := searchAPIBaseURL
	searchAPIBaseURL = server.URL + "/api.php"
	defer func() { searchAPIBaseURL = orig }()

	results, err := Search(context.Background(), "zzznonexistent")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(results) != 0 {
		t.Errorf("results = %v, want empty", results)
	}
}

func TestSearch_BlankQueryMakesNoRequest(t *testing.T) {
	requested := false
	mux := http.NewServeMux()
	mux.HandleFunc("/api.php", func(w http.ResponseWriter, r *http.Request) {
		requested = true
		w.Write([]byte(`{"batchcomplete":""}`))
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	orig := searchAPIBaseURL
	searchAPIBaseURL = server.URL + "/api.php"
	defer func() { searchAPIBaseURL = orig }()

	results, err := Search(context.Background(), "   ")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(results) != 0 {
		t.Errorf("results = %v, want empty", results)
	}
	if requested {
		t.Error("Search made an HTTP request for a blank query, want none")
	}
}

// TestParseWikidataYear covers the real time-value shape confirmed live
// against Wikidata (2026-09-01) — "+1958-04-19T00:00:00Z" for Randy Hall's
// own P569 claim — plus the precision/sign/range edge cases.
func TestParseWikidataYear(t *testing.T) {
	tests := []struct {
		name      string
		time      string
		precision int
		want      *int
	}{
		{"real CE date, day precision", "+1958-04-19T00:00:00Z", 11, intPtr(1958)},
		{"year-only precision still usable", "+1810-00-00T00:00:00Z", 9, intPtr(1810)},
		{"decade precision is too coarse to name a year", "+1810-00-00T00:00:00Z", 8, nil},
		{"century precision is too coarse", "+1800-00-00T00:00:00Z", 7, nil},
		{"BCE date rejected by the plausible-range check, not specially parsed", "-0239-00-00T00:00:00Z", 9, nil},
		{"out of plausible range is rejected", "+0500-00-00T00:00:00Z", 9, nil},
		{"malformed time string", "not-a-time", 11, nil},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := parseWikidataYear(tc.time, tc.precision)
			if !intPtrEqual(got, tc.want) {
				t.Errorf("parseWikidataYear(%q, %d) = %v, want %v", tc.time, tc.precision, deref(got), deref(tc.want))
			}
		})
	}
}

// TestSearch_WikidataFillsInWhatTheExtractRegexMisses is the real bug this
// enrichment fixes: "Randy Hall" (internal/wikipedia's own doc comment) —
// a page whose lead extract has no parenthetical birth date at all (so
// extractYears alone finds nothing), but whose linked Wikidata item does.
func TestSearch_WikidataFillsInWhatTheExtractRegexMisses(t *testing.T) {
	searchMux := http.NewServeMux()
	searchMux.HandleFunc("/api.php", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{
			"query": {
				"pages": {
					"1": {
						"pageid": 1, "title": "Randy Hall", "index": 1,
						"extract": "Randy Hall is an American singer, guitarist, and record producer.",
						"pageprops": {"wikibase_item": "Q16729582"}
					}
				}
			}
		}`))
	})
	searchServer := httptest.NewServer(searchMux)
	defer searchServer.Close()

	wikidataMux := http.NewServeMux()
	wikidataMux.HandleFunc("/w/api.php", func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("ids"); got != "Q16729582" {
			t.Errorf("wikidata request ids = %q, want %q", got, "Q16729582")
		}
		w.Write([]byte(`{
			"entities": {
				"Q16729582": {
					"claims": {
						"P569": [{"mainsnak": {"datavalue": {"value": {"time": "+1958-04-19T00:00:00Z", "precision": 11}}}}]
					}
				}
			}
		}`))
	})
	wikidataServer := httptest.NewServer(wikidataMux)
	defer wikidataServer.Close()

	origSearch, origWikidata := searchAPIBaseURL, wikidataAPIBaseURL
	searchAPIBaseURL = searchServer.URL + "/api.php"
	wikidataAPIBaseURL = wikidataServer.URL + "/w/api.php"
	defer func() { searchAPIBaseURL, wikidataAPIBaseURL = origSearch, origWikidata }()

	results, err := Search(context.Background(), "Randy Hall")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("got %d results, want 1", len(results))
	}
	if !intPtrEqual(results[0].BirthYear, intPtr(1958)) {
		t.Errorf("BirthYear = %v, want 1958 (from Wikidata, not the lead extract which has no date at all)", deref(results[0].BirthYear))
	}
	if results[0].DeathYear != nil {
		t.Errorf("DeathYear = %v, want nil (no P570 claim in this fixture)", deref(results[0].DeathYear))
	}
}

// TestFetchWikidataYears_IgnoresOtherClaimTypesWithDifferentValueShapes is
// the real bug caught live 2026-09-01 building this feature: a real
// Wikidata item's claims object carries dozens of properties beyond
// P569/P570 (occupation, external IDs, ...), each with a completely
// different mainsnak.datavalue.value shape (an item reference here, a
// plain string there — not just {time, precision}). The first version of
// wikidataEntitiesResponse applied one fixed struct to every property
// uniformly, which failed to decode the *entire* claims map — not just
// the offending property — the moment any non-date claim was present,
// silently losing P569/P570 for every entity in the batch (a real,
// production Wikidata response always has other claims; this isn't a
// contrived edge case). This fixture reproduces that shape directly:
// P569 (a real date claim) alongside P21 "sex or gender" (a real item-
// reference value, an object with "entity-type"/"numeric-id"/"id" fields,
// not a time).
func TestFetchWikidataYears_IgnoresOtherClaimTypesWithDifferentValueShapes(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/w/api.php", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{
			"entities": {
				"Q16729582": {
					"claims": {
						"P21": [{"mainsnak": {"datavalue": {"value": {"entity-type": "item", "numeric-id": 6581097, "id": "Q6581097"}, "type": "wikibase-entityid"}, "datatype": "wikibase-item"}}],
						"P569": [{"mainsnak": {"datavalue": {"value": {"time": "+1958-04-19T00:00:00Z", "precision": 11}, "type": "time"}, "datatype": "time"}}]
					}
				}
			}
		}`))
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	orig := wikidataAPIBaseURL
	wikidataAPIBaseURL = server.URL + "/w/api.php"
	defer func() { wikidataAPIBaseURL = orig }()

	years, err := fetchWikidataYears(context.Background(), []string{"Q16729582"})
	if err != nil {
		t.Fatalf("fetchWikidataYears: %v, want no error despite the P21 claim's different value shape", err)
	}
	if !intPtrEqual(years["Q16729582"].birth, intPtr(1958)) {
		t.Errorf("birth = %v, want 1958 (P569 must decode correctly even with an unrelated P21 claim present)", deref(years["Q16729582"].birth))
	}
}

// TestSearch_WikidataFailureFallsBackToExtractRegex confirms a Wikidata
// outage doesn't sink the whole search — the extract-regex's own value
// (real for this fixture) survives untouched.
func TestSearch_WikidataFailureFallsBackToExtractRegex(t *testing.T) {
	searchMux := http.NewServeMux()
	searchMux.HandleFunc("/api.php", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{
			"query": {
				"pages": {
					"1": {
						"pageid": 1, "title": "Yo-Yo Ma", "index": 1,
						"extract": "Yo-Yo Ma (born October 7, 1955) is an American cellist.",
						"pageprops": {"wikibase_item": "Q7295"}
					}
				}
			}
		}`))
	})
	searchServer := httptest.NewServer(searchMux)
	defer searchServer.Close()

	wikidataMux := http.NewServeMux()
	wikidataMux.HandleFunc("/w/api.php", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})
	wikidataServer := httptest.NewServer(wikidataMux)
	defer wikidataServer.Close()

	origSearch, origWikidata := searchAPIBaseURL, wikidataAPIBaseURL
	searchAPIBaseURL = searchServer.URL + "/api.php"
	wikidataAPIBaseURL = wikidataServer.URL + "/w/api.php"
	defer func() { searchAPIBaseURL, wikidataAPIBaseURL = origSearch, origWikidata }()

	results, err := Search(context.Background(), "Yo-Yo Ma")
	if err != nil {
		t.Fatalf("Search: %v, want no error even though Wikidata is down", err)
	}
	if len(results) != 1 {
		t.Fatalf("got %d results, want 1", len(results))
	}
	if !intPtrEqual(results[0].BirthYear, intPtr(1955)) {
		t.Errorf("BirthYear = %v, want 1955 (the extract-regex fallback, since Wikidata failed)", deref(results[0].BirthYear))
	}
}

// TestSearch_NoWikibaseItemSkipsWikidataEntirely confirms a page with no
// linked Wikidata item at all (empty pageprops, a real shape for some
// pages) makes no Wikidata request and simply keeps the extract-regex's
// own result.
func TestSearch_NoWikibaseItemSkipsWikidataEntirely(t *testing.T) {
	searchMux := http.NewServeMux()
	searchMux.HandleFunc("/api.php", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{
			"query": {
				"pages": {
					"1": {"pageid": 1, "title": "Some Discography", "index": 1, "extract": "A list."}
				}
			}
		}`))
	})
	searchServer := httptest.NewServer(searchMux)
	defer searchServer.Close()

	wikidataRequested := false
	wikidataMux := http.NewServeMux()
	wikidataMux.HandleFunc("/w/api.php", func(w http.ResponseWriter, r *http.Request) {
		wikidataRequested = true
		w.Write([]byte(`{"entities":{}}`))
	})
	wikidataServer := httptest.NewServer(wikidataMux)
	defer wikidataServer.Close()

	origSearch, origWikidata := searchAPIBaseURL, wikidataAPIBaseURL
	searchAPIBaseURL = searchServer.URL + "/api.php"
	wikidataAPIBaseURL = wikidataServer.URL + "/w/api.php"
	defer func() { searchAPIBaseURL, wikidataAPIBaseURL = origSearch, origWikidata }()

	results, err := Search(context.Background(), "Some Discography")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(results) != 1 || results[0].BirthYear != nil {
		t.Errorf("results = %+v, want one result with nil BirthYear", results)
	}
	if wikidataRequested {
		t.Error("Search made a Wikidata request for a page with no linked wikibase_item, want none")
	}
}

func TestPageImage_PrefersOriginalImageOverThumbnail(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{
			"thumbnail": {"source": "https://upload.wikimedia.org/thumb.jpg"},
			"originalimage": {"source": "https://upload.wikimedia.org/original.jpg"}
		}`))
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	orig := summaryAPIBaseURL
	summaryAPIBaseURL = server.URL
	defer func() { summaryAPIBaseURL = orig }()

	url, err := PageImage(context.Background(), "Some Person")
	if err != nil {
		t.Fatalf("PageImage: %v", err)
	}
	if url != "https://upload.wikimedia.org/original.jpg" {
		t.Errorf("url = %q, want the originalimage source", url)
	}
}

func TestPageImage_NoImageOnPageReturnsBlankNotError(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"title": "Three-hand effect"}`))
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	orig := summaryAPIBaseURL
	summaryAPIBaseURL = server.URL
	defer func() { summaryAPIBaseURL = orig }()

	url, err := PageImage(context.Background(), "Three-hand effect")
	if err != nil {
		t.Fatalf("PageImage: %v", err)
	}
	if url != "" {
		t.Errorf("url = %q, want empty", url)
	}
}

func TestPageImage_NotFound(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte(`{"status":404,"type":"Internal error"}`))
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	orig := summaryAPIBaseURL
	summaryAPIBaseURL = server.URL
	defer func() { summaryAPIBaseURL = orig }()

	_, err := PageImage(context.Background(), "Nonexistent Page")
	if err != ErrPageNotFound {
		t.Errorf("err = %v, want ErrPageNotFound", err)
	}
}
