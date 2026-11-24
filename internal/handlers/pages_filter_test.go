package handlers_test

import (
	"fmt"
	"net/http"
	"testing"
)

// TestPagesFilter covers the Library's Pages filter: minPages/maxPages on
// shown pages (skipped pages left out), either end alone, bad values, and
// the facet's counts by shown pages, the top one counting "12 or more".
func TestPagesFilter(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	upload := func(name string, pages int) int64 {
		path := dir + "/" + name
		writeFixturePDF(t, path, pages)
		var piece struct {
			ID int64 `json:"id"`
		}
		decodeData(t, recordRequest(h, multipartUpload(t, "/api/pieces", name, readAll(t, path))), &piece)
		return piece.ID
	}
	one := upload("one.pdf", 1)
	three := upload("three.pdf", 3)
	// Six pages in the file, two skipped: shows four.
	six := upload("six.pdf", 6)
	if rec := doJSON(t, h, http.MethodPut, apiPiecesURL(six)+"/skipped-pages", map[string]any{"skipStart": 1, "skipEnd": 1}); rec.Code != http.StatusOK {
		t.Fatalf("skip pages: status %d, body %s", rec.Code, rec.Body.String())
	}
	fourteen := upload("fourteen.pdf", 14)

	ids := func(query string) map[int64]bool {
		var results []pieceResponse
		decodeData(t, doJSON(t, h, http.MethodGet, "/api/pieces?"+query, nil), &results)
		got := map[int64]bool{}
		for _, r := range results {
			got[r.ID] = true
		}
		return got
	}
	for query, want := range map[string][]int64{
		"minPages=3&maxPages=4": {three, six},
		"minPages=5":            {fourteen},
		"maxPages=1":            {one},
		"maxPages=5":            {one, three, six}, // six shows 4
		"minPages=12":           {fourteen},
	} {
		got := ids(query)
		if len(got) != len(want) {
			t.Errorf("%s: got %v, want %v", query, got, want)
			continue
		}
		for _, id := range want {
			if !got[id] {
				t.Errorf("%s: got %v, want %v", query, got, want)
			}
		}
	}
	var count struct {
		Total int `json:"total"`
	}
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/pieces/count?minPages=3&maxPages=4", nil), &count)
	if count.Total != 2 {
		t.Errorf("count minPages=3&maxPages=4 = %d, want 2", count.Total)
	}
	for _, bad := range []string{"minPages=0", "maxPages=x", "minPages=-2"} {
		if rec := doJSON(t, h, http.MethodGet, "/api/pieces?"+bad, nil); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", bad, rec.Code)
		}
	}

	// Counts by shown pages ignore the range itself, but not other filters.
	var facets struct {
		PageCounts []struct {
			Pages int `json:"pages"`
			Count int `json:"count"`
		} `json:"pageCounts"`
	}
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/pieces/facets?minPages=3&maxPages=4", nil), &facets)
	got := fmt.Sprint(facets.PageCounts)
	if want := "[{1 1} {3 1} {4 1} {12 1}]"; got != want {
		t.Errorf("pageCounts = %s, want %s", got, want)
	}
}
