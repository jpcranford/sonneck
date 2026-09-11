// Command sonneck-desktop is Sonneck's native (Wails) entry point —
// project_wails_native_app_investigation memory's Phase 6. Reuses the
// exact same handlers.New(...) http.Handler cmd/sonneck/main.go builds
// (the architecture-fit claim proven for real in Phase 2's throwaway
// spike, cmd/sonneck-desktop-spike, now made permanent here) via
// wails.Run's AssetServer.Handler option — zero adapter code, zero new
// API surface.
//
// Deliberately does NOT support the admin-CLI subcommand pattern
// (rebuild-search-index, reset-password, etc.) that cmd/sonneck/main.go
// has — a native app is launched by double-click, not a terminal, so
// there's no realistic operator typing `sonneck-desktop rebuild-search-
// index`. A scope decision, not an oversight; revisit if a real need
// for CLI-subcommand parity on native surfaces later.
package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/jpcranford/sonneck/internal/applog"
	"github.com/jpcranford/sonneck/internal/backup"
	"github.com/jpcranford/sonneck/internal/config"
	"github.com/jpcranford/sonneck/internal/db"
	"github.com/jpcranford/sonneck/internal/handlers"
	"github.com/jpcranford/sonneck/internal/nativeconfig"
	"github.com/jpcranford/sonneck/internal/netinfo"
	"github.com/jpcranford/sonneck/internal/oidcauth"
	"github.com/jpcranford/sonneck/internal/peoplemigrate"
	"github.com/jpcranford/sonneck/internal/repo"
	"github.com/jpcranford/sonneck/internal/webui"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// buildSHA/buildDate/buildTarget are overridden at build time via
// -ldflags, exactly mirroring cmd/sonneck/main.go's own convention
// (Phase 3's locked decision: keep buildTarget ldflags-driven in *both*
// binaries, not a hardcoded const here, purely for consistency — this
// binary's real build step should still pass
// -X main.buildTarget=native explicitly rather than relying on the
// default alone).
var (
	buildSHA    = "dev"
	buildDate   = "unknown"
	buildTarget = "native"
)

// resolvePopplerBinDir returns the directory a CI-packaged release
// bundles poppler-utils into, or "" if it isn't present (e.g. a local
// `wails build`/dev run with no bundling step) — "" falls through to
// internal/pdf's existing PATH-based lookup, so local development keeps
// working against a system-installed poppler exactly like it does today.
// macOS bundles into Contents/Resources/poppler alongside the executable
// (Contents/MacOS/<exe>), matching the already-proven dylibbundler output
// layout from Phase 1/2's spikes; Windows has no bundle convention, so
// poppler sits in a `poppler` folder next to the .exe in the same install
// directory.
//
// internal/pdf.toolPath (internal/pdf/pdf.go) joins PDF_BIN_DIR directly
// against a bare tool name ("pdfinfo", etc.) — no "bin" segment of its
// own — so this must return a directory that directly *contains* the
// three binaries, not their parent. That distinction matters differently
// per OS: dylibbundler's own real output (Phase 6, empirically re-tested
// against a real generated PDF, not assumed) puts the binaries in a `bin/`
// subfolder with their dylibs in a *sibling* `libs/` folder (the binaries'
// own baked-in rpath is literally "@executable_path/../libs/", regardless
// of whatever destination folder name a `-d` flag was given — a real,
// easy-to-miss mismatch if the two don't end up named to match), so macOS
// needs the extra "bin" join below. The Windows poppler-windows release
// ships every .exe and its .dll dependencies flat in one folder
// (confirmed via Phase 2's real windows-latest CI run,
// poppler-extracted\poppler-26.07.0\Library\bin\) with no separate
// lib-folder split — so Windows' own resolved directory already directly
// contains the binaries with no extra segment needed.
// desktopCtx is the context.Context Wails hands OnStartup, needed by
// chooseFolder (runtime.OpenDirectoryDialog) and requestRestart
// (runtime.Quit) — both real HTTP handler functions (handlers.NativeOptions,
// internal/handlers/native.go) that run on their own goroutines, entirely
// independent of Wails' own callback. A package-level var guarded by a
// mutex, not passed as a constructor param, because it genuinely doesn't
// exist yet at the point handlers.New is called (wails.Run hasn't started
// its own event loop, so OnStartup hasn't fired) — the closures below
// capture a reference to this var and read it fresh at call time, not its
// value at construction.
var (
	desktopCtxMu sync.RWMutex
	desktopCtx   context.Context
)

func setDesktopContext(ctx context.Context) {
	desktopCtxMu.Lock()
	defer desktopCtxMu.Unlock()
	desktopCtx = ctx
}

func getDesktopContext() context.Context {
	desktopCtxMu.RLock()
	defer desktopCtxMu.RUnlock()
	return desktopCtx
}

// chooseFolder opens a real native OS folder dialog — the First Launch
// flow's "Browse…" and Admin Settings' "Choose a different folder…" both
// go through this one function via handlers.NativeOptions.ChooseFolder.
// An empty desktopCtx (the dialog requested before OnStartup has ever
// fired — not realistically reachable once the window is actually up and
// serving HTTP requests, but defensive regardless) is reported as an error
// rather than silently returning "", which handleChooseNativeFolder would
// otherwise indistinguishably treat as a plain user cancel.
func chooseFolder(currentPath string) (string, error) {
	ctx := getDesktopContext()
	if ctx == nil {
		return "", fmt.Errorf("native folder picker not available yet (still starting up)")
	}
	return wailsruntime.OpenDirectoryDialog(ctx, wailsruntime.OpenDialogOptions{
		Title:            "Choose your Sonneck library folder",
		DefaultDirectory: currentPath,
	})
}

// requestRestart spawns a fresh copy of this same process, then asks the
// *current* one to shut down gracefully — a real wailsruntime.Quit (which
// makes wails.Run below return normally, so every deferred cleanup in
// main(), especially conn.Close(), actually runs) rather than a raw
// os.Exit, which would skip all of that and could leave the SQLite
// WAL/SHM files in a state the new process's own nativeconfig.
// ApplyPendingLibraryMove then has to retry against (see that function's
// own moveRetryAttempts comment for the full reasoning — spawning the new
// process concurrently with this shutdown, rather than fully
// synchronizing the two, is a deliberate simplicity/safety tradeoff that
// function's bounded retry exists to absorb). Falls back to a plain
// os.Exit only if desktopCtx was somehow never set (defensive, not a
// realistic path once the window is actually up).
func requestRestart() error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolving own executable path: %w", err)
	}
	cmd := exec.Command(exe, os.Args[1:]...)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("spawning relaunched process: %w", err)
	}
	go func() {
		// A brief pause so this HTTP response actually reaches the client
		// before the process starts tearing itself down.
		time.Sleep(250 * time.Millisecond)
		if ctx := getDesktopContext(); ctx != nil {
			wailsruntime.Quit(ctx)
		} else {
			os.Exit(0)
		}
	}()
	return nil
}

func resolvePopplerBinDir() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return ""
	}

	var dir string
	if runtime.GOOS == "darwin" {
		contentsDir := filepath.Dir(filepath.Dir(exe)) // .../Contents/MacOS/<exe> -> .../Contents
		dir = filepath.Join(contentsDir, "Resources", "poppler", "bin")
	} else {
		dir = filepath.Join(filepath.Dir(exe), "poppler")
	}

	if _, err := os.Stat(dir); err != nil {
		return ""
	}
	return dir
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	// Native-only settings (project_wails_native_app_investigation memory's
	// Phase 3): a chosen library path and Share on Network both live in a
	// small local JSON file, not an env var — nothing else sets DATA_DIR/
	// PDF_BIN_DIR for a double-clicked native app the way a docker-compose
	// environment: block or the dev tooling recipe does. Missing file ==
	// zero-value Settings (nativeconfig.Load's own documented behavior),
	// so a first-ever launch just falls through to config.Load()'s own
	// GOOS-aware default (internal/config.DefaultDataDir) and a
	// PATH-based poppler lookup below.
	settingsPath, err := nativeconfig.DefaultPath()
	if err != nil {
		logger.Error("failed to resolve native settings path", "error", err)
		os.Exit(1)
	}
	settings, err := nativeconfig.Load(settingsPath)
	if err != nil {
		logger.Error("failed to load native settings", "error", err, "path", settingsPath)
		os.Exit(1)
	}

	// Phase 7: apply a library-location change chosen (but not yet
	// applied) on a prior run — First Launch's folder step or Admin
	// Settings' "Library location" control, both via PATCH
	// /api/native/settings, which only ever writes PendingLibraryPath/
	// PendingMoveExisting, never LibraryPath itself directly. This is the
	// one safe place to do it: strictly before config.Load()/db.Open(),
	// so nothing has opened a database under either the old or new path
	// yet. A failed move is non-fatal by design (see that function's own
	// doc comment) — settings comes back unchanged and this process just
	// boots against whatever it was already using.
	if applied, err := nativeconfig.ApplyPendingLibraryMove(logger, settingsPath, settings); err != nil {
		logger.Error("failed to apply pending library location change", "error", err)
	} else {
		settings = applied
	}

	if settings.LibraryPath != "" {
		os.Setenv("DATA_DIR", settings.LibraryPath)
	}
	if popplerDir := resolvePopplerBinDir(); popplerDir != "" {
		os.Setenv("PDF_BIN_DIR", popplerDir)
	}

	cfg, err := config.Load()
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}

	logWriter, err := applog.NewRotatingWriter(cfg.LogsDir)
	if err != nil {
		logger.Error("failed to open log file", "error", err, "path", cfg.LogsDir)
		os.Exit(1)
	}
	defer logWriter.Close()

	logger = slog.New(slog.NewJSONHandler(io.MultiWriter(os.Stdout, logWriter), &slog.HandlerOptions{Level: cfg.LogLevelVar}))
	slog.SetDefault(logger)

	dbPath := filepath.Join(cfg.DataDir, "db", "sonneck.sqlite")
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		logger.Error("failed to create database directory", "error", err, "path", filepath.Dir(dbPath))
		os.Exit(1)
	}

	conn, err := db.Open(dbPath)
	if err != nil {
		logger.Error("failed to open database", "error", err)
		os.Exit(1)
	}
	defer conn.Close()

	// Same auto-heal steps as cmd/sonneck/main.go's own startup path — see
	// that file's comments for the full reasoning (peoplemigrate backfill,
	// search-index self-heal). Kept in sync deliberately; no CLI-subcommand
	// fallback exists here (this file's own header comment), so these
	// automatic paths are this binary's *only* way either ever runs.
	if result, err := peoplemigrate.Run(context.Background(), conn); err != nil {
		logger.Error("people migration failed", "error", err)
	} else if result.PiecesMigrated > 0 || result.BooksMigrated > 0 {
		logger.Info("people migration completed",
			"piecesMigrated", result.PiecesMigrated, "piecesSkipped", result.PiecesSkipped,
			"booksMigrated", result.BooksMigrated, "booksSkipped", result.BooksSkipped)
	}

	if needsRebuild, err := repo.SearchIndexNeedsRebuild(context.Background(), conn); err != nil {
		logger.Error("search index rebuild check failed", "error", err)
	} else if needsRebuild {
		if err := repo.RebuildSearchIndex(context.Background(), conn); err != nil {
			logger.Error("automatic search index rebuild failed", "error", err)
		} else {
			logger.Info("automatic search index rebuild completed")
		}
	}

	scheduler, err := backup.StartScheduler(cfg.BackupCron(), conn, cfg.BackupDir, cfg.LogsDir, cfg, logger)
	if err != nil {
		logger.Error("failed to start backup scheduler", "error", err)
		os.Exit(1)
	}
	defer scheduler.Stop()

	// OIDC stays env-var-only exactly as documented (CLAUDE.md > Multi-user
	// support) — the first-launch UI never offers it on native, but nothing
	// technically stops an operator from setting OIDC_* env vars even on a
	// native install, so this binary supports it for parity rather than
	// silently ignoring a config an unusual deployment might actually set.
	var oidcAuth *oidcauth.Authenticator
	if cfg.AuthMethod == "oidc" {
		oidcAuth, err = oidcauth.New(context.Background(), cfg)
		if err != nil {
			logger.Error("failed to configure OIDC", "error", err)
			os.Exit(1)
		}
	}

	frontend, err := webui.FS()
	if err != nil {
		logger.Error("failed to load embedded frontend", "error", err)
		os.Exit(1)
	}

	handler := handlers.New(conn, cfg, logger, frontend, scheduler, buildSHA, buildDate, buildTarget, oidcAuth, &handlers.NativeOptions{
		SettingsPath:          settingsPath,
		AppliedShareOnNetwork: settings.ShareOnNetwork,
		ChooseFolder:          chooseFolder,
		RequestRestart:        requestRestart,
	})

	ln, err := netinfo.ListenWithFallback(buildTarget, cfg.Port, settings.ShareOnNetwork)
	if err != nil {
		logger.Error("failed to bind listener", "error", err, "port", cfg.Port)
		os.Exit(1)
	}
	logger.Info("starting server", "address", ln.Addr().String(), "shareOnNetwork", settings.ShareOnNetwork)

	// Two separate consumers of the same handler, deliberately, not a
	// mistake: wails.Run's own AssetServer.Handler below serves the native
	// webview window itself, entirely in-process — confirmed in Phase 2's
	// spike to need no real TCP port at all (no extra listening port ever
	// showed up in that spike's own lsof check). A real net.Listener is a
	// second, independent thing this binary needs on top of that — the one
	// that actually makes Share on Network possible, since another device
	// on the LAN has no way to reach into Wails' own internal webview
	// channel.
	go func() {
		if err := http.Serve(ln, handler); err != nil {
			logger.Error("server stopped", "error", err)
		}
	}()

	err = wails.Run(&options.App{
		Title:  "Sonneck",
		Width:  1200,
		Height: 800,
		AssetServer: &assetserver.Options{
			Handler: handler,
		},
		// OnStartup is Wails' own hook for the one thing this binary needs
		// its real window context for — chooseFolder/requestRestart above,
		// both otherwise-plain HTTP handler functions that have no other
		// way to reach it.
		OnStartup: func(ctx context.Context) {
			setDesktopContext(ctx)
		},
		// A real, confirmed Wails v2 gotcha, not an oversight left as
		// "just accept the zero value": internal/frontend/desktop/darwin/
		// window.go only ever sets its own internal `zoomable` C variable
		// (default false) when options.App.Mac is non-nil — with Mac left
		// nil (as this was until this fix), the green traffic-light
		// button gets explicitly *disabled* (WailsContext.m's CreateWindow:
		// `if (!zoomable && resizable) { ... setEnabled: NO }`), not just
		// left at some default "maximize" behavior. A present-but-empty
		// &mac.Options{} is enough — DisableZoom's own Go zero value is
		// already false, so this alone restores a normal, clickable zoom
		// button. Native Spaces-based fullscreen (the green button's
		// hover-to-fullscreen affordance, Cmd+Ctrl+F) is a separate,
		// deeper Wails v2 limitation this does NOT fix — see
		// project_wails_native_app_investigation memory for the full
		// writeup and upstream reference (wailsapp/wails#2582).
		Mac: &mac.Options{},
	})
	if err != nil {
		logger.Error("wails run failed", "error", err)
		os.Exit(1)
	}
}
