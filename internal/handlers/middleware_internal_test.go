package handlers

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestRecoverMiddleware_TurnsPanicIntoJSON500 lives in package handlers
// (not handlers_test) because recoverMiddleware is unexported — this is
// the one thing worth testing in isolation rather than only through a real
// endpoint, since none of the real handlers panic on any input this suite
// can construct.
func TestRecoverMiddleware_TurnsPanicIntoJSON500(t *testing.T) {
	panicking := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("boom")
	})
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	wrapped := recoverMiddleware(panicking, logger)

	req := httptest.NewRequest(http.MethodGet, "/anything", nil)
	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
}
