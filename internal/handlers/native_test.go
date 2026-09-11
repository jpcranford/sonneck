package handlers_test

import (
	"database/sql"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/jpcranford/sonneck/internal/config"
	"github.com/jpcranford/sonneck/internal/db"
	"github.com/jpcranford/sonneck/internal/handlers"
	"github.com/jpcranford/sonneck/internal/nativeconfig"
	"github.com/jpcranford/sonneck/internal/repo"
	"github.com/jpcranford/sonneck/internal/webui"
)

// newNativeTestServer mirrors newTestServerWithDataDir but with
// buildTarget "native" and a real, disk-backed NativeOptions — the only
// way requireNativeAccess (native.go) ever lets these endpoints past the
// initial 404 check. authMethod lets a test represent either state
// authMiddleware's own preFirstLaunchOnlyPaths exception cares about:
// "none" resolves to the implicit id=1 admin with zero session overhead
// (the same posture a real fresh native install has by default), while
// "singlepass" with no cookie attached represents a locked-down install a
// caller genuinely isn't authenticated against.
func newNativeTestServer(t *testing.T, authMethod string, native *handlers.NativeOptions) (http.Handler, *sql.DB) {
	t.Helper()
	dataDir := t.TempDir()

	conn, err := db.Open(filepath.Join(dataDir, "sonneck.sqlite"))
	if err != nil {
		t.Fatalf("opening test database: %v", err)
	}
	t.Cleanup(func() { conn.Close() })

	cfg := &config.Config{DataDir: dataDir, Port: "26163", LogLevelVar: &slog.LevelVar{}, AuthMethod: authMethod}
	cfg.SetCopyrightRegion("en-US")
	cfg.SetBackupCron("0 3 * * *")
	cfg.SetBackupRetentionDays(30)
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))

	frontend, err := webui.FS()
	if err != nil {
		t.Fatalf("loading embedded frontend: %v", err)
	}

	return handlers.New(conn, cfg, logger, frontend, nil, "", "", "native", nil, native), conn
}

func fakeNativeOptions(t *testing.T) (*handlers.NativeOptions, *bool) {
	t.Helper()
	settingsPath := filepath.Join(t.TempDir(), "Sonneck", "config.json")
	restarted := false
	return &handlers.NativeOptions{
		SettingsPath:          settingsPath,
		AppliedShareOnNetwork: false,
		ChooseFolder: func(currentPath string) (string, error) {
			return "/Users/jamie/Documents/Sheet Music", nil
		},
		RequestRestart: func() error {
			restarted = true
			return nil
		},
	}, &restarted
}

func TestNativeEndpoints_404OnDocker(t *testing.T) {
	h := newTestServer(t) // buildTarget "docker" by construction
	for _, req := range []struct {
		method, path string
	}{
		{http.MethodGet, "/api/native/settings"},
		{http.MethodPatch, "/api/native/settings"},
		{http.MethodPost, "/api/native/choose-folder"},
		{http.MethodPost, "/api/native/restart"},
	} {
		rec := doJSON(t, h, req.method, req.path, nil)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s %s on docker: status = %d, want 404", req.method, req.path, rec.Code)
		}
	}
}

func TestNativeEndpoints_ReachablePreFirstLaunch_EvenUnderSinglepass(t *testing.T) {
	native, _ := fakeNativeOptions(t)
	// singlepass with no session attached anywhere in this test — if these
	// endpoints required a real session the way every other non-public
	// route does, every call below would 401. They must not, since the
	// First Launch flow's own folder step has to work before any session
	// can possibly exist.
	h, _ := newNativeTestServer(t, "singlepass", native)

	rec := doJSON(t, h, http.MethodGet, "/api/native/settings", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET settings pre-first-launch: status = %d, want 200, body %s", rec.Code, rec.Body.String())
	}

	rec = doJSON(t, h, http.MethodPost, "/api/native/choose-folder", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("choose-folder pre-first-launch: status = %d, want 200, body %s", rec.Code, rec.Body.String())
	}

	rec = doJSON(t, h, http.MethodPatch, "/api/native/settings", map[string]string{"libraryPath": "/Users/jamie/Music/Sonneck Library"})
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH settings pre-first-launch: status = %d, want 200, body %s", rec.Code, rec.Body.String())
	}

	rec = doJSON(t, h, http.MethodPost, "/api/native/restart", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("restart pre-first-launch: status = %d, want 200, body %s", rec.Code, rec.Body.String())
	}
}

func TestNativeEndpoints_AdminGatedAfterFirstLaunch(t *testing.T) {
	native, _ := fakeNativeOptions(t)
	h, conn := newNativeTestServer(t, "singlepass", native)
	hash := "$2a$10$2b2cU8CPhOTaGrs1HRQuAueS7JTT5ZHsHSzYiFPm1leZck7Mc8T4W" // bcrypt("password")
	if err := repo.CompleteFirstLaunch(t.Context(), conn, "singlepass", &hash); err != nil {
		t.Fatalf("CompleteFirstLaunch: %v", err)
	}

	// No session cookie at all now that setup is done: rejected, same as
	// any other admin-gated endpoint.
	rec := doJSON(t, h, http.MethodGet, "/api/native/settings", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("GET settings post-first-launch, no session: status = %d, want 401, body %s", rec.Code, rec.Body.String())
	}
}

func TestNativeEndpoints_AdminGatedAfterFirstLaunch_NoneMode_ImplicitAdminWorks(t *testing.T) {
	native, _ := fakeNativeOptions(t)
	h, conn := newNativeTestServer(t, "none", native)
	if err := repo.CompleteFirstLaunch(t.Context(), conn, "none", nil); err != nil {
		t.Fatalf("CompleteFirstLaunch: %v", err)
	}

	// `none` mode resolves every request to the implicit, always-full-admin
	// id=1 with zero session overhead — this should just work, no cookie
	// needed, same as every other admin endpoint in this mode.
	rec := doJSON(t, h, http.MethodGet, "/api/native/settings", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET settings post-first-launch, none mode: status = %d, want 200, body %s", rec.Code, rec.Body.String())
	}
}

func TestUpdateNativeSettings_PersistsShareOnNetworkImmediately(t *testing.T) {
	native, _ := fakeNativeOptions(t)
	h, conn := newNativeTestServer(t, "none", native)
	if err := repo.CompleteFirstLaunch(t.Context(), conn, "none", nil); err != nil {
		t.Fatalf("CompleteFirstLaunch: %v", err)
	}

	rec := doJSON(t, h, http.MethodPatch, "/api/native/settings", map[string]bool{"shareOnNetwork": true})
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH: status = %d, want 200, body %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		ShareOnNetwork        bool `json:"shareOnNetwork"`
		AppliedShareOnNetwork bool `json:"appliedShareOnNetwork"`
	}
	decodeData(t, rec, &resp)
	if !resp.ShareOnNetwork {
		t.Error("shareOnNetwork should be true — just persisted")
	}
	if resp.AppliedShareOnNetwork {
		t.Error("appliedShareOnNetwork should still be false — nothing restarts this process in a test, so it must stay honest about what's actually live")
	}

	// Persisted for real, on disk — a fresh Load sees it too, not just this
	// one response.
	onDisk, err := nativeconfig.Load(native.SettingsPath)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !onDisk.ShareOnNetwork {
		t.Error("ShareOnNetwork wasn't actually persisted to disk")
	}
}

func TestUpdateNativeSettings_LibraryPathWritesPendingNotApplied(t *testing.T) {
	native, _ := fakeNativeOptions(t)
	h, conn := newNativeTestServer(t, "none", native)
	if err := repo.CompleteFirstLaunch(t.Context(), conn, "none", nil); err != nil {
		t.Fatalf("CompleteFirstLaunch: %v", err)
	}

	rec := doJSON(t, h, http.MethodPatch, "/api/native/settings",
		map[string]any{"libraryPath": "/Volumes/Archive/Sonneck", "moveExisting": true})
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH: status = %d, want 200, body %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		LibraryPath        string  `json:"libraryPath"`
		PendingLibraryPath *string `json:"pendingLibraryPath"`
	}
	decodeData(t, rec, &resp)
	if resp.PendingLibraryPath == nil || *resp.PendingLibraryPath != "/Volumes/Archive/Sonneck" {
		t.Errorf("pendingLibraryPath = %v, want /Volumes/Archive/Sonneck", resp.PendingLibraryPath)
	}

	onDisk, err := nativeconfig.Load(native.SettingsPath)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if onDisk.LibraryPath != "" {
		t.Errorf("LibraryPath should be untouched until a restart actually applies the move, got %q", onDisk.LibraryPath)
	}
	if !onDisk.PendingMoveExisting {
		t.Error("PendingMoveExisting should be true — that's what was requested")
	}
}

func TestUpdateNativeSettings_BlankLibraryPathRejected(t *testing.T) {
	native, _ := fakeNativeOptions(t)
	h, conn := newNativeTestServer(t, "none", native)
	if err := repo.CompleteFirstLaunch(t.Context(), conn, "none", nil); err != nil {
		t.Fatalf("CompleteFirstLaunch: %v", err)
	}
	rec := doJSON(t, h, http.MethodPatch, "/api/native/settings", map[string]string{"libraryPath": "   "})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("blank libraryPath: status = %d, want 400", rec.Code)
	}
}

func TestChooseNativeFolder_ReturnsInjectedPath(t *testing.T) {
	native, _ := fakeNativeOptions(t)
	h, conn := newNativeTestServer(t, "none", native)
	if err := repo.CompleteFirstLaunch(t.Context(), conn, "none", nil); err != nil {
		t.Fatalf("CompleteFirstLaunch: %v", err)
	}
	rec := doJSON(t, h, http.MethodPost, "/api/native/choose-folder", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Path string `json:"path"`
	}
	decodeData(t, rec, &resp)
	if resp.Path != "/Users/jamie/Documents/Sheet Music" {
		t.Errorf("path = %q, want the fake dialog's own chosen path", resp.Path)
	}
}

func TestNativeRestart_InvokesRequestRestart(t *testing.T) {
	native, restarted := fakeNativeOptions(t)
	h, conn := newNativeTestServer(t, "none", native)
	if err := repo.CompleteFirstLaunch(t.Context(), conn, "none", nil); err != nil {
		t.Fatalf("CompleteFirstLaunch: %v", err)
	}
	rec := doJSON(t, h, http.MethodPost, "/api/native/restart", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body %s", rec.Code, rec.Body.String())
	}
	if !*restarted {
		t.Error("RequestRestart was never actually called")
	}
}
