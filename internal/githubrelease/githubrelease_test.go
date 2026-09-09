package githubrelease

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeGitHub serves canned releases + compare responses matching the real
// API's shapes (verified against GitHub's own stable, documented REST
// contract — see this package's own doc comment for why that's a
// reasonable basis to test against without hitting the live network,
// unlike the IMSLP integration elsewhere in this codebase). compareFn maps
// a "base...head" pair to a status string.
func fakeGitHub(t *testing.T, releases []Release, compareFn func(base, head string) string) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/repos/jpcranford/sonneck/releases", func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewEncoder(w).Encode(releases); err != nil {
			t.Fatalf("encoding fake releases response: %v", err)
		}
	})
	mux.HandleFunc("/repos/jpcranford/sonneck/compare/", func(w http.ResponseWriter, r *http.Request) {
		spec := strings.TrimPrefix(r.URL.Path, "/repos/jpcranford/sonneck/compare/")
		parts := strings.SplitN(spec, "...", 2)
		status := compareFn(parts[0], parts[1])
		if err := json.NewEncoder(w).Encode(map[string]string{"status": status}); err != nil {
			t.Fatalf("encoding fake compare response: %v", err)
		}
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func withFakeAPIBase(t *testing.T, url string) {
	t.Helper()
	original := apiBase
	apiBase = url
	t.Cleanup(func() { apiBase = original })
}

func TestCheck_NoReleasesYet(t *testing.T) {
	srv := fakeGitHub(t, []Release{}, nil)
	withFakeAPIBase(t, srv.URL)

	result, err := Check(context.Background(), "abc1234")
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if result.Status != CheckStatusUnknown {
		t.Errorf("Status = %q, want %q (no releases exist to compare against)", result.Status, CheckStatusUnknown)
	}
}

func TestCheck_RunningBuildIsBehindLatestStable(t *testing.T) {
	releases := []Release{{TagName: "v2.4.0", Prerelease: false}, {TagName: "v2.3.1", Prerelease: false}}
	srv := fakeGitHub(t, releases, func(base, head string) string {
		if base == "v2.4.0" {
			return "behind"
		}
		return "identical"
	})
	withFakeAPIBase(t, srv.URL)

	result, err := Check(context.Background(), "deadbeef")
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if result.Status != CheckStatusBehind {
		t.Errorf("Status = %q, want %q", result.Status, CheckStatusBehind)
	}
	if result.AvailableVersion != "v2.4.0" {
		t.Errorf("AvailableVersion = %q, want %q", result.AvailableVersion, "v2.4.0")
	}
}

func TestCheck_RunningBuildIsExactlyTheLatestRelease(t *testing.T) {
	releases := []Release{{TagName: "v2.3.1", Prerelease: false}}
	srv := fakeGitHub(t, releases, func(base, head string) string { return "identical" })
	withFakeAPIBase(t, srv.URL)

	result, err := Check(context.Background(), "a1b2c3d")
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if result.Status != CheckStatusUpToDate {
		t.Errorf("Status = %q, want %q", result.Status, CheckStatusUpToDate)
	}
	if result.MatchedRelease != "v2.3.1" {
		t.Errorf("MatchedRelease = %q, want %q", result.MatchedRelease, "v2.3.1")
	}
}

// TestCheck_PrereleaseAheadOfLatestStable is the exact case the original,
// unrefined design got wrong (master plan's own forward note): a
// pre-release/dev build that's already ahead of the latest official
// release must not be reported as "an update is available."
func TestCheck_PrereleaseAheadOfLatestStable(t *testing.T) {
	releases := []Release{{TagName: "v2.4.0-beta.1", Prerelease: true}, {TagName: "v2.3.1", Prerelease: false}}
	srv := fakeGitHub(t, releases, func(base, head string) string {
		if base == "v2.4.0-beta.1" {
			return "identical"
		}
		return "ahead" // ahead of the latest stable release
	})
	withFakeAPIBase(t, srv.URL)

	result, err := Check(context.Background(), "f9e8d7c")
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if result.Status != CheckStatusAhead {
		t.Errorf("Status = %q, want %q (ahead of latest stable, not a false 'update available')", result.Status, CheckStatusAhead)
	}
	if result.MatchedRelease != "v2.4.0-beta.1" {
		t.Errorf("MatchedRelease = %q, want %q (running commit exactly matches the pre-release tag)", result.MatchedRelease, "v2.4.0-beta.1")
	}
}

func TestCheck_OnlyPrereleasesExistNoStableToCompareAgainst(t *testing.T) {
	releases := []Release{{TagName: "v0.1.0-beta.1", Prerelease: true}}
	srv := fakeGitHub(t, releases, func(base, head string) string { return "ahead" })
	withFakeAPIBase(t, srv.URL)

	result, err := Check(context.Background(), "1234567")
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if result.Status != CheckStatusUnknown {
		t.Errorf("Status = %q, want %q (no stable release exists yet)", result.Status, CheckStatusUnknown)
	}
}

func TestListReleases_DropsDrafts(t *testing.T) {
	srv := fakeGitHub(t, []Release{
		{TagName: "v1.0.0", Draft: false},
		{TagName: "v1.1.0-draft", Draft: true},
	}, nil)
	withFakeAPIBase(t, srv.URL)

	releases, err := ListReleases(context.Background())
	if err != nil {
		t.Fatalf("ListReleases: %v", err)
	}
	if len(releases) != 1 || releases[0].TagName != "v1.0.0" {
		t.Errorf("ListReleases = %+v, want only the non-draft release", releases)
	}
}
