package handlers_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/jpcranford/picarda/internal/handlers"
)

// TestUnmatchedRoute_ReturnsJSONNotFound covers the gap a manual review
// flagged: a typo'd or nonexistent URL used to fall through to Go's
// default plain-text 404, breaking the {data}/{error} contract CLAUDE.md
// requires everywhere else.
func TestUnmatchedRoute_ReturnsJSONNotFound(t *testing.T) {
	h := newTestServer(t)
	rec := doJSON(t, h, http.MethodGet, "/api/this-route-does-not-exist", nil)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response body was not the expected JSON envelope: %v (body: %s)", err, rec.Body.String())
	}
	if body.Error.Code != "NOT_FOUND" {
		t.Errorf("error code = %q, want NOT_FOUND", body.Error.Code)
	}
}

// TestUploadExceedingSizeCap_Returns413 exercises the MaxBytesReader guard
// added to every upload endpoint. handlers.MaxUploadBytes is a var
// specifically so this can shrink the cap instead of needing to generate
// an actual 500MB+ body to trigger it.
func TestUploadExceedingSizeCap_Returns413(t *testing.T) {
	original := handlers.MaxUploadBytes
	handlers.MaxUploadBytes = 1024 // 1KB, for this test only
	t.Cleanup(func() { handlers.MaxUploadBytes = original })

	h := newTestServer(t)
	oversized := make([]byte, 4096) // comfortably past the 1KB cap

	rec := recordRequest(h, multipartUpload(t, "/api/pieces", "huge.pdf", oversized))
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d, want 413; body: %s", rec.Code, rec.Body.String())
	}
}
