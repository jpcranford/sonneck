// Package libraryconfig persists Admin Settings' Library Settings card
// (Backup schedule/retention, Log level, Copyright region) to a real file
// on disk — a deliberate, confirmed exception alongside server_settings to
// CLAUDE.md > Config's "no settings table in v1": these four fields need
// runtime persistence, but not in SQLite. The file lives at
// DATA_DIR/config.yml (root of the library folder, alongside db/, backups/,
// cache/, library/ — confirmed placement, not DATA_DIR/db/ despite being
// "sonneck.db's sibling" in the loosest sense).
//
// internal/config.Load merges this file with env vars at startup (env
// always wins and gets written back into the file — see that package's own
// doc comment) and is the only caller; nothing else should read or write
// config.yml directly.
package libraryconfig

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// Settings mirrors exactly the 4 admin-editable Library Settings fields —
// nothing else. Port/DataDir/CitationFormat/AuthMethod deliberately don't
// live here: the first two are deploy-time-only with no admin UI, the third
// is dead config (CLAUDE.md > Config: loaded but never consulted), and the
// fourth already has its own working, shipped SQLite-based mechanism
// (server_settings, migration 00024) that this package doesn't touch.
type Settings struct {
	BackupCron          string `yaml:"backupCron"`
	BackupRetentionDays int    `yaml:"backupRetentionDays"`
	LogLevel            string `yaml:"logLevel"`
	CopyrightRegion     string `yaml:"copyrightRegion"`
}

// Load reads path, returning a zero-value Settings (not an error) if the
// file doesn't exist yet — the normal state on a brand-new install, before
// config.Load's own merge-with-env-and-defaults step has ever run.
func Load(path string) (*Settings, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &Settings{}, nil
		}
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}
	var s Settings
	if err := yaml.Unmarshal(data, &s); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	return &s, nil
}

// Save writes s to path atomically — a temp file in the same directory
// (so the final rename is same-filesystem, never cross-device) followed by
// os.Rename, so a crash or concurrent read mid-write never observes a
// truncated or partially-written config.yml.
func Save(path string, s *Settings) error {
	data, err := yaml.Marshal(s)
	if err != nil {
		return fmt.Errorf("encoding config: %w", err)
	}
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".config-*.yml.tmp")
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
