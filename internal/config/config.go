package config

import (
	"fmt"
	"os"
	"strconv"

	"github.com/robfig/cron/v3"
)

// defaultCitationFormat mirrors design doc §6's format string.
const defaultCitationFormat = `{composer}, {Book.bookTitle}, "{title}" ({workOpusNumber}), {publisher}, {imslpNumber|publisherId}, ca. {yearWritten}`

type Config struct {
	Port                string
	DataDir             string
	BackupDir           string
	BackupRetentionDays int
	BackupCron          string
	CitationFormat      string
}

// Load reads and validates configuration from the environment, failing fast
// per CLAUDE.md > Config rather than surfacing a bad value mid-request.
func Load() (*Config, error) {
	cfg := &Config{
		Port:           getEnv("PORT", "8080"),
		DataDir:        getEnv("DATA_DIR", "/data"),
		BackupCron:     getEnv("BACKUP_CRON", "0 3 * * *"),
		CitationFormat: getEnv("CITATION_FORMAT", defaultCitationFormat),
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

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
