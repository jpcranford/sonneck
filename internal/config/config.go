package config

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"

	"github.com/robfig/cron/v3"

	"github.com/jpcranford/sonneck/internal/copyright"
	"github.com/jpcranford/sonneck/internal/libraryconfig"
	"github.com/jpcranford/sonneck/internal/models"
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

const defaultCopyrightRegion = "en-US"
const defaultBackupCron = "0 3 * * *"
const defaultBackupRetentionDays = 30

// Config holds process-wide settings. Most fields are set once at startup
// and never change. Four fields — BackupCron/BackupRetentionDays/LogLevel/
// CopyrightRegion, Admin Settings' "Library Settings" card — are genuinely
// live-mutable: an admin can change them at runtime (PATCH
// /api/admin/library-settings, internal/handlers/admin.go) when not
// env-shadowed, persisted to DATA_DIR/config.yml (internal/libraryconfig)
// and applied immediately with no restart. Guarded by mu since HTTP
// handlers read/write concurrently; LogLevel is instead a *slog.LevelVar
// (the standard library's own mutable-level primitive), since that's what
// slog.HandlerOptions.Level actually wants.
type Config struct {
	Port           string
	DataDir        string
	BackupDir      string
	CitationFormat string
	// AuthMethod (multi-user support) — "" if unset, meaning the choice
	// made through the first-time launch flow (persisted in
	// server_settings, see repo.GetServerSettings) governs instead. When
	// non-empty this always wins over that stored choice — see
	// GET /api/config's resolution order (memory project_multiuser_build.md).
	AuthMethod string

	// OIDC (Phase 14) — all seven read only when AuthMethod == "oidc"
	// (env-var-only, master plan's Auth methods table); see
	// precious-kindling-pretzel.md's Phase 14 section for the full table of
	// what each does and its default. None of these do network I/O here —
	// the one call that needs it (discovery) is internal/oidcauth.New,
	// a separate startup step for exactly that reason.
	OIDCIssuerURL          string
	OIDCClientID           string
	OIDCClientSecret       string
	OIDCRedirectURI        string
	ExternalProvider       string
	OIDCAllowRegistration  bool
	OIDCDefaultPermissions []string

	mu                  sync.RWMutex
	backupCron          string
	backupRetentionDays int
	copyrightRegion     string

	// LogLevelVar is read directly by cmd/sonneck/main.go's slog handler
	// construction (slog.HandlerOptions{Level: cfg.LogLevelVar}) — updating
	// it live via .Set() changes logging output immediately, no restart,
	// no extra plumbing needed beyond this one shared pointer.
	LogLevelVar *slog.LevelVar

	// SetByEnv flags drive Admin Settings' env-shadow pills (CLAUDE.md >
	// Config: "Env vars always win over whatever's configured through this
	// screen" — same convention AuthMethodSetByEnv already established for
	// Security). A field can't be edited through the app while its own flag
	// is true.
	BackupCronSetByEnv          bool
	BackupRetentionDaysSetByEnv bool
	LogLevelSetByEnv            bool
	CopyrightRegionSetByEnv     bool
}

func (c *Config) BackupCron() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.backupCron
}

// SetBackupCron only updates the live in-memory value — callers that also
// need this to survive a restart (Admin Settings' PATCH handler) persist to
// config.yml themselves via internal/libraryconfig.Save, then call this.
func (c *Config) SetBackupCron(v string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.backupCron = v
}

func (c *Config) BackupRetentionDays() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.backupRetentionDays
}

func (c *Config) SetBackupRetentionDays(v int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.backupRetentionDays = v
}

func (c *Config) CopyrightRegion() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.copyrightRegion
}

func (c *Config) SetCopyrightRegion(v string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.copyrightRegion = v
}

func (c *Config) LogLevel() string {
	for name, level := range logLevels {
		if level == c.LogLevelVar.Level() {
			return name
		}
	}
	return defaultLogLevel
}

// ValidateBackupCron/ValidateLogLevel/ValidateCopyrightRegion/
// ValidateBackupRetentionDays are exported so Admin Settings' PATCH
// /api/admin/library-settings handler validates an admin-submitted value
// with the exact same rules Load applies to an env var — one source of
// truth for what's a legal value, not two copies that could drift.

func ValidateBackupCron(expr string) error {
	if _, err := cron.ParseStandard(expr); err != nil {
		return fmt.Errorf("not a valid cron expression: %w", err)
	}
	return nil
}

func ValidateLogLevel(level string) (slog.Level, error) {
	parsed, ok := logLevels[strings.ToLower(level)]
	if !ok {
		return 0, fmt.Errorf("must be one of debug, info, warn, error, got %q", level)
	}
	return parsed, nil
}

func ValidateCopyrightRegion(region string) error {
	if !copyright.ValidRegion(region) {
		return fmt.Errorf("%q is not a known region", region)
	}
	return nil
}

func ValidateBackupRetentionDays(days int) error {
	if days <= 0 {
		return fmt.Errorf("must be a positive integer, got %d", days)
	}
	return nil
}

// Load reads and validates configuration from the environment plus
// DATA_DIR/config.yml, failing fast per CLAUDE.md > Config rather than
// surfacing a bad value mid-request.
//
// Library Settings (backupCron/backupRetentionDays/logLevel/
// copyrightRegion) merge two sources, confirmed 2026-09-08: an env var,
// when set, always wins and gets written back into config.yml (so the file
// stays the honest record of "what's actually running," even though env
// vars only ever apply at process start); when unset, the file's own
// persisted value applies (set by a prior Admin Settings edit, or the
// built-in default if the file has never been written). The merged,
// effective values are what get validated below — identical rules whether
// the value came from the environment or the file.
func Load() (*Config, error) {
	cfg := &Config{
		Port:           getEnv("PORT", "8080"),
		DataDir:        getEnv("DATA_DIR", "/data"),
		CitationFormat: getEnv("CITATION_FORMAT", defaultCitationFormat),
		AuthMethod:     getEnv("AUTH_METHOD", ""),
	}
	cfg.BackupDir = getEnv("BACKUP_DIR", cfg.DataDir+"/backups")

	switch cfg.AuthMethod {
	case "", "none", "singlepass", "oidc":
	default:
		return nil, fmt.Errorf("AUTH_METHOD must be one of none, singlepass, oidc, got %q", cfg.AuthMethod)
	}

	if cfg.AuthMethod == "oidc" {
		cfg.OIDCIssuerURL = getEnv("OIDC_ISSUER_URL", "")
		cfg.OIDCClientID = getEnv("OIDC_CLIENT_ID", "")
		cfg.OIDCClientSecret = getEnv("OIDC_CLIENT_SECRET", "")
		cfg.OIDCRedirectURI = getEnv("OIDC_REDIRECT_URI", "")
		for name, val := range map[string]string{
			"OIDC_ISSUER_URL": cfg.OIDCIssuerURL, "OIDC_CLIENT_ID": cfg.OIDCClientID,
			"OIDC_CLIENT_SECRET": cfg.OIDCClientSecret, "OIDC_REDIRECT_URI": cfg.OIDCRedirectURI,
		} {
			if val == "" {
				return nil, fmt.Errorf("%s is required when AUTH_METHOD=oidc", name)
			}
		}
		cfg.ExternalProvider = getEnv("EXTERNAL_PROVIDER", "your identity provider")

		cfg.OIDCAllowRegistration = true
		if v := os.Getenv("OIDC_ALLOW_REGISTRATION"); v != "" {
			parsed, err := strconv.ParseBool(v)
			if err != nil {
				return nil, fmt.Errorf("OIDC_ALLOW_REGISTRATION must be a boolean, got %q", v)
			}
			cfg.OIDCAllowRegistration = parsed
		}

		cfg.OIDCDefaultPermissions = []string{models.PermissionRead}
		if v := os.Getenv("OIDC_DEFAULT_PERMISSIONS"); v != "" {
			perms := strings.Split(v, ",")
			for i, p := range perms {
				perms[i] = strings.TrimSpace(p)
			}
			for _, p := range perms {
				if !slices.Contains(models.AllPermissions, p) {
					return nil, fmt.Errorf("OIDC_DEFAULT_PERMISSIONS: %q is not a valid permission", p)
				}
			}
			cfg.OIDCDefaultPermissions = perms
		}
	}

	// DATA_DIR itself needs to exist before config.yml can be read/written —
	// in practice always true by this point (a Docker bind-mount target is
	// created empty by Docker itself even against a nonexistent host path,
	// memory project_docker_bindmount_permissions.md), but MkdirAll is
	// idempotent and cheap, so there's no reason not to guarantee it here
	// too rather than assume.
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		return nil, fmt.Errorf("creating data directory: %w", err)
	}
	configPath := filepath.Join(cfg.DataDir, "config.yml")
	persisted, err := libraryconfig.Load(configPath)
	if err != nil {
		return nil, fmt.Errorf("loading %s: %w", configPath, err)
	}

	if envCron := os.Getenv("BACKUP_CRON"); envCron != "" {
		cfg.backupCron = envCron
		cfg.BackupCronSetByEnv = true
	} else if persisted.BackupCron != "" {
		cfg.backupCron = persisted.BackupCron
	} else {
		cfg.backupCron = defaultBackupCron
	}
	if err := ValidateBackupCron(cfg.backupCron); err != nil {
		return nil, fmt.Errorf("BACKUP_CRON: %w", err)
	}

	if envRetention := os.Getenv("BACKUP_RETENTION_DAYS"); envRetention != "" {
		retention, err := strconv.Atoi(envRetention)
		if err != nil {
			return nil, fmt.Errorf("BACKUP_RETENTION_DAYS must be a positive integer, got %q", envRetention)
		}
		cfg.backupRetentionDays = retention
		cfg.BackupRetentionDaysSetByEnv = true
	} else if persisted.BackupRetentionDays != 0 {
		cfg.backupRetentionDays = persisted.BackupRetentionDays
	} else {
		cfg.backupRetentionDays = defaultBackupRetentionDays
	}
	if err := ValidateBackupRetentionDays(cfg.backupRetentionDays); err != nil {
		return nil, fmt.Errorf("BACKUP_RETENTION_DAYS: %w", err)
	}

	logLevelStr := ""
	if envLevel := os.Getenv("LOG_LEVEL"); envLevel != "" {
		logLevelStr = strings.ToLower(envLevel)
		cfg.LogLevelSetByEnv = true
	} else if persisted.LogLevel != "" {
		logLevelStr = persisted.LogLevel
	} else {
		logLevelStr = defaultLogLevel
	}
	parsedLevel, err := ValidateLogLevel(logLevelStr)
	if err != nil {
		return nil, fmt.Errorf("LOG_LEVEL: %w", err)
	}
	cfg.LogLevelVar = &slog.LevelVar{}
	cfg.LogLevelVar.Set(parsedLevel)

	if envRegion := os.Getenv("COPYRIGHT_REGION"); envRegion != "" {
		cfg.copyrightRegion = envRegion
		cfg.CopyrightRegionSetByEnv = true
	} else if persisted.CopyrightRegion != "" {
		cfg.copyrightRegion = persisted.CopyrightRegion
	} else {
		cfg.copyrightRegion = defaultCopyrightRegion
	}
	if err := ValidateCopyrightRegion(cfg.copyrightRegion); err != nil {
		return nil, fmt.Errorf("COPYRIGHT_REGION: %w", err)
	}

	if err := libraryconfig.Save(configPath, &libraryconfig.Settings{
		BackupCron:          cfg.backupCron,
		BackupRetentionDays: cfg.backupRetentionDays,
		LogLevel:            logLevelStr,
		CopyrightRegion:     cfg.copyrightRegion,
	}); err != nil {
		return nil, fmt.Errorf("saving %s: %w", configPath, err)
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
