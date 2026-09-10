package config_test

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jpcranford/sonneck/internal/config"
)

var configEnvVars = []string{
	"PORT", "DATA_DIR", "BACKUP_DIR", "BACKUP_CRON", "BACKUP_RETENTION_DAYS", "CITATION_FORMAT", "LOG_LEVEL",
	"COPYRIGHT_REGION", "AUTH_METHOD",
}

// clearConfigEnv unsets every config-relevant env var for the duration of
// the test, restoring whatever was there before on cleanup, and points
// DATA_DIR at a fresh t.TempDir() — Load now does real filesystem I/O
// against DATA_DIR (reading/writing config.yml, internal/libraryconfig),
// so every test needs a real, writable, test-isolated directory rather
// than the bare "/data" default, which doesn't exist and isn't writable
// outside a container.
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
	t.Setenv("DATA_DIR", t.TempDir())
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
	if cfg.BackupDir != cfg.DataDir+"/backups" {
		t.Errorf("BackupDir = %q, want %q", cfg.BackupDir, cfg.DataDir+"/backups")
	}
	if cfg.BackupCron() != "0 3 * * *" {
		t.Errorf("BackupCron() = %q, want %q", cfg.BackupCron(), "0 3 * * *")
	}
	if cfg.BackupRetentionDays() != 30 {
		t.Errorf("BackupRetentionDays() = %d, want 30", cfg.BackupRetentionDays())
	}
	if cfg.CitationFormat == "" {
		t.Error("CitationFormat is empty, want a default template")
	}
	if cfg.LogLevel() != "info" {
		t.Errorf("LogLevel() = %q, want %q", cfg.LogLevel(), "info")
	}
	if cfg.LogLevelVar.Level() != slog.LevelInfo {
		t.Errorf("LogLevelVar.Level() = %v, want %v", cfg.LogLevelVar.Level(), slog.LevelInfo)
	}
	if cfg.CopyrightRegion() != "en-US" {
		t.Errorf("CopyrightRegion() = %q, want %q", cfg.CopyrightRegion(), "en-US")
	}
	for _, setByEnv := range []bool{
		cfg.BackupCronSetByEnv, cfg.BackupRetentionDaysSetByEnv, cfg.LogLevelSetByEnv, cfg.CopyrightRegionSetByEnv,
	} {
		if setByEnv {
			t.Error("a Library Settings field reports SetByEnv=true with no env vars set")
		}
	}
}

func TestLoad_ExplicitValuesOverrideDefaults(t *testing.T) {
	clearConfigEnv(t)
	dataDir := filepath.Join(t.TempDir(), "custom-data")
	t.Setenv("PORT", "9090")
	t.Setenv("DATA_DIR", dataDir)
	t.Setenv("BACKUP_DIR", "/custom-backups")
	t.Setenv("BACKUP_CRON", "0 0 * * 0")
	t.Setenv("BACKUP_RETENTION_DAYS", "7")
	t.Setenv("CITATION_FORMAT", "{composer} - {title}")
	t.Setenv("LOG_LEVEL", "debug")
	t.Setenv("COPYRIGHT_REGION", "en-GB")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if cfg.Port != "9090" {
		t.Errorf("Port = %q, want %q", cfg.Port, "9090")
	}
	if cfg.DataDir != dataDir {
		t.Errorf("DataDir = %q, want %q", cfg.DataDir, dataDir)
	}
	if cfg.BackupDir != "/custom-backups" {
		t.Errorf("BackupDir = %q, want %q", cfg.BackupDir, "/custom-backups")
	}
	if cfg.BackupCron() != "0 0 * * 0" {
		t.Errorf("BackupCron() = %q, want %q", cfg.BackupCron(), "0 0 * * 0")
	}
	if cfg.BackupRetentionDays() != 7 {
		t.Errorf("BackupRetentionDays() = %d, want 7", cfg.BackupRetentionDays())
	}
	if cfg.CitationFormat != "{composer} - {title}" {
		t.Errorf("CitationFormat = %q, want %q", cfg.CitationFormat, "{composer} - {title}")
	}
	if cfg.LogLevel() != "debug" {
		t.Errorf("LogLevel() = %q, want %q", cfg.LogLevel(), "debug")
	}
	if cfg.LogLevelVar.Level() != slog.LevelDebug {
		t.Errorf("LogLevelVar.Level() = %v, want %v", cfg.LogLevelVar.Level(), slog.LevelDebug)
	}
	if cfg.CopyrightRegion() != "en-GB" {
		t.Errorf("CopyrightRegion() = %q, want %q", cfg.CopyrightRegion(), "en-GB")
	}
	for name, setByEnv := range map[string]bool{
		"BackupCronSetByEnv": cfg.BackupCronSetByEnv, "BackupRetentionDaysSetByEnv": cfg.BackupRetentionDaysSetByEnv,
		"LogLevelSetByEnv": cfg.LogLevelSetByEnv, "CopyrightRegionSetByEnv": cfg.CopyrightRegionSetByEnv,
	} {
		if !setByEnv {
			t.Errorf("%s = false, want true (its env var is set)", name)
		}
	}
}

func TestLoad_LogLevelIsCaseInsensitive(t *testing.T) {
	clearConfigEnv(t)
	t.Setenv("LOG_LEVEL", "WARN")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.LogLevelVar.Level() != slog.LevelWarn {
		t.Errorf("LogLevelVar.Level() = %v, want %v (LOG_LEVEL=WARN should work regardless of case)", cfg.LogLevelVar.Level(), slog.LevelWarn)
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
	dataDir := filepath.Join(t.TempDir(), "custom-data")
	t.Setenv("DATA_DIR", dataDir)

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.BackupDir != dataDir+"/backups" {
		t.Errorf("BackupDir = %q, want %q", cfg.BackupDir, dataDir+"/backups")
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

// The following cover Library Settings persistence — config.yml as
// the real runtime source of truth for backupCron/backupRetentionDays/
// logLevel/copyrightRegion, env vars winning and persisting back into it.

func TestLoad_PersistsDefaultsToConfigYmlOnFirstBoot(t *testing.T) {
	clearConfigEnv(t)
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(cfg.DataDir, "config.yml"))
	if err != nil {
		t.Fatalf("reading config.yml after first boot: %v", err)
	}
	if len(data) == 0 {
		t.Error("config.yml is empty after first boot, want the resolved defaults written to it")
	}
}

func TestLoad_PersistedValueAppliesWhenEnvUnset(t *testing.T) {
	clearConfigEnv(t)
	dataDir := t.TempDir()
	t.Setenv("DATA_DIR", dataDir)

	// First boot: no env vars, writes defaults to config.yml. Second run
	// simulates an Admin Settings edit having happened between boots by
	// hand-writing a different value directly to the file, then reloading
	// with no env var present — the persisted value, not the built-in
	// default, must apply.
	if _, err := config.Load(); err != nil {
		t.Fatalf("first Load: %v", err)
	}
	configPath := filepath.Join(dataDir, "config.yml")
	if err := os.WriteFile(configPath, []byte("logLevel: warn\nbackupCron: \"0 3 * * *\"\nbackupRetentionDays: 30\ncopyrightRegion: en-US\n"), 0o644); err != nil {
		t.Fatalf("writing config.yml: %v", err)
	}

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("second Load: %v", err)
	}
	if cfg.LogLevel() != "warn" {
		t.Errorf("LogLevel() = %q, want %q (the persisted value, no env var set)", cfg.LogLevel(), "warn")
	}
	if cfg.LogLevelSetByEnv {
		t.Error("LogLevelSetByEnv = true, want false (value came from config.yml, not an env var)")
	}
}

func TestLoad_EnvValueWinsAndIsPersistedBack(t *testing.T) {
	clearConfigEnv(t)
	dataDir := t.TempDir()
	t.Setenv("DATA_DIR", dataDir)
	configPath := filepath.Join(dataDir, "config.yml")
	if err := os.WriteFile(configPath, []byte("logLevel: warn\nbackupCron: \"0 3 * * *\"\nbackupRetentionDays: 30\ncopyrightRegion: en-US\n"), 0o644); err != nil {
		t.Fatalf("writing config.yml: %v", err)
	}
	t.Setenv("LOG_LEVEL", "error")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.LogLevel() != "error" {
		t.Errorf("LogLevel() = %q, want %q (env var must win over the persisted value)", cfg.LogLevel(), "error")
	}
	if !cfg.LogLevelSetByEnv {
		t.Error("LogLevelSetByEnv = false, want true")
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("reading config.yml: %v", err)
	}
	if got := string(data); !strings.Contains(got, "logLevel: error") {
		t.Errorf("config.yml = %q, want it to contain the env-sourced value (logLevel: error) written back", got)
	}
}

func TestConfig_LiveSettersApplyImmediately(t *testing.T) {
	clearConfigEnv(t)
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	cfg.SetCopyrightRegion("ca")
	if cfg.CopyrightRegion() != "ca" {
		t.Errorf("CopyrightRegion() after SetCopyrightRegion = %q, want %q", cfg.CopyrightRegion(), "ca")
	}
	cfg.SetBackupRetentionDays(14)
	if cfg.BackupRetentionDays() != 14 {
		t.Errorf("BackupRetentionDays() after SetBackupRetentionDays = %d, want 14", cfg.BackupRetentionDays())
	}
	cfg.SetBackupCron("0 4 * * *")
	if cfg.BackupCron() != "0 4 * * *" {
		t.Errorf("BackupCron() after SetBackupCron = %q, want %q", cfg.BackupCron(), "0 4 * * *")
	}
	cfg.LogLevelVar.Set(slog.LevelDebug)
	if cfg.LogLevel() != "debug" {
		t.Errorf("LogLevel() after LogLevelVar.Set(LevelDebug) = %q, want %q", cfg.LogLevel(), "debug")
	}
}

func TestValidateHelpers(t *testing.T) {
	if err := config.ValidateBackupCron("not-a-cron"); err == nil {
		t.Error("ValidateBackupCron(\"not-a-cron\") = nil, want an error")
	}
	if err := config.ValidateBackupCron("0 3 * * *"); err != nil {
		t.Errorf("ValidateBackupCron(\"0 3 * * *\") = %v, want nil", err)
	}
	if _, err := config.ValidateLogLevel("nonsense"); err == nil {
		t.Error("ValidateLogLevel(\"nonsense\") = nil, want an error")
	}
	if level, err := config.ValidateLogLevel("DEBUG"); err != nil || level != slog.LevelDebug {
		t.Errorf("ValidateLogLevel(\"DEBUG\") = (%v, %v), want (%v, nil)", level, err, slog.LevelDebug)
	}
	if err := config.ValidateCopyrightRegion("not-a-region"); err == nil {
		t.Error("ValidateCopyrightRegion(\"not-a-region\") = nil, want an error")
	}
	if err := config.ValidateCopyrightRegion("en-US"); err != nil {
		t.Errorf("ValidateCopyrightRegion(\"en-US\") = %v, want nil", err)
	}
	if err := config.ValidateBackupRetentionDays(0); err == nil {
		t.Error("ValidateBackupRetentionDays(0) = nil, want an error")
	}
	if err := config.ValidateBackupRetentionDays(30); err != nil {
		t.Errorf("ValidateBackupRetentionDays(30) = %v, want nil", err)
	}
}
