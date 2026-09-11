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

// releaseIdentity holds whether this running process's own commit matches
// a tagged release — resolved at most once per process lifetime (the first
// real GET /api/admin/version call after boot triggers it) and never
// invalidated again: the running binary's own commit can't change while
// it's running, so there's nothing to ever re-check here. Deliberately
// holds no "Check for updates" state at all — handleCheckForUpdates below
// never persists its own ahead/behind result anywhere, so a page reload
// always finds that control starting fresh as a plain button rather than
// restoring a previous result.
type releaseIdentity struct {
	mu             sync.Mutex
	resolved       bool
	matchedRelease string
}

func (c *releaseIdentity) get() (resolved bool, matchedRelease string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.resolved, c.matchedRelease
}

func (c *releaseIdentity) set(matchedRelease string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.resolved = true
	c.matchedRelease = matchedRelease
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

// resolveReleaseIdentity runs one real githubrelease.Check purely to learn
// whether the running commit matches a tagged release, logging (not
// failing) a real GitHub-side error — matching the IMSLP integration's own
// established "external, best-effort, non-fatal" WARN convention, since a
// missing identity match never blocks anything else in the app. A no-op
// for a dev build (no real commit SHA to compare against GitHub at all) —
// never even attempts the network call, so a plain `go run` during
// development doesn't spend a doomed request against the compare API every
// time Admin Settings loads.
func (s *Server) resolveReleaseIdentity(ctx context.Context) {
	if s.isDevBuild() {
		return
	}
	result, err := githubrelease.Check(ctx, s.BuildSHA)
	if err != nil {
		s.Logger.Warn("release identity check failed", "error", err)
		return
	}
	s.releaseIdentity.set(result.MatchedRelease)
}

// versionResponse carries only the running build's own identity — never
// "Check for updates" state (CheckStatus/AvailableVersion/CheckedAt stay
// nil here always). handleCheckForUpdates fills those in on its own
// response directly, never through this shared builder, so GET
// /api/admin/version can't ever surface a stale check result.
func (s *Server) versionResponse() api.VersionResponse {
	resp := api.VersionResponse{RunningSHA: s.BuildSHA, RunningDate: s.BuildDate, RunningFromSource: s.isDevBuild()}
	if _, matchedRelease := s.releaseIdentity.get(); matchedRelease != "" {
		resp.MatchedRelease = &matchedRelease
	}
	return resp
}

// handleGetVersion never itself blocks on a GitHub call — opening Admin
// Settings always gets an immediate response, reading whatever identity is
// already resolved (possibly nothing yet). The very first time this is
// ever called in the process's lifetime (identity not yet resolved), it
// kicks off exactly one background resolution so the *next* page view
// usually has a real release identity to show, without making every
// single request pay for a live network round-trip and without querying
// GitHub on every server start regardless of whether Admin Settings is
// ever opened (e.g. every test that constructs a Server via New, which
// must never hit the real network).
func (s *Server) handleGetVersion(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, models.PermissionAdmin); !ok {
		return
	}
	if resolved, _ := s.releaseIdentity.get(); !resolved && !s.isDevBuild() {
		go s.resolveReleaseIdentity(context.Background())
	}
	api.WriteData(w, http.StatusOK, s.versionResponse())
}

// handleCheckForUpdates is the mockup's actual "Check for updates" button
// action — always performs a real, fresh GitHub round-trip, deliberately
// uncached. This is a rare, explicit, manually-triggered admin action, not
// a background poll, so there's no meaningful rate-limit concern to cache
// against. The result is written directly into this one response and never
// persisted anywhere the server remembers across requests, so a page
// reload (a fresh GET /api/admin/version) never sees it — "Check for
// updates" always starts over as a plain button after a reload, even
// though its own MatchedRelease finding does opportunistically backfill
// the longer-lived releaseIdentity cache above, same as a background
// resolution would.
func (s *Server) handleCheckForUpdates(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, models.PermissionAdmin); !ok {
		return
	}
	resp := s.versionResponse()
	if s.isDevBuild() {
		api.WriteData(w, http.StatusOK, resp)
		return
	}
	result, err := githubrelease.Check(r.Context(), s.BuildSHA)
	if err != nil {
		s.Logger.Warn("check for updates failed", "error", err)
		api.WriteData(w, http.StatusOK, resp)
		return
	}
	if result.MatchedRelease != "" {
		s.releaseIdentity.set(result.MatchedRelease)
		resp.MatchedRelease = &result.MatchedRelease
	}
	resp.CheckStatus = &result.Status
	if result.AvailableVersion != "" {
		resp.AvailableVersion = &result.AvailableVersion
	}
	checkedAtStr := time.Now().UTC().Format(time.RFC3339)
	resp.CheckedAt = &checkedAtStr
	api.WriteData(w, http.StatusOK, resp)
}
