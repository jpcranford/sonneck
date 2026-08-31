package handlers_test

import (
	"net/http"
	"testing"
)

// Only the local-validation/no-network paths are covered here — a real
// search/page-image lookup goes out to Wikipedia, which
// internal/wikipedia's own tests already cover against a mocked server
// (see internal/wikipedia/wikipedia_test.go), without a live network
// dependency in this package's test run.

func TestHandleWikipediaSearch_BlankQueryReturnsEmptyResultNotAnError(t *testing.T) {
	h := newTestServer(t)
	rec := doJSON(t, h, http.MethodGet, "/api/wikipedia/search", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	var results []struct{}
	decodeData(t, rec, &results)
	if len(results) != 0 {
		t.Errorf("results = %v, want empty", results)
	}
}

func TestHandleWikipediaPageImage_MissingTitle(t *testing.T) {
	h := newTestServer(t)
	rec := doJSON(t, h, http.MethodGet, "/api/wikipedia/page-image", nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}
