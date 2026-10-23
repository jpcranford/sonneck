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

// The Sheet Viewer's double-turn guard (migration 00031): 500ms by default,
// saved like any setting, limited to its five choices, and kept when a
// request leaves it out (an older client that doesn't send it).
func TestUserSettings_TurnGuard(t *testing.T) {
	h := newTestServer(t)

	var initial repo.UserSettings
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/user-settings", nil), &initial)
	if initial.TurnGuardMs != 500 {
		t.Fatalf("turnGuardMs defaults to %d, want 500", initial.TurnGuardMs)
	}

	updated := initial
	updated.TurnGuardMs = 0
	if rec := doJSON(t, h, http.MethodPatch, "/api/user-settings", updated); rec.Code != http.StatusOK {
		t.Fatalf("PATCH 0: status %d, body %s", rec.Code, rec.Body.String())
	}
	var reread repo.UserSettings
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/user-settings", nil), &reread)
	if reread.TurnGuardMs != 0 {
		t.Errorf("after saving Off, turnGuardMs = %d, want 0", reread.TurnGuardMs)
	}

	bad := initial
	bad.TurnGuardMs = 300
	if rec := doJSON(t, h, http.MethodPatch, "/api/user-settings", bad); rec.Code != http.StatusBadRequest {
		t.Errorf("PATCH 300: status %d, want 400", rec.Code)
	}

	updated.TurnGuardMs = 750
	doJSON(t, h, http.MethodPatch, "/api/user-settings", updated)
	without := map[string]any{
		"showBooksInSidebar": initial.ShowBooksInSidebar,
		"themePreference":    "dark",
		"contentViewMode":    initial.ContentViewMode,
		"darkModeScores":     initial.DarkModeScores,
	}
	if rec := doJSON(t, h, http.MethodPatch, "/api/user-settings", without); rec.Code != http.StatusOK {
		t.Fatalf("PATCH without turnGuardMs: status %d, body %s", rec.Code, rec.Body.String())
	}
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/user-settings", nil), &reread)
	if reread.TurnGuardMs != 750 || reread.ThemePreference != "dark" {
		t.Errorf("after a save without turnGuardMs: %+v, want turnGuardMs 750 kept and theme dark", reread)
	}
}
