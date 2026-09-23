package handlers_test

import (
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/jpcranford/sonneck/internal/config"
	"github.com/jpcranford/sonneck/internal/db"
	"github.com/jpcranford/sonneck/internal/handlers"
	"github.com/jpcranford/sonneck/internal/webui"
)

func newVersionTestServer(t *testing.T, buildSHA, buildDate, buildVersion string) http.Handler {
	t.Helper()
	dataDir := t.TempDir()
	conn, err := db.Open(filepath.Join(dataDir, "sonneck.sqlite"))
	if err != nil {
		t.Fatalf("opening test database: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	cfg := &config.Config{DataDir: dataDir, LogLevelVar: &slog.LevelVar{}}
	cfg.SetCopyrightRegion("en-US")
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	frontend, err := webui.FS()
	if err != nil {
		t.Fatalf("loading embedded frontend: %v", err)
	}
	return handlers.New(conn, cfg, logger, frontend, nil, buildSHA, buildDate, buildVersion, "native", nil, nil)
}

type versionBody struct {
	RunningSHA        string  `json:"runningSHA"`
	RunningDate       string  `json:"runningDate"`
	RunningFromSource bool    `json:"runningFromSource"`
	MatchedRelease    *string `json:"matchedRelease"`
}

// A release build's own injected version is its identity immediately, on
// the very first request — no GitHub lookup (which, being unauthenticated,
// can also be rate-limited away entirely).
func TestVersion_InjectedBuildVersionShownImmediately(t *testing.T) {
	h := newVersionTestServer(t, "e9f3654da253c3d275216238141acf98d8a29dfd", "2026-09-20", "0.7-beta")
	var got versionBody
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/admin/version", nil), &got)
	if got.MatchedRelease == nil || *got.MatchedRelease != "0.7-beta" {
		t.Fatalf("matchedRelease = %v, want 0.7-beta", got.MatchedRelease)
	}
	if got.RunningFromSource {
		t.Errorf("runningFromSource = true, want false for a release build")
	}
}

// A source build (no injected SHA) still reports "running from source" and
// no release identity.
func TestVersion_DevBuildHasNoRelease(t *testing.T) {
	h := newVersionTestServer(t, "dev", "unknown", "")
	var got versionBody
	decodeData(t, doJSON(t, h, http.MethodGet, "/api/admin/version", nil), &got)
	if !got.RunningFromSource || got.MatchedRelease != nil {
		t.Errorf("got %+v, want runningFromSource=true and no matchedRelease", got)
	}
}
