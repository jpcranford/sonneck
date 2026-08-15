package config_test

import (
	"log/slog"
	"os"
	"testing"

	"github.com/jpcranford/picarda/internal/config"
)

var configEnvVars = []string{
	"PORT", "DATA_DIR", "BACKUP_DIR", "BACKUP_CRON", "BACKUP_RETENTION_DAYS", "CITATION_FORMAT", "LOG_LEVEL",
}

// clearConfigEnv unsets every config-relevant env var for the duration of
// the test, restoring whatever was there before on cleanup — so these
// tests aren't at the mercy of whatever happens to be set in the shell
// they run in.
func clearConfigEnv(t *testing.T) {
	t.Helper()
	for _, key := range configEnvVars {
		original, wasSet := os.LookupEnv(key)
		os.Unsetenv(key)
		t.Cleanup(func() {
			if wasSet {
				os.Setenv(key, original)
			}
		})
	}
}

func TestLoad_DefaultsWhenUnset(t *testing.T) {
	clearConfigEnv(t)

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if cfg.Port != "8080" {
		t.Errorf("Port = %q, want %q", cfg.Port, "8080")
	}
	if cfg.DataDir != "/data" {
		t.Errorf("DataDir = %q, want %q", cfg.DataDir, "/data")
	}
	if cfg.BackupDir != "/data/backups" {
		t.Errorf("BackupDir = %q, want %q", cfg.BackupDir, "/data/backups")
	}
	if cfg.BackupCron != "0 3 * * *" {
		t.Errorf("BackupCron = %q, want %q", cfg.BackupCron, "0 3 * * *")
	}
	if cfg.BackupRetentionDays != 30 {
		t.Errorf("BackupRetentionDays = %d, want 30", cfg.BackupRetentionDays)
	}
	if cfg.CitationFormat == "" {
		t.Error("CitationFormat is empty, want a default template")
	}
	if cfg.LogLevel != "info" {
		t.Errorf("LogLevel = %q, want %q", cfg.LogLevel, "info")
	}
	if cfg.SlogLevel() != slog.LevelInfo {
		t.Errorf("SlogLevel() = %v, want %v", cfg.SlogLevel(), slog.LevelInfo)
	}
}

func TestLoad_ExplicitValuesOverrideDefaults(t *testing.T) {
	clearConfigEnv(t)
	t.Setenv("PORT", "9090")
	t.Setenv("DATA_DIR", "/custom-data")
	t.Setenv("BACKUP_DIR", "/custom-backups")
	t.Setenv("BACKUP_CRON", "0 0 * * 0")
	t.Setenv("BACKUP_RETENTION_DAYS", "7")
	t.Setenv("CITATION_FORMAT", "{composer} - {title}")
	t.Setenv("LOG_LEVEL", "debug")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if cfg.Port != "9090" {
		t.Errorf("Port = %q, want %q", cfg.Port, "9090")
	}
	if cfg.DataDir != "/custom-data" {
		t.Errorf("DataDir = %q, want %q", cfg.DataDir, "/custom-data")
	}
	if cfg.BackupDir != "/custom-backups" {
		t.Errorf("BackupDir = %q, want %q", cfg.BackupDir, "/custom-backups")
	}
	if cfg.BackupCron != "0 0 * * 0" {
		t.Errorf("BackupCron = %q, want %q", cfg.BackupCron, "0 0 * * 0")
	}
	if cfg.BackupRetentionDays != 7 {
		t.Errorf("BackupRetentionDays = %d, want 7", cfg.BackupRetentionDays)
	}
	if cfg.CitationFormat != "{composer} - {title}" {
		t.Errorf("CitationFormat = %q, want %q", cfg.CitationFormat, "{composer} - {title}")
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("LogLevel = %q, want %q", cfg.LogLevel, "debug")
	}
	if cfg.SlogLevel() != slog.LevelDebug {
		t.Errorf("SlogLevel() = %v, want %v", cfg.SlogLevel(), slog.LevelDebug)
	}
}

func TestLoad_LogLevelIsCaseInsensitive(t *testing.T) {
	clearConfigEnv(t)
	t.Setenv("LOG_LEVEL", "WARN")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.SlogLevel() != slog.LevelWarn {
		t.Errorf("SlogLevel() = %v, want %v (LOG_LEVEL=WARN should work regardless of case)", cfg.SlogLevel(), slog.LevelWarn)
	}
}

func TestLoad_RejectsUnrecognizedLogLevel(t *testing.T) {
	clearConfigEnv(t)
	t.Setenv("LOG_LEVEL", "verbose")

	if _, err := config.Load(); err == nil {
		t.Error("Load with LOG_LEVEL=verbose = nil error, want an error (not one of debug/info/warn/error)")
	}
}

// TestLoad_BackupDirDefaultsRelativeToDataDir covers the one default that
// isn't a plain literal: BACKUP_DIR derives from DATA_DIR when unset.
func TestLoad_BackupDirDefaultsRelativeToDataDir(t *testing.T) {
	clearConfigEnv(t)
	t.Setenv("DATA_DIR", "/custom-data")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.BackupDir != "/custom-data/backups" {
		t.Errorf("BackupDir = %q, want %q", cfg.BackupDir, "/custom-data/backups")
	}
}

// The following lock in CLAUDE.md > Config's fail-fast requirement: an
// invalid BACKUP_CRON or BACKUP_RETENTION_DAYS must be caught at startup,
// not surfaced later mid-request.

func TestLoad_RejectsUnparseableBackupCron(t *testing.T) {
	clearConfigEnv(t)
	t.Setenv("BACKUP_CRON", "not-a-cron-expression")

	if _, err := config.Load(); err == nil {
		t.Error("Load with an unparseable BACKUP_CRON = nil error, want an error")
	}
}

func TestLoad_RejectsNonIntegerBackupRetentionDays(t *testing.T) {
	clearConfigEnv(t)
	t.Setenv("BACKUP_RETENTION_DAYS", "not-a-number")

	if _, err := config.Load(); err == nil {
		t.Error("Load with a non-integer BACKUP_RETENTION_DAYS = nil error, want an error")
	}
}

func TestLoad_RejectsNonPositiveBackupRetentionDays(t *testing.T) {
	clearConfigEnv(t)
	t.Setenv("BACKUP_RETENTION_DAYS", "0")

	if _, err := config.Load(); err == nil {
		t.Error("Load with BACKUP_RETENTION_DAYS=0 = nil error, want an error (must be positive)")
	}
}
