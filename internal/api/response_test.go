package api_test

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/jpcranford/picarda/internal/api"
)

func TestWriteData_MatchesContract(t *testing.T) {
	rec := httptest.NewRecorder()
	api.WriteData(rec, 200, map[string]string{"title": "Toccata"})

	var body map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshaling response: %v", err)
	}
	if _, ok := body["data"]; !ok {
		t.Errorf("body = %s, want a top-level \"data\" key", rec.Body.String())
	}
	if _, ok := body["error"]; ok {
		t.Errorf("body = %s, want no \"error\" key on success", rec.Body.String())
	}
}

func TestWriteError_MatchesContract(t *testing.T) {
	rec := httptest.NewRecorder()
	api.WriteError(rec, 400, api.CodeValidationError, "title is required")

	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshaling response: %v", err)
	}
	if body.Error.Code != api.CodeValidationError {
		t.Errorf("code = %q, want %q", body.Error.Code, api.CodeValidationError)
	}
	if body.Error.Message != "title is required" {
		t.Errorf("message = %q, want %q", body.Error.Message, "title is required")
	}
}
