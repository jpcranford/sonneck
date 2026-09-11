// Package backup implements the daily DB snapshot (design doc §4):
// VACUUM INTO a timestamped file, on a schedule driven by BACKUP_CRON, with
// BACKUP_RETENTION_DAYS pruning. It backs up the SQLite database only — the
// library folder (books/pieces) is left to the user's own volume/NAS
// backup, per design doc §17. The same daily job also prunes DATA_DIR/logs
// (internal/applog) to the same BACKUP_RETENTION_DAYS value — see
// Scheduler's own doc comment for why logs ride on this schedule rather
// than getting one of their own.
package backup

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/robfig/cron/v3"

	"github.com/jpcranford/sonneck/internal/applog"
	"github.com/jpcranford/sonneck/internal/config"
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

	path := filepath.Join(backupDir, fmt.Sprintf("sonneck-%s.sqlite", time.Now().UTC().Format("2006-01-02")))

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
// sonneck-YYYY-MM-DD.sqlite naming convention Run writes. A missing
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

// Scheduler owns the running cron job backing the daily backup, and
// supports rescheduling it live — Admin Settings' Library Settings card
// (PATCH /api/admin/library-settings) can change the backup schedule at
// runtime with no restart. Backup retention doesn't need an equivalent
// Reschedule: the
// job closure reads cfg.BackupRetentionDays() fresh every time it fires,
// so a changed retention value is already live the next time the job runs
// — only the cron expression itself needs the entry actually replaced.
// Log pruning (DATA_DIR/logs, internal/applog) piggybacks on this exact
// same job rather than getting its own cron entry/setting — it already
// needs a daily "read current retention, delete anything older" prune,
// which this job already does once a day for backups; a second schedule
// for the identical operation on a different directory would be pure
// duplication.
type Scheduler struct {
	cron *cron.Cron

	mu      sync.Mutex
	entryID cron.EntryID
}

func (s *Scheduler) job(db *sql.DB, backupDir, logsDir string, cfg *config.Config, logger *slog.Logger) func() {
	return func() {
		path, err := Run(context.Background(), db, backupDir)
		if err != nil {
			logger.Error("backup failed", "error", err)
			return
		}
		logger.Info("backup completed", "path", path)

		retentionDays := cfg.BackupRetentionDays()
		if err := Prune(backupDir, retentionDays); err != nil {
			logger.Error("backup pruning failed", "error", err)
			return
		}
		logger.Info("backup pruning completed", "retentionDays", retentionDays)

		// Log pruning free-rides on the same daily job and the same
		// retention setting — no separate schedule/setting for it, see
		// this package's own doc comment and internal/applog's.
		if err := applog.Prune(logsDir, retentionDays); err != nil {
			logger.Error("log pruning failed", "error", err)
			return
		}
		logger.Info("log pruning completed", "retentionDays", retentionDays)
	}
}

// Reschedule replaces the running job with one on newCronExpr — the old
// entry is removed and a new one added, rather than mutating the existing
// entry in place (robfig/cron has no such API). Safe to call from a
// concurrent HTTP handler; guarded by mu against a concurrent Reschedule.
func (s *Scheduler) Reschedule(newCronExpr string, db *sql.DB, backupDir, logsDir string, cfg *config.Config, logger *slog.Logger) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	id, err := s.cron.AddFunc(newCronExpr, s.job(db, backupDir, logsDir, cfg, logger))
	if err != nil {
		return fmt.Errorf("scheduling backup cron %q: %w", newCronExpr, err)
	}
	s.cron.Remove(s.entryID)
	s.entryID = id
	return nil
}

// Stop stops the underlying cron scheduler — main can defer this on
// shutdown, same as before this type existed.
func (s *Scheduler) Stop() {
	s.cron.Stop()
}

// StartScheduler registers a cron job (BACKUP_CRON) that runs Run, Prune,
// then applog.Prune (DATA_DIR/logs, same BACKUP_RETENTION_DAYS value),
// logging every outcome. Backups are a routine, expected operation —
// successes log at INFO, same as deletions/replacements (CLAUDE.md >
// Logging); only actual failures escalate to ERROR. Returns a *Scheduler
// (rather than the bare *cron.Cron this used to return) so callers can
// Reschedule it live later.
func StartScheduler(cronExpr string, db *sql.DB, backupDir, logsDir string, cfg *config.Config, logger *slog.Logger) (*Scheduler, error) {
	s := &Scheduler{cron: cron.New()}
	id, err := s.cron.AddFunc(cronExpr, s.job(db, backupDir, logsDir, cfg, logger))
	if err != nil {
		return nil, fmt.Errorf("scheduling backup cron %q: %w", cronExpr, err)
	}
	s.entryID = id

	s.cron.Start()
	return s, nil
}
