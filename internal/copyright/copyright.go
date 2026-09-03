// Package copyright implements the Public Domain Badge feature's
// "Likely Public Domain" calculation (design doc §13) — a small, checked-in
// region-rule table, not a live third-party API (none exist built for this
// kind of integration, and the ones that do go stale; see the design
// artifact for the research this repeats). Reviewed against IMSLP's
// "Copyright Made Simple" (https://imslp.org/wiki/IMSLP:Copyright_Made_Simple)
// and its "Public domain" overview (https://imslp.org/wiki/Public_domain) —
// both linked in the README.
//
// This package is intentionally a pure, DB-free unit — repo.ResolveCopyrightStatus
// (internal/repo/copyright.go) is what feeds it real data (effective
// copyright year, composer death years) and applies the sticky/override
// rule on top of its result. Kept separate the same way internal/fuzzy is
// its own package for the fuzzy-search algorithm, or internal/imslp for
// IMSLP's own API quirks — a focused, independently testable unit imported
// by internal/repo, not folded into it.
package copyright

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed regions.json
var regionsJSON []byte

// Region is one entry in the region-rule table — a small, checked-in JSON
// file (regions.json, next to this file) rather than a live API, per the
// design doc's own earlier research. Meant to be reviewed periodically as
// a maintenance task, not treated as permanently correct.
type Region struct {
	Rule string `json:"rule"` // "fixed-term" (publication-year based) or "life-plus" (composer-death-year based)
	// Years is the term length: for "fixed-term", years since
	// CopyrightYear; for "life-plus", years since the composer's death.
	Years int `json:"years"`
	// DeathYearFallbackOffset ("life-plus" only): when no composer death
	// year is known but a copyright year is, approximates death as
	// CopyrightYear + this many years — a labeled approximation, not a
	// precise calculation.
	DeathYearFallbackOffset int    `json:"deathYearFallbackOffset"`
	Note                    string `json:"note"`
}

var regions map[string]Region

func init() {
	if err := json.Unmarshal(regionsJSON, &regions); err != nil {
		panic(fmt.Sprintf("copyright: regions.json failed to parse: %v", err))
	}
}

// ValidRegion reports whether region is a known key in the region table —
// used by internal/config to validate COPYRIGHT_REGION at startup
// (CLAUDE.md > Config: fail fast on a bad env var, not mid-request).
func ValidRegion(region string) bool {
	_, ok := regions[region]
	return ok
}

// Result is computeLikelyPublicDomain's return shape — ExpiryYear is the
// actual year the term runs out (nil when not computable), so callers
// (the badge tooltip, "as of {year}") get more than a bare yes/no.
type Result struct {
	IsLikelyPD bool
	ExpiryYear *int
}

// ComputeLikelyPublicDomain implements the design artifact §3 algorithm.
// composerDeathYears holds one entry per credited composer, each nil if
// that composer's death year isn't on record — a joint work's term runs
// from the LAST surviving co-author's death (real copyright-law rule), so
// this only computes precisely when EVERY entry is non-nil; otherwise it
// falls back to the region's own labeled approximation (or, with neither a
// death year nor a copyright year at all, returns the conservative
// negative — never a guessed public domain).
//
// Returns an error only for a region key not present in the table — every
// caller is expected to have already validated the configured region at
// startup, so this is a defensive check, not a normal-path failure.
func ComputeLikelyPublicDomain(currentYear int, copyrightYear *int, composerDeathYears []*int, region string) (Result, error) {
	r, ok := regions[region]
	if !ok {
		return Result{}, fmt.Errorf("copyright: unknown region %q", region)
	}

	switch r.Rule {
	case "fixed-term":
		if copyrightYear == nil {
			return Result{}, nil
		}
		expiry := *copyrightYear + r.Years
		return Result{IsLikelyPD: currentYear >= expiry, ExpiryYear: &expiry}, nil

	case "life-plus":
		deathYear, ok := lastSurvivingDeathYear(composerDeathYears)
		if !ok {
			if copyrightYear == nil {
				return Result{}, nil
			}
			approx := *copyrightYear + r.DeathYearFallbackOffset
			deathYear = &approx
		}
		expiry := *deathYear + r.Years
		return Result{IsLikelyPD: currentYear >= expiry, ExpiryYear: &expiry}, nil

	default:
		return Result{}, fmt.Errorf("copyright: region %q has unknown rule %q", region, r.Rule)
	}
}

// lastSurvivingDeathYear returns the latest death year, and true, only
// when every composer's death year is known — a single unknown composer
// means the joint work's true term can't be precisely computed at all
// (the last survivor might be exactly the one with no death year on
// record), so this deliberately doesn't fall back to "the max of whatever
// IS known." A composer list with zero entries also can't compute
// precisely (nothing to be sure about).
func lastSurvivingDeathYear(deathYears []*int) (*int, bool) {
	if len(deathYears) == 0 {
		return nil, false
	}
	var max *int
	for _, dy := range deathYears {
		if dy == nil {
			return nil, false
		}
		if max == nil || *dy > *max {
			max = dy
		}
	}
	return max, true
}
