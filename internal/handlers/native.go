package handlers

import (
	"net/http"
	"strings"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/models"
	"github.com/jpcranford/sonneck/internal/nativeconfig"
	"github.com/jpcranford/sonneck/internal/netinfo"
	"github.com/jpcranford/sonneck/internal/repo"
)

// NativeOptions carries cmd/sonneck-desktop's native-only capabilities into
// Server (project_wails_native_app_investigation memory's Phase 7) — one
// small optional struct (nil for Docker/every test/CLI-subcommand
// construction) rather than more positional params on New, which was
// already long. ChooseFolder/RequestRestart are plain closures, not a
// Wails dependency leaking into this package: cmd/sonneck-desktop owns the
// actual runtime.OpenDirectoryDialog/runtime.Quit calls (and the wails.Run
// context those need) entirely on its own side, so internal/handlers never
// imports wailsapp/wails at all.
type NativeOptions struct {
	// SettingsPath is nativeconfig.DefaultPath()'s resolved value, passed
	// in rather than re-resolved here so every read/write this package
	// does agrees with whatever main.go itself loaded at boot.
	SettingsPath string
	// AppliedShareOnNetwork is the ShareOnNetwork value this process
	// actually booted with (captured once, before handlers.New) — the
	// "live" half of the applied/pending pair GET /api/native/settings
	// returns; only a real restart ever changes it.
	AppliedShareOnNetwork bool
	// ChooseFolder opens a real native OS folder dialog (currentPath
	// pre-selects it) and returns the chosen absolute path, or "" if the
	// user canceled — never an error for a plain cancel.
	ChooseFolder func(currentPath string) (string, error)
	// RequestRestart asks the running process to relaunch a fresh copy of
	// itself and then exit — cmd/sonneck-desktop's own responsibility to
	// do this gracefully (a real Wails runtime.Quit so deferred cleanup,
	// especially db.Close(), actually runs) rather than a raw os.Exit.
	RequestRestart func() error
}

// requireNativeAccess is the shared gate for every /api/native/* handler.
// 404s outright on a Docker build (BuildTarget != "native", or the more
// defensive Native == nil — shouldn't happen together with BuildTarget ==
// "native" in real use, but a test could construct one without the other),
// since none of this is meaningful there. Otherwise applies one of two
// very different access rules depending on install state: open, no
// permission check at all, while first-launch hasn't completed yet (the
// First Launch folder step's own write path, reachable before any session
// can exist — same posture as POST /api/setup/complete); admin-gated
// exactly like every other Admin Settings endpoint once it has. Every
// /api/native/* path is also in middleware.go's preFirstLaunchOnlyPaths,
// so authMiddleware never demands a session for them pre-launch either —
// this function is what makes that safe, re-deriving "is setup genuinely
// still incomplete" itself rather than trusting the client or the route
// table alone.
func (s *Server) requireNativeAccess(w http.ResponseWriter, r *http.Request) bool {
	if s.BuildTarget != "native" || s.Native == nil {
		api.WriteError(w, http.StatusNotFound, api.CodeNotFound, "no such endpoint")
		return false
	}
	settings, err := repo.GetServerSettings(r.Context(), s.DB)
	if err != nil {
		s.writeError(w, err)
		return false
	}
	if settings.FirstLaunchCompletedAt == nil {
		return true
	}
	_, ok := s.requirePermission(w, r, models.PermissionAdmin)
	return ok
}

func (s *Server) nativeSettingsResponse(settings *nativeconfig.Settings) (api.NativeSettingsResponse, error) {
	ips, err := netinfo.LocalIPs()
	if err != nil {
		return api.NativeSettingsResponse{}, err
	}
	resp := api.NativeSettingsResponse{
		ShareOnNetwork:        settings.ShareOnNetwork,
		AppliedShareOnNetwork: s.Native.AppliedShareOnNetwork,
		LibraryPath:           s.Cfg.DataDir,
		Port:                  s.Cfg.Port,
		LocalIPs:              ips,
	}
	if settings.PendingLibraryPath != "" {
		resp.PendingLibraryPath = &settings.PendingLibraryPath
	}
	return resp, nil
}

// handleGetNativeSettings is Admin Settings' Share on Network/Library
// location cards' own read — see api.NativeSettingsResponse's doc comment
// for exactly what applied vs. pending/persisted mean here.
func (s *Server) handleGetNativeSettings(w http.ResponseWriter, r *http.Request) {
	if !s.requireNativeAccess(w, r) {
		return
	}
	settings, err := nativeconfig.Load(s.Native.SettingsPath)
	if err != nil {
		s.writeError(w, err)
		return
	}
	resp, err := s.nativeSettingsResponse(settings)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, resp)
}

// handleUpdateNativeSettings is a partial update, deliberately not this
// app's usual full-replace PATCH (see UpdateNativeSettingsRequest's own
// doc comment for why): ShareOnNetwork persists immediately whenever
// present, independent of LibraryPath — Phase 4's locked "persisting is
// decoupled from applying" design means the toggle has to write through to
// disk on every click, not just when the whole card gets saved. Neither
// field ever live-applies here; both only take effect via
// nativeconfig.ApplyPendingLibraryMove / a fresh ListenWithFallback call at
// the next real process start (RequestRestart, handleNativeRestart below).
func (s *Server) handleUpdateNativeSettings(w http.ResponseWriter, r *http.Request) {
	if !s.requireNativeAccess(w, r) {
		return
	}

	var req api.UpdateNativeSettingsRequest
	if err := decodeJSON(r, &req); err != nil {
		api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "invalid request body: "+err.Error())
		return
	}

	settings, err := nativeconfig.Load(s.Native.SettingsPath)
	if err != nil {
		s.writeError(w, err)
		return
	}

	if req.ShareOnNetwork != nil {
		settings.ShareOnNetwork = *req.ShareOnNetwork
	}
	if req.LibraryPath != nil {
		path := strings.TrimSpace(*req.LibraryPath)
		if path == "" {
			api.WriteError(w, http.StatusBadRequest, api.CodeValidationError, "libraryPath must not be blank")
			return
		}
		settings.PendingLibraryPath = path
		settings.PendingMoveExisting = req.MoveExisting
	}

	if err := nativeconfig.Save(s.Native.SettingsPath, settings); err != nil {
		s.writeError(w, err)
		return
	}

	resp, err := s.nativeSettingsResponse(settings)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, resp)
}

// handleChooseNativeFolder opens a real native OS folder dialog (never a
// mock/fixture — see NativeOptions.ChooseFolder's own doc comment) and
// returns the chosen path, pre-selecting whatever this process is
// currently using as its own library folder.
func (s *Server) handleChooseNativeFolder(w http.ResponseWriter, r *http.Request) {
	if !s.requireNativeAccess(w, r) {
		return
	}
	path, err := s.Native.ChooseFolder(s.Cfg.DataDir)
	if err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, api.ChooseFolderResponse{Path: path})
}

// handleNativeRestart is the "Restart Now" button's real backend — a
// genuine relaunch (see NativeOptions.RequestRestart's own doc comment),
// not just instructive text asking the user to quit and reopen the app
// themselves.
func (s *Server) handleNativeRestart(w http.ResponseWriter, r *http.Request) {
	if !s.requireNativeAccess(w, r) {
		return
	}
	if err := s.Native.RequestRestart(); err != nil {
		s.writeError(w, err)
		return
	}
	api.WriteData(w, http.StatusOK, map[string]bool{"ok": true})
}
