package handlers_test

import (
	"encoding/json"
	"net/http"
	"testing"
)

// Only the local-validation paths are covered here — a real lookup goes
// out to imslp.org, which internal/imslp's own tests already cover
// against a mocked server (see internal/imslp/imslp_test.go), without a
// live network dependency in this package's test run.
func TestHandleImslpLookup_MissingNumber(t *testing.T) {
	h := newTestServer(t)
	rec := doJSON(t, h, http.MethodGet, "/api/imslp/lookup", nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	var envelope struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if envelope.Error.Code != "VALIDATION_ERROR" {
		t.Errorf("error code = %q, want VALIDATION_ERROR", envelope.Error.Code)
	}
}

func TestHandleImslpLookup_NonDigitNumber(t *testing.T) {
	h := newTestServer(t)
	rec := doJSON(t, h, http.MethodGet, "/api/imslp/lookup?number=IMSLP04154", nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}
