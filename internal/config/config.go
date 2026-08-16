package config

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"

	"github.com/robfig/cron/v3"
)

// defaultCitationFormat mirrors design doc §6's format string. No "ca. "
// prefix on {yearWritten} — see CLAUDE.md > Config for why: that's a
// deliberate deviation from §6's literal wording, kept in sync here since
// this constant describes the same format buildCitation actually
// generates (internal/handlers/citation.go), even though CITATION_FORMAT
// itself has no effect on generation.
const defaultCitationFormat = `{composer}, {Book.bookTitle}, "{title}" ({workOpusNumber}), {publisher}, {imslpNumber|publisherId}, {yearWritten}`

const defaultLogLevel = "info"

// logLevels are the recognized LOG_LEVEL values. INFO is the default,
// matching CLAUDE.md > Logging's convention that routine-but-notable
// events (deletions, backups) belong at INFO in production; DEBUG is
// there to turn up verbosity when troubleshooting a deployed instance.
var logLevels = map[string]slog.Level{
	"debug": slog.LevelDebug,
	"info":  slog.LevelInfo,
	"warn":  slog.LevelWarn,
	"error": slog.LevelError,
}

type Config struct {
	Port                string
	DataDir             string
	BackupDir           string
	BackupRetentionDays int
	BackupCron          string
	CitationFormat      string
	LogLevel            string
}

// SlogLevel converts the validated LogLevel string into a slog.Level for
// building the app's logger.
func (c *Config) SlogLevel() slog.Level {
	return logLevels[c.LogLevel]
}

// Load reads and validates configuration from the environment, failing fast
// per CLAUDE.md > Config rather than surfacing a bad value mid-request.
func Load() (*Config, error) {
	cfg := &Config{
		Port:           getEnv("PORT", "8080"),
		DataDir:        getEnv("DATA_DIR", "/data"),
		BackupCron:     getEnv("BACKUP_CRON", "0 3 * * *"),
		CitationFormat: getEnv("CITATION_FORMAT", defaultCitationFormat),
		LogLevel:       strings.ToLower(getEnv("LOG_LEVEL", defaultLogLevel)),
	}
	cfg.BackupDir = getEnv("BACKUP_DIR", cfg.DataDir+"/backups")

	retentionStr := getEnv("BACKUP_RETENTION_DAYS", "30")
	retention, err := strconv.Atoi(retentionStr)
	if err != nil || retention <= 0 {
		return nil, fmt.Errorf("BACKUP_RETENTION_DAYS must be a positive integer, got %q", retentionStr)
	}
	cfg.BackupRetentionDays = retention

	if _, err := cron.ParseStandard(cfg.BackupCron); err != nil {
		return nil, fmt.Errorf("BACKUP_CRON is not a valid cron expression: %w", err)
	}

	if _, ok := logLevels[cfg.LogLevel]; !ok {
		return nil, fmt.Errorf("LOG_LEVEL must be one of debug, info, warn, error, got %q", cfg.LogLevel)
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
