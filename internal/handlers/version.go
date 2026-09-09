package handlers

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/jpcranford/sonneck/internal/api"
	"github.com/jpcranford/sonneck/internal/githubrelease"
	"github.com/jpcranford/sonneck/internal/models"
)

// versionCacheTTL bounds how often "Check for updates" actually hits
// GitHub — this control can get clicked repeatedly over the weeks between
// releases (someone just checking in), and GitHub's unauthenticated rate
// limit is both shared and modest.
const versionCacheTTL = time.Hour

// versionCache holds the last real githubrelease.Check result — populated
// once by a background goroutine at server startup (New, below) so
// GET /api/admin/version never blocks page load on a live network call,
// and refreshed either by that TTL lapsing or an explicit "Check for
// updates" click (handleCheckForUpdates, which always bypasses the TTL).
type versionCache struct {
	mu        sync.Mutex
	result    *githubrelease.CheckResult
	checkedAt time.Time
}

func (v *versionCache) get() (*githubrelease.CheckResult, time.Time) {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.result, v.checkedAt
}

func (v *versionCache) set(result *githubrelease.CheckResult) time.Time {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.result = result
	v.checkedAt = time.Now()
	return v.checkedAt
}

func (v *versionCache) stale() bool {
	_, checkedAt := v.get()
	return checkedAt.IsZero() || time.Since(checkedAt) > versionCacheTTL
}

// devBuildSHA is main.go's own default for the ldflags-overridable
// buildSHA var — every plain `go run`/`go build` invocation straight from
// the repo (this whole session's own dev loop included) keeps this
// literal value, since nothing injects a real commit SHA outside the
// Dockerfile's build step. isDevBuild is the one place that sentinel is
// interpreted; nothing else in this package should compare BuildSHA
// against a literal string.
const devBuildSHA = "dev"

func (s *Server) isDevBuild() bool {
	return s.BuildSHA == "" || s.BuildSHA == devBuildSHA
}

// refreshVersionCache runs one real githubrelease.Check and stores it,
// logging (not failing) a real GitHub-side error — matching the IMSLP
// integration's own established "external, best-effort, non-fatal" WARN
// convention (internal/imslp), since a stale/missing update-check result
// never blocks anything else in the app. A no-op for a dev build (no real
// commit SHA to compare against GitHub at all) — never even attempts the
// network call, so a plain `go run` during development doesn't spend a
// doomed request against the compare API every time Admin Settings loads.
func (s *Server) refreshVersionCache(ctx context.Context) {
	if s.isDevBuild() {
		return
	}
	result, err := githubrelease.Check(ctx, s.BuildSHA)
	if err != nil {
		s.Logger.Warn("version check failed", "error", err)
		return
	}
	s.versionCache.set(result)
}

func (s *Server) versionResponse() api.VersionResponse {
	resp := api.VersionResponse{RunningSHA: s.BuildSHA, RunningDate: s.BuildDate, RunningFromSource: s.isDevBuild()}
	result, checkedAt := s.versionCache.get()
	if result == nil {
		return resp
	}
	if result.MatchedRelease != "" {
		resp.MatchedRelease = &result.MatchedRelease
	}
	resp.CheckStatus = &result.Status
	if result.AvailableVersion != "" {
		resp.AvailableVersion = &result.AvailableVersion
	}
	checkedAtStr := checkedAt.UTC().Format(time.RFC3339)
	resp.CheckedAt = &checkedAtStr
	return resp
}

// handleGetVersion never itself blocks on a GitHub call — opening Admin
// Settings always gets an immediate response, reading whatever's already
// cached (possibly nothing yet). The very first time this is ever called
// in the process's lifetime (cache still empty), it kicks off exactly one
// background refresh so the *next* page view usually has something real to
// show, without making every single request pay for a live network
// round-trip and without querying GitHub on every server start regardless
// of whether Admin Settings is ever opened (e.g. every test that
// constructs a Server via New, which must never hit the real network).
func (s *Server) handleGetVersion(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, models.PermissionAdmin); !ok {
		return
	}
	if result, _ := s.versionCache.get(); result == nil && !s.isDevBuild() {
		go s.refreshVersionCache(context.Background())
	}
	api.WriteData(w, http.StatusOK, s.versionResponse())
}

// handleCheckForUpdates is the mockup's actual "Check for updates" button
// action. Only performs a real GitHub round-trip if the cache is stale —
// the mockup's own copy is explicit about this ("cached for a while, so
// checking again soon reuses this result instead of asking GitHub every
// time"): a click within the TTL window is a cheap cache read, not a new
// network call, exactly the concern that motivated caching at all (this
// button can get pressed repeatedly over the weeks between releases).
func (s *Server) handleCheckForUpdates(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, models.PermissionAdmin); !ok {
		return
	}
	if s.versionCache.stale() {
		s.refreshVersionCache(r.Context())
	}
	api.WriteData(w, http.StatusOK, s.versionResponse())
}
