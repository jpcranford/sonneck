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
	"os"
	"path/filepath"
)

// Settings is deliberately small — just the two things a native build
// needs to remember that config.Load's own env-var-driven Config can't
// hold (there's no env var to set from a running GUI app's own settings
// screen). Zero value means "nothing chosen yet" for both fields: an empty
// LibraryPath means fall through to config.defaultDataDir()'s own
// GOOS-aware default, and ShareOnNetwork false means the native-only
// loopback-only default bind stays in effect (project_wails_native_app_
// investigation memory's own "native binds loopback-only by default"
// decision).
type Settings struct {
	LibraryPath    string `json:"libraryPath"`
	ShareOnNetwork bool   `json:"shareOnNetwork"`
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
