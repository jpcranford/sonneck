package handlers_test

import (
	"net/http"
	"testing"

	"github.com/jpcranford/sonneck/internal/repo"
)

// Dark Mode Scores (migration 00030) starts off and survives a save — the
// PATCH is a full replace, so a field the handler forgot to read or write
// would silently fall back to false.
func TestUserSettings_DarkModeScoresRoundTrip(t *testing.T) {
	h := newTestServer(t)

	var initial repo.UserSettings
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/user-settings", nil), &initial)
	if initial.DarkModeScores {
		t.Fatal("darkModeScores should default to false")
	}

	updated := initial
	updated.DarkModeScores = true
	rec := doJSON(t, h, http.MethodPatch, "/api/user-settings", updated)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH status = %d, body %s", rec.Code, rec.Body.String())
	}

	var reread repo.UserSettings
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/user-settings", nil), &reread)
	if reread != updated {
		t.Fatalf("after saving, got %+v, want %+v", reread, updated)
	}
}
