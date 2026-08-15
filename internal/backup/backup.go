// Package backup implements the daily DB snapshot (design doc §4):
// VACUUM INTO a timestamped file, on a schedule driven by BACKUP_CRON, with
// BACKUP_RETENTION_DAYS pruning. It backs up the SQLite database only — the
// library folder (books/pieces) is left to the user's own volume/NAS
// backup, per design doc §17.
package backup

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/robfig/cron/v3"
)

// Run performs a single backup, returning the path written. VACUUM INTO is
// used rather than a raw file copy specifically because a raw copy can
// catch the file mid-write; VACUUM INTO guarantees a consistent snapshot
// even while the server keeps serving requests (WAL mode, CLAUDE.md >
// Concurrency).
func Run(ctx context.Context, db *sql.DB, backupDir string) (string, error) {
	if err := os.MkdirAll(backupDir, 0o755); err != nil {
		return "", fmt.Errorf("creating backup directory: %w", err)
	}

	path := filepath.Join(backupDir, fmt.Sprintf("picarda-%s.sqlite", time.Now().UTC().Format("2006-01-02")))

	// VACUUM INTO refuses to write over an existing file — a second backup
	// on the same UTC day (e.g. a manual re-run) replaces the first rather
	// than erroring.
	if _, err := os.Stat(path); err == nil {
		if err := os.Remove(path); err != nil {
			return "", fmt.Errorf("removing existing same-day backup: %w", err)
		}
	}

	if _, err := db.ExecContext(ctx, "VACUUM INTO ?", path); err != nil {
		return "", fmt.Errorf("VACUUM INTO %s: %w", path, err)
	}
	return path, nil
}

// Prune deletes backup files older than retentionDays, matching the
// picarda-YYYY-MM-DD.sqlite naming convention Run writes. A missing
// backup directory (no backups have run yet) is not an error.
func Prune(backupDir string, retentionDays int) error {
	entries, err := os.ReadDir(backupDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("reading backup directory: %w", err)
	}

	cutoff := time.Now().Add(-time.Duration(retentionDays) * 24 * time.Hour)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return fmt.Errorf("reading backup file info for %s: %w", entry.Name(), err)
		}
		if info.ModTime().Before(cutoff) {
			path := filepath.Join(backupDir, entry.Name())
			if err := os.Remove(path); err != nil {
				return fmt.Errorf("removing expired backup %s: %w", path, err)
			}
		}
	}
	return nil
}

// StartScheduler registers a cron job (BACKUP_CRON) that runs Run then
// Prune, logging both outcomes. Backups are a routine, expected operation
// — successes log at INFO, same as deletions/replacements (CLAUDE.md >
// Logging); only actual failures escalate to ERROR. Returns the running
// cron instance so main can Stop() it on shutdown.
func StartScheduler(cronExpr string, db *sql.DB, backupDir string, retentionDays int, logger *slog.Logger) (*cron.Cron, error) {
	c := cron.New()
	_, err := c.AddFunc(cronExpr, func() {
		path, err := Run(context.Background(), db, backupDir)
		if err != nil {
			logger.Error("backup failed", "error", err)
			return
		}
		logger.Info("backup completed", "path", path)

		if err := Prune(backupDir, retentionDays); err != nil {
			logger.Error("backup pruning failed", "error", err)
			return
		}
		logger.Info("backup pruning completed", "retentionDays", retentionDays)
	})
	if err != nil {
		return nil, fmt.Errorf("scheduling backup cron %q: %w", cronExpr, err)
	}

	c.Start()
	return c, nil
}
