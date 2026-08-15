package handlers_test

import (
	"net/http"
	"testing"
)

func TestUploadBook_DedupesOnHashMatch(t *testing.T) {
	h := newTestServer(t)

	firstID, _ := uploadBook(t, h, "book.pdf", 4)

	dir := t.TempDir()
	path := dir + "/book-again.pdf"
	writeFixturePDF(t, path, 4) // identical content to the first upload
	content := readAll(t, path)

	rec := recordRequest(h, multipartUpload(t, "/api/books", "book-again.pdf", content))
	if rec.Code != http.StatusOK {
		t.Fatalf("re-upload of identical content: status %d, want 200 (dedupe hit, not 201 create); body %s", rec.Code, rec.Body.String())
	}

	var result struct {
		Book struct {
			ID int64 `json:"id"`
		} `json:"book"`
	}
	decodeData(t, rec, &result)
	if result.Book.ID != firstID {
		t.Errorf("dedupe returned book id %d, want the original %d", result.Book.ID, firstID)
	}
}

// TestUpdateBook_ResyncsSearchForInheritingPieces locks in, via the actual
// HTTP layer, what an earlier manual smoke test verified by hand: editing
// a book's composer must update search results for every piece that
// inherits it, and leave pieces with their own override untouched.
func TestUpdateBook_ResyncsSearchForInheritingPieces(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 8)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle": "Anthology",
		"composer":  "Original Composer",
	}), nil)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"boundaries": []int{4},
		"pieces": []map[string]any{
			{"title": "Inherits"},
			{"title": "Overrides", "composer": "Own Composer"},
		},
	})
	var result struct {
		Pieces []pieceResponse `json:"pieces"`
	}
	decodeData(t, confirmRec, &result)

	assertSearchCount(t, h, "Original", 1) // only the inheriting piece

	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle": "Anthology",
		"composer":  "Renamed Composer",
	}), nil)

	assertSearchCount(t, h, "Original", 0)
	assertSearchCount(t, h, "Renamed", 1)
	assertSearchCount(t, h, "Own", 1) // the override is untouched by the book edit
}

func TestBookPageThumbnail_ReturnsPNG(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 3)

	req := httptestGet(t, "/api/books/"+itoa(bookID)+"/pages/1/thumbnail")
	rec := recordRequest(h, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("thumbnail: status %d, body %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Errorf("Content-Type = %q, want image/png", ct)
	}
	if rec.Body.Len() == 0 {
		t.Error("thumbnail response body is empty")
	}
}

func assertSearchCount(t *testing.T, h http.Handler, query string, want int) {
	t.Helper()
	rec := doJSON(t, h, http.MethodGet, "/api/pieces?query="+query, nil)
	var results []pieceResponse
	decodeData(t, rec, &results)
	if len(results) != want {
		t.Errorf("search %q returned %d result(s), want %d", query, len(results), want)
	}
}
