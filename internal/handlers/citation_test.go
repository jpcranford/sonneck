package handlers_test

import (
	"net/http"
	"testing"
)

func TestCitation_OmitsBlankFieldsAndUsesBookTitle(t *testing.T) {
	h := newTestServer(t)
	bookID, _ := uploadBook(t, h, "book.pdf", 4)
	decodeData(t, doJSON(t, h, http.MethodPatch, apiBooksURL(bookID), map[string]any{
		"bookTitle": "Six Symphonies",
		"composer":  "Charles-Marie Widor",
	}), nil)

	confirmRec := doJSON(t, h, http.MethodPost, apiBooksURL(bookID)+"/confirm-import", map[string]any{
		"boundaries": []int{},
		"pieces":     []map[string]any{{"title": "Toccata", "workOpusNumber": "Op. 42"}},
	})
	var result struct {
		Pieces []pieceResponse `json:"pieces"`
	}
	decodeData(t, confirmRec, &result)
	pieceID := result.Pieces[0].ID

	rec := doJSON(t, h, http.MethodGet, apiPiecesURL(pieceID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, rec, &citation)

	want := `Charles-Marie Widor, Six Symphonies, "Toccata" (Op. 42)`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}

func TestCitation_FallsBackToPublisherIdWhenImslpNumberBlank(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)
	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	var uploaded pieceResponse
	decodeData(t, rec, &uploaded)

	decodeData(t, doJSON(t, h, http.MethodPatch, apiPiecesURL(uploaded.ID), map[string]any{
		"title":       "Solo",
		"composer":    "Someone",
		"publisherId": "PN-123",
	}), nil)

	citeRec := doJSON(t, h, http.MethodGet, apiPiecesURL(uploaded.ID)+"/citation", nil)
	var citation struct {
		Citation string `json:"citation"`
	}
	decodeData(t, citeRec, &citation)

	want := `Someone, "Solo", PN-123`
	if citation.Citation != want {
		t.Errorf("citation = %q, want %q", citation.Citation, want)
	}
}
