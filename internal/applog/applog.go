// Package applog implements the DATA_DIR/logs rolling application log: one
// file per day (sonneck-YYYY-MM-DD.log, mirroring internal/backup's own
// sonneck-YYYY-MM-DD.sqlite naming), pruned to BACKUP_RETENTION_DAYS by the
// same daily job that already prunes old backups (internal/backup.Scheduler)
// — logs and backups share one retention setting and one daily cron firing
// rather than a second schedule/setting existing just for this.
package applog

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// RotatingWriter is an io.Writer that appends to
// DATA_DIR/logs/sonneck-<today>.log, opening a new file whenever the date
// rolls over. Safe for concurrent use — slog's handler can call Write from
// multiple goroutines at once.
type RotatingWriter struct {
	mu      sync.Mutex
	dir     string
	current *os.File
	day     string
}

// NewRotatingWriter creates dir if needed and opens today's log file.
func NewRotatingWriter(dir string) (*RotatingWriter, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("creating logs directory: %w", err)
	}
	w := &RotatingWriter{dir: dir}
	if err := w.rotate(time.Now()); err != nil {
		return nil, err
	}
	return w, nil
}

func (w *RotatingWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if day := time.Now().Format("2006-01-02"); day != w.day {
		if err := w.rotate(time.Now()); err != nil {
			return 0, err
		}
	}
	return w.current.Write(p)
}

func (w *RotatingWriter) rotate(now time.Time) error {
	if w.current != nil {
		w.current.Close()
	}
	day := now.Format("2006-01-02")
	path := filepath.Join(w.dir, fmt.Sprintf("sonneck-%s.log", day))
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return fmt.Errorf("opening log file %s: %w", path, err)
	}
	w.current = f
	w.day = day
	return nil
}

// Close closes the currently open log file.
func (w *RotatingWriter) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.current == nil {
		return nil
	}
	return w.current.Close()
}

// Prune deletes log files older than retentionDays — identical logic to
// internal/backup.Prune (a flat mtime-based cutoff over every file in dir,
// not filename date parsing), so both directories are pruned the same way
// by the same daily job. A missing logs directory (nothing logged yet) is
// not an error.
func Prune(dir string, retentionDays int) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("reading logs directory: %w", err)
	}

	cutoff := time.Now().Add(-time.Duration(retentionDays) * 24 * time.Hour)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return fmt.Errorf("reading log file info for %s: %w", entry.Name(), err)
		}
		if info.ModTime().Before(cutoff) {
			path := filepath.Join(dir, entry.Name())
			if err := os.Remove(path); err != nil {
				return fmt.Errorf("removing expired log file %s: %w", path, err)
			}
		}
	}
	return nil
}
