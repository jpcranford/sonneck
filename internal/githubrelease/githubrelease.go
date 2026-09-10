// Package githubrelease backs Admin Settings' Version section — a thin,
// read-only client for GitHub's public releases + compare APIs, hardcoded to this
// project's own repo (never user-configurable — no deployment should ever
// point its own update-check at a fork's release feed instead of
// upstream's).
//
// The REST shapes consumed here (release list: tag_name/prerelease/draft;
// compare: status) are GitHub's stable, versioned, heavily-documented
// public API — a meaningfully different risk profile than the IMSLP
// scraping elsewhere in this codebase (internal/imslp), which really does
// need live re-verification against undocumented HTML/wikitext structure.
// Still worth a real check against an actual release once one exists,
// rather than trusting this blind forever — see CLAUDE.md's own note on
// this package.
package githubrelease

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

const (
	Owner = "jpcranford"
	Repo  = "sonneck"
)

// apiBase is a var, not a const, so tests can point it at an
// httptest.Server instead of the real network — GitHub's unauthenticated
// rate limit is both shared and easily exhausted, a poor fit for a test
// suite that runs repeatedly.
var apiBase = "https://api.github.com"

var httpClient = &http.Client{Timeout: 10 * time.Second}

// Release is the slice of GitHub's release object this package actually
// uses — every other field (body, assets, author, ...) is irrelevant to
// "which tag, if any, points at this commit."
type Release struct {
	TagName    string `json:"tag_name"`
	Prerelease bool   `json:"prerelease"`
	Draft      bool   `json:"draft"`
}

// ListReleases fetches every release (GitHub returns newest-created-first
// by default), including pre-releases but not drafts (a draft isn't a
// real, checked-out-able tag yet).
func ListReleases(ctx context.Context) ([]Release, error) {
	url := fmt.Sprintf("%s/repos/%s/%s/releases", apiBase, Owner, Repo)
	var all []Release
	if err := getJSON(ctx, url, &all); err != nil {
		return nil, err
	}
	releases := make([]Release, 0, len(all))
	for _, r := range all {
		if !r.Draft {
			releases = append(releases, r)
		}
	}
	return releases, nil
}

// CompareStatus is GitHub's own compare-API vocabulary — "ahead"/"behind"
// are from base's perspective looking at head (behind means head is
// missing commits base has; ahead means head has commits base doesn't).
type CompareStatus string

const (
	StatusIdentical CompareStatus = "identical"
	StatusAhead     CompareStatus = "ahead"
	StatusBehind    CompareStatus = "behind"
	StatusDiverged  CompareStatus = "diverged"
)

// Compare reports how head (typically a commit SHA) relates to base
// (typically a release tag) — GET /compare/{base}...{head}.
func Compare(ctx context.Context, base, head string) (CompareStatus, error) {
	url := fmt.Sprintf("%s/repos/%s/%s/compare/%s...%s", apiBase, Owner, Repo, base, head)
	var resp struct {
		Status string `json:"status"`
	}
	if err := getJSON(ctx, url, &resp); err != nil {
		return "", err
	}
	return CompareStatus(resp.Status), nil
}

// CheckResult is the outcome of comparing a running commit against this
// project's own releases — Admin Settings' Version section reads this
// directly (via internal/handlers' own cached wrapper, see that package).
type CheckResult struct {
	// MatchedRelease is the tag name of a release that points at exactly
	// this commit, if any — "" means the running build isn't itself a
	// tagged release (a dev build, or a commit past the last tag).
	MatchedRelease string
	// Status is relative to the latest non-prerelease release specifically
	// — "upToDate" (identical to it), "ahead" (contains it and more, e.g.
	// a pre-release or dev build cut after that release), "behind" (a real
	// update exists, AvailableVersion names it), or "unknown" (no releases
	// exist yet, or GitHub's compare returned something this mapping
	// doesn't have a confident answer for — "diverged", a rewritten-history
	// edge case).
	Status           string
	AvailableVersion string
}

const (
	CheckStatusUpToDate = "upToDate"
	CheckStatusAhead    = "ahead"
	CheckStatusBehind   = "behind"
	CheckStatusUnknown  = "unknown"
)

// Check determines runningSHA's relationship to this repo's releases.
// Bounded to at most 1 releases-list call + 2 compare calls (the latest
// release overall, plus the latest non-prerelease release if different) —
// never one compare per historical tag, which would both cost unbounded
// API calls and need a separate tag-to-commit resolution step (annotated
// vs. lightweight tags dereference differently; compare sidesteps that
// entirely by accepting a tag name directly as one side of the diff).
func Check(ctx context.Context, runningSHA string) (*CheckResult, error) {
	releases, err := ListReleases(ctx)
	if err != nil {
		return nil, err
	}
	if len(releases) == 0 {
		return &CheckResult{Status: CheckStatusUnknown}, nil
	}

	latestOverall := releases[0]
	var latestStable *Release
	for i := range releases {
		if !releases[i].Prerelease {
			latestStable = &releases[i]
			break
		}
	}

	result := &CheckResult{Status: CheckStatusUnknown}

	overallStatus, err := Compare(ctx, latestOverall.TagName, runningSHA)
	if err != nil {
		return nil, err
	}
	if overallStatus == StatusIdentical {
		result.MatchedRelease = latestOverall.TagName
	}

	if latestStable == nil {
		// Every release so far is a pre-release — nothing to compare
		// "genuinely behind" against yet.
		return result, nil
	}

	var stableStatus CompareStatus
	if latestStable.TagName == latestOverall.TagName {
		stableStatus = overallStatus
	} else {
		stableStatus, err = Compare(ctx, latestStable.TagName, runningSHA)
		if err != nil {
			return nil, err
		}
		if stableStatus == StatusIdentical && result.MatchedRelease == "" {
			result.MatchedRelease = latestStable.TagName
		}
	}

	switch stableStatus {
	case StatusIdentical:
		result.Status = CheckStatusUpToDate
	case StatusAhead:
		result.Status = CheckStatusAhead
	case StatusBehind:
		result.Status = CheckStatusBehind
		result.AvailableVersion = latestStable.TagName
	default: // StatusDiverged, or any future value GitHub adds
		result.Status = CheckStatusUnknown
	}
	return result, nil
}

func getJSON(ctx context.Context, url string, dest any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("building request: %w", err)
	}
	// GitHub rejects any request with no User-Agent outright; Accept pins
	// the response shape to the REST API version this package was written
	// against, per GitHub's own recommendation.
	req.Header.Set("User-Agent", "sonneck-update-check")
	req.Header.Set("Accept", "application/vnd.github+json")

	res, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("requesting %s: %w", url, err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: unexpected status %d", url, res.StatusCode)
	}
	if err := json.NewDecoder(res.Body).Decode(dest); err != nil {
		return fmt.Errorf("decoding response from %s: %w", url, err)
	}
	return nil
}
