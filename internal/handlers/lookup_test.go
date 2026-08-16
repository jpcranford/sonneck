package handlers_test

import (
	"net/http"
	"strings"
	"testing"
)

// TestListInstruments_EmptyTableReturnsEmptyArrayNotNull and its user-tags
// counterpart are regression tests for a real bug a Playwright-driven
// frontend check caught: repo.listTags used `var tags []Tag`, which
// encoding/json marshals as `null` when the table has zero rows — and the
// frontend types these endpoints' responses as plain arrays (Tag[]), not
// Tag[] | null, so a fresh install with no instruments/user tags yet
// crashed any component that called .length or .map on the response.
// instruments/user_tags are unseeded (unlike musical_keys/sheet_types), so
// a brand new database exercises exactly this empty-table path.
func TestListInstruments_EmptyTableReturnsEmptyArrayNotNull(t *testing.T) {
	h := newTestServer(t)
	rec := doJSON(t, h, http.MethodGet, "/api/instruments", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), `"data":null`) {
		t.Errorf("body = %s, want an empty array, not null", rec.Body.String())
	}
}

func TestListUserTags_EmptyTableReturnsEmptyArrayNotNull(t *testing.T) {
	h := newTestServer(t)
	rec := doJSON(t, h, http.MethodGet, "/api/tags", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), `"data":null`) {
		t.Errorf("body = %s, want an empty array, not null", rec.Body.String())
	}
}

// TestCreatePiece_UserTagsAndInstrumentsAreEmptyArraysNotNull covers the
// same bug class on a freshly uploaded Piece, which has no tags/instruments
// yet — PieceResponse.UserTags and .Instruments.Values must be `[]`, not
// `null` (see BuildPieceResponse).
func TestCreatePiece_UserTagsAndInstrumentsAreEmptyArraysNotNull(t *testing.T) {
	h := newTestServer(t)
	dir := t.TempDir()
	path := dir + "/piece.pdf"
	writeFixturePDF(t, path, 1)

	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "piece.pdf", readAll(t, path)))
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload: status %d, body %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if strings.Contains(body, `"userTags":null`) {
		t.Errorf("userTags is null, want []: %s", body)
	}
	if strings.Contains(body, `"values":null`) {
		t.Errorf("instruments.values is null, want []: %s", body)
	}
}
