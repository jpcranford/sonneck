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
	DeathYearFallbackOffset int `json:"deathYearFallbackOffset"`

	// RenewalWindowStart/End/UnrenewedYears ("fixed-term" only; en-US is
	// currently the only region that sets them — zero value on every other
	// region, which the renewed-check below treats as "no such window").
	// US renewal follow-up: a work published in this range needed a
	// separate renewal filed during its 28th year to keep protection past
	// that initial UnrenewedYears-year term — Years (95) is the term ONLY
	// once renewed (or automatically, for 1964+, which is why the window
	// ends at 1963); without one it's just UnrenewedYears (28) from
	// CopyrightYear, not Years. See the caller
	// (repo.ResolveCopyrightStatus)'s own comment for how the `renewed`
	// bool this package receives gets its value, and CLAUDE.md's Public
	// domain badge section for the sourcing behind these three numbers.
	RenewalWindowStart int `json:"renewalWindowStart"`
	RenewalWindowEnd   int `json:"renewalWindowEnd"`
	UnrenewedYears     int `json:"unrenewedYears"`

	Note string `json:"note"`
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
//
// LowConfidence (US renewal follow-up) is true only when IsLikelyPD is true
// AND that conclusion rests on an *assumed* non-renewal (renewed=false,
// which the caller sets identically whether the piece was actively
// confirmed not renewed or the question was just never answered — see
// repo.ResolveCopyrightStatus's own comment) rather than a confirmed fact —
// the caller uses this to pick "possibly" vs. "likely" public domain
// wording. Always false for the life-plus rule and for a fixed-term
// conclusion outside the renewal-relevant window (RenewalWindowStart/End),
// since those never depended on an unconfirmed assumption in the first
// place.
type Result struct {
	IsLikelyPD    bool
	ExpiryYear    *int
	LowConfidence bool
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
// renewed (US renewal follow-up) only ever changes anything for the
// "fixed-term" rule when copyrightYear falls inside the region's own
// RenewalWindowStart/End (currently only set for en-US, 1923-1963): a
// renewed work gets the region's normal Years (95, same as always); an
// unrenewed one gets only UnrenewedYears (28) from copyrightYear instead —
// a much shorter term, since a validly renewed pre-1964 US work is
// protected 95 years from its ORIGINAL publication regardless of which
// year within its filing window the renewal itself happened (the exact
// renewal year is a citation detail, not a second date this calculation
// needs — see CLAUDE.md's Public domain badge section for the full
// reasoning and sourcing). Ignored entirely outside that window and for
// the life-plus rule.
//
// Returns an error only for a region key not present in the table — every
// caller is expected to have already validated the configured region at
// startup, so this is a defensive check, not a normal-path failure.
func ComputeLikelyPublicDomain(currentYear int, copyrightYear *int, composerDeathYears []*int, renewed bool, region string) (Result, error) {
	r, ok := regions[region]
	if !ok {
		return Result{}, fmt.Errorf("copyright: unknown region %q", region)
	}

	switch r.Rule {
	case "fixed-term":
		if copyrightYear == nil {
			return Result{}, nil
		}
		inRenewalWindow := r.RenewalWindowStart != 0 &&
			*copyrightYear >= r.RenewalWindowStart && *copyrightYear <= r.RenewalWindowEnd
		if inRenewalWindow && !renewed {
			expiry := *copyrightYear + r.UnrenewedYears
			isPD := currentYear >= expiry
			return Result{IsLikelyPD: isPD, ExpiryYear: &expiry, LowConfidence: isPD}, nil
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
