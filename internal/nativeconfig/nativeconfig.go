// Package nativeconfig persists the small set of choices a native (Wails)
// build needs to remember across relaunches that a plain env var can't
// hold — which folder its library lives in, and whether it's sharing
// itself on the local network. Docker never uses this package at all:
// DATA_DIR is set once, at deploy time, by the operator's own compose file
// (internal/config's own DataDir handling), and there's no equivalent
// "share on network" toggle since Docker's own port mapping already is
// that choice.
//
// project_wails_native_app_investigation memory's Phase 3 (locked
// 2026-09-11) — groundwork only. No native entry point exists yet
// (working name cmd/sonneck-desktop, Phase 6) to actually call Load/Save;
// this package exists so that whenever it does, both the first-launch
// folder picker and the reset-library-location control (both Phase 7, not
// yet designed — see that memory's Phase 4/5) share one implementation
// rather than building this twice.
package nativeconfig

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/jpcranford/sonneck/internal/config"
)

// Settings is deliberately small — just the things a native build needs to
// remember that config.Load's own env-var-driven Config can't hold
// (there's no env var to set from a running GUI app's own settings
// screen). Zero value means "nothing chosen yet" for LibraryPath/
// ShareOnNetwork: an empty LibraryPath means fall through to
// config.DefaultDataDir()'s own GOOS-aware default, and ShareOnNetwork
// false means the native-only loopback-only default bind stays in effect
// (project_wails_native_app_investigation memory's own "native binds
// loopback-only by default" decision).
type Settings struct {
	LibraryPath    string `json:"libraryPath"`
	ShareOnNetwork bool   `json:"shareOnNetwork"`

	// PendingLibraryPath/PendingMoveExisting (Phase 7) — a chosen-but-not-
	// yet-applied library folder. Both the First Launch folder step and
	// Admin Settings' "Library location" control write here, never
	// directly to LibraryPath: DATA_DIR is resolved once, before
	// db.Open(), so a change can't take effect until the next process
	// start. ApplyPendingLibraryMove runs at the very top of that next
	// start (cmd/sonneck-desktop/main.go), before config.Load()/db.Open(),
	// and is the only thing that ever promotes a pending path into
	// LibraryPath itself. PendingMoveExisting mirrors the locked
	// move-vs-point design (project_wails_native_app_investigation memory's
	// Phase 5 mockup): true physically moves the current library's
	// contents into the new folder first; false just repoints, leaving
	// whatever's at the old path untouched (the normal case for a fresh
	// pick during First Launch, since there's nothing to move yet).
	PendingLibraryPath  string `json:"pendingLibraryPath,omitempty"`
	PendingMoveExisting bool   `json:"pendingMoveExisting,omitempty"`
}

// DefaultPath returns the OS-conventional location for this file —
// os.UserConfigDir() already resolves to exactly the per-OS convention
// the 2026-08-29 investigation pass specified by hand (~/Library/
// Application Support on macOS, %AppData% on Windows), so this just adds
// the app's own subdirectory and filename rather than hardcoding either
// path directly.
func DefaultPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("resolving user config dir: %w", err)
	}
	return filepath.Join(dir, "Sonneck", "config.json"), nil
}

// Load reads path, returning a zero-value Settings (not an error) if the
// file doesn't exist yet — the normal state on a brand-new native install,
// before the first-launch folder picker (Phase 7, not yet built) has ever
// run.
func Load(path string) (*Settings, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &Settings{}, nil
		}
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}
	var s Settings
	if err := json.Unmarshal(data, &s); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	return &s, nil
}

// Save writes s to path atomically — a temp file in the same directory
// (so the final rename is same-filesystem, never cross-device) followed by
// os.Rename, mirroring internal/libraryconfig.Save's exact same rationale
// (a crash or concurrent read mid-write never observes a truncated or
// partially-written config.json). Creates the parent directory if it
// doesn't exist yet, unlike libraryconfig.Save — that package's parent
// (DATA_DIR itself) always already exists by the time it's ever called;
// this one's parent (the OS user-config directory's own "Sonneck"
// subfolder) generally doesn't, on a first save.
func Save(path string, s *Settings) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating %s: %w", dir, err)
	}

	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding config: %w", err)
	}

	tmp, err := os.CreateTemp(dir, ".config-*.json.tmp")
	if err != nil {
		return fmt.Errorf("creating temp file: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath) // no-op once the rename below succeeds

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("writing temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("closing temp file: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("renaming into place: %w", err)
	}
	return nil
}

// moveRetryAttempts/moveRetryDelay bound how long ApplyPendingLibraryMove
// waits for the *previous* process to fully release its own file handles
// on the old library directory before giving up. The restart that leads
// here (cmd/sonneck-desktop's requestRestart) spawns this new process
// concurrently with asking the old one to shut down gracefully (a real
// Wails runtime.Quit, so its own deferred db.Close() actually runs) rather
// than synchronizing the two — simplest correct design, but it does mean
// this process can start up (and reach this move) microseconds before the
// old one has actually closed its SQLite file. A short bounded retry
// absorbs that ordinary race without needing a cross-process handshake.
const (
	moveRetryAttempts = 10
	moveRetryDelay    = 200 * time.Millisecond
)

// ApplyPendingLibraryMove runs at the very top of cmd/sonneck-desktop's
// startup, before config.Load()/db.Open() — the one place it's safe to
// move a whole library directory, since nothing has opened a database
// under either the old or new path yet. A no-op (returns s unchanged) when
// nothing is pending, which is the overwhelming common case on every
// ordinary boot.
//
// Failure is deliberately conservative: if the move itself fails (the
// destination isn't empty, or moving the files errored even after
// retrying), LibraryPath/PendingLibraryPath/PendingMoveExisting are all
// left exactly as they were — the app boots against the *old* directory
// (data untouched, nothing silently lost) and logs a clear error, with the
// pending move still recorded so a later retry (another restart) can pick
// it back up. Only a fully successful move (or a "point-only" repoint,
// which can't itself fail this way) ever clears the pending fields and
// promotes PendingLibraryPath into LibraryPath.
func ApplyPendingLibraryMove(logger *slog.Logger, path string, s *Settings) (*Settings, error) {
	if s.PendingLibraryPath == "" || s.PendingLibraryPath == s.LibraryPath {
		// Nothing pending, or it already matches the applied path (e.g. the
		// user toggled back to the folder already in use) — clear a
		// leftover pending flag if one's somehow still set, but there's
		// nothing to move either way.
		if s.PendingLibraryPath != "" {
			cleared := *s
			cleared.PendingLibraryPath = ""
			cleared.PendingMoveExisting = false
			if err := Save(path, &cleared); err != nil {
				return s, fmt.Errorf("clearing no-op pending move: %w", err)
			}
			return &cleared, nil
		}
		return s, nil
	}

	oldPath := s.LibraryPath
	if oldPath == "" {
		oldPath = config.DefaultDataDir()
	}
	newPath := s.PendingLibraryPath

	if s.PendingMoveExisting {
		if _, err := os.Stat(oldPath); err == nil {
			if err := moveDirWithRetry(logger, oldPath, newPath); err != nil {
				return s, fmt.Errorf("moving library from %s to %s: %w", oldPath, newPath, err)
			}
		}
		// If oldPath doesn't exist at all (a fresh install that's never
		// written anything there yet), there's nothing to move — fall
		// through to the plain repoint below, identical to
		// PendingMoveExisting == false.
	}

	applied := *s
	applied.LibraryPath = newPath
	applied.PendingLibraryPath = ""
	applied.PendingMoveExisting = false
	if err := Save(path, &applied); err != nil {
		return s, fmt.Errorf("persisting applied library path: %w", err)
	}
	logger.Info("native library location applied", "from", oldPath, "to", newPath, "moved", s.PendingMoveExisting)
	return &applied, nil
}

// moveDirWithRetry requires dst to not already exist (a real, populated
// destination is a genuine conflict — silently merging into it risks
// clobbering unrelated files, so this refuses rather than guessing) and
// retries the actual move a bounded number of times, absorbing the
// ordinary "previous process hasn't released its file handles yet" race
// documented on moveRetryAttempts above.
func moveDirWithRetry(logger *slog.Logger, src, dst string) error {
	if _, err := os.Stat(dst); err == nil {
		return fmt.Errorf("destination %s already exists — choose an empty or nonexistent folder", dst)
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("checking destination %s: %w", dst, err)
	}

	var lastErr error
	for attempt := 1; attempt <= moveRetryAttempts; attempt++ {
		if lastErr = moveDir(src, dst); lastErr == nil {
			return nil
		}
		logger.Warn("library move attempt failed, retrying", "attempt", attempt, "error", lastErr)
		time.Sleep(moveRetryDelay)
	}
	return lastErr
}

// moveDir tries the fast, atomic path first (a single os.Rename of the
// whole directory) and falls back to a manual recursive copy-then-remove
// only if that fails — the fast path always succeeds when src/dst share a
// filesystem (the common case, same-drive), but a musician moving their
// library onto a different drive/volume is a real, plausible scenario
// os.Rename can't handle (fails with a cross-device-link error), so the
// fallback isn't optional.
func moveDir(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return fmt.Errorf("creating parent of %s: %w", dst, err)
	}
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	if err := copyDirRecursive(src, dst); err != nil {
		_ = os.RemoveAll(dst) // don't leave a half-copied destination behind
		return err
	}
	if err := os.RemoveAll(src); err != nil {
		return fmt.Errorf("copied to %s but failed to remove original %s: %w", dst, src, err)
	}
	return nil
}

func copyDirRecursive(src, dst string) error {
	return filepath.Walk(src, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, p)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, info.Mode())
		}
		return copyFile(p, target, info.Mode())
	})
}

func copyFile(src, dst string, mode os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}
