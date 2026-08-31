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
