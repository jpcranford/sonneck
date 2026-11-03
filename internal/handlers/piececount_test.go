package handlers_test

import (
	"net/http"
	"net/url"
	"testing"
)

// GET /api/pieces/count agrees with the list GET /api/pieces returns for
// the same query and filters, including a search only a fallback tier
// (substring) matches, and counts every page, not just the first.
func TestCountPieces_MatchesTheList(t *testing.T) {
	h := newTestServer(t)
	createTestPiece(t, h, map[string]any{"title": "Moonlight Sonata", "favorite": true})
	createTestPiece(t, h, map[string]any{"title": "Moon River"})
	createTestPiece(t, h, map[string]any{"title": "Sunrise"})

	for params, want := range map[string]int{
		"":                         3,
		"favorite=true":            1,
		"query=moon":               2,
		"query=oonl":               1, // no word starts with it: only the substring tier matches
		"query=moon&favorite=true": 1,
		"limit=1":                  3, // a page of one still counts all three
	} {
		v, _ := url.ParseQuery(params)
		var count struct {
			Total int `json:"total"`
		}
		rec := doJSON(t, h, http.MethodGet, "/api/pieces/count?"+v.Encode(), nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("count %q: status %d, body %s", params, rec.Code, rec.Body.String())
		}
		decodeData(t, rec, &count)
		if count.Total != want {
			t.Errorf("%q: count %d, want %d", params, count.Total, want)
		}

		v.Set("limit", "200")
		var list []pieceResponse
		decodeData(t, doJSON(t, h, http.MethodGet, "/api/pieces?"+v.Encode(), nil), &list)
		if count.Total != len(list) {
			t.Errorf("%q: count %d, list has %d", params, count.Total, len(list))
		}
	}
}

// GET /api/books/count agrees with GET /api/books for the same search, and
// counts past a page.
func TestCountBooks_MatchesTheList(t *testing.T) {
	h := newTestServer(t)
	for _, title := range []string{"Album for the Young", "Album Leaves", "Songs Without Words"} {
		rec := doJSON(t, h, http.MethodPost, "/api/books/manual", map[string]any{"bookTitle": title, "composers": []string{"Someone"}})
		if rec.Code != http.StatusCreated && rec.Code != http.StatusOK {
			t.Fatalf("create %q: status %d, body %s", title, rec.Code, rec.Body.String())
		}
	}
	for params, want := range map[string]int{"": 3, "query=album": 2, "query=nothing": 0, "limit=1": 3} {
		v, _ := url.ParseQuery(params)
		var count struct {
			Total int `json:"total"`
		}
		rec := doJSON(t, h, http.MethodGet, "/api/books/count?"+v.Encode(), nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("count %q: status %d, body %s", params, rec.Code, rec.Body.String())
		}
		decodeData(t, rec, &count)
		if count.Total != want {
			t.Errorf("%q: count %d, want %d", params, count.Total, want)
		}
		v.Set("limit", "200")
		var list []map[string]any
		decodeData(t, doJSON(t, h, http.MethodGet, "/api/books?"+v.Encode(), nil), &list)
		if count.Total != len(list) {
			t.Errorf("%q: count %d, list has %d", params, count.Total, len(list))
		}
	}
}
