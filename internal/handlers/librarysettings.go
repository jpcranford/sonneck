package handlers

import (
	"net/http"
	"path/filepath"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/config"
	"github.com/jpcranford/sonneck/internal/libraryconfig"
	"github.com/jpcranford/sonneck/internal/models"
)

// handleGetLibrarySettings is Admin Settings' Library Settings card —
// current effective value + envSet flag for each of the 4 fields.
func (s *Server) handleGetLibrarySettings(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, models.PermissionAdmin); !ok {
		return
	}
	api.WriteData(w, http.StatusOK, s.librarySettingsResponse())
}

func (s *Server) librarySettingsResponse() api.LibrarySettingsResponse {
	return api.LibrarySettingsResponse{
		BackupCron:                  s.Cfg.BackupCron(),
		BackupCronSetByEnv:          s.Cfg.BackupCronSetByEnv,
		BackupRetentionDays:         s.Cfg.BackupRetentionDays(),
		BackupRetentionDaysSetByEnv: s.Cfg.BackupRetentionDaysSetByEnv,
		LogLevel:                    s.Cfg.LogLevel(),
		LogLevelSetByEnv:            s.Cfg.LogLevelSetByEnv,
		CopyrightRegion:             s.Cfg.CopyrightRegion(),
		CopyrightRegionSetByEnv:     s.Cfg.CopyrightRegionSetByEnv,
	}
}

// handleUpdateLibrarySettings validates, persists (internal/libraryconfig,
// DATA_DIR/config.yml — not SQLite, a deliberate choice, see the
// DTO's own doc comment), and live-applies each of the 4 fields: a changed
// backupCron reschedules the actual running cron job
// (Server.BackupScheduler), backupRetentionDays/copyrightRegion are plain
// live setters on *config.Config, and logLevel updates the shared
// *slog.LevelVar every logger in the process already reads from — no
// restart needed for any of the four.
func (s *Server) handleUpdateLibrarySettings(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, models.PermissionAdmin); !ok {
		return
	}

	var req api.UpdateLibrarySettingsRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}

	// Full-replace body, but a field currently env-set is only accepted if
	// the submitted value matches what's already in effect — the frontend
	// never renders that field as editable, so it always echoes the
	// current value back; a genuine attempted change is a real conflict.
	if s.Cfg.BackupCronSetByEnv && req.BackupCron != s.Cfg.BackupCron() {
		api.WriteError(w, http.StatusConflict, api.CodeConflict, "backupCron is set by environment variable (BACKUP_CRON)")
		return
	}
	if s.Cfg.BackupRetentionDaysSetByEnv && req.BackupRetentionDays != s.Cfg.BackupRetentionDays() {
		api.WriteError(w, http.StatusConflict, api.CodeConflict, "backupRetentionDays is set by environment variable (BACKUP_RETENTION_DAYS)")
		return
	}
	if s.Cfg.LogLevelSetByEnv && req.LogLevel != s.Cfg.LogLevel() {
		api.WriteError(w, http.StatusConflict, api.CodeConflict, "logLevel is set by environment variable (LOG_LEVEL)")
		return
	}
	if s.Cfg.CopyrightRegionSetByEnv && req.CopyrightRegion != s.Cfg.CopyrightRegion() {
		api.WriteError(w, http.StatusConflict, api.CodeConflict, "copyrightRegion is set by environment variable (COPYRIGHT_REGION)")
		return
	}

	if err := config.ValidateBackupCron(req.BackupCron); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "backupCron: "+err.Error())
		return
	}
	if err := config.ValidateBackupRetentionDays(req.BackupRetentionDays); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "backupRetentionDays: "+err.Error())
		return
	}
	parsedLevel, err := config.ValidateLogLevel(req.LogLevel)
	if err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "logLevel: "+err.Error())
		return
	}
	if err := config.ValidateCopyrightRegion(req.CopyrightRegion); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "copyrightRegion: "+err.Error())
		return
	}

	configPath := filepath.Join(s.Cfg.DataDir, "config.yml")
	if err := libraryconfig.Save(configPath, &libraryconfig.Settings{
		BackupCron:          req.BackupCron,
		BackupRetentionDays: req.BackupRetentionDays,
		LogLevel:            req.LogLevel,
		CopyrightRegion:     req.CopyrightRegion,
	}); err != nil {
		s.writeError(w, err)
		return
	}

	// Live-apply — persisted above already, so a failure past this point
	// only affects the running process's current behavior, never
	// durability, and there's nothing left that could fail anyway (a
	// cron.AddFunc on an expression ValidateBackupCron already accepted
	// can't itself fail).
	cronChanged := req.BackupCron != s.Cfg.BackupCron()
	s.Cfg.SetBackupCron(req.BackupCron)
	s.Cfg.SetBackupRetentionDays(req.BackupRetentionDays)
	s.Cfg.SetCopyrightRegion(req.CopyrightRegion)
	s.Cfg.LogLevelVar.Set(parsedLevel)
	if cronChanged && s.BackupScheduler != nil {
		if err := s.BackupScheduler.Reschedule(req.BackupCron, s.DB, s.Cfg.BackupDir, s.Cfg, s.Logger); err != nil {
			s.writeError(w, err)
			return
		}
	}

	api.WriteData(w, http.StatusOK, s.librarySettingsResponse())
}
