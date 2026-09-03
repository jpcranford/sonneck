package copyright_test

import (
	"testing"

	"github.com/jpcranford/sonneck/internal/copyright"
)

func intPtr(i int) *int { return &i }

// US renewal follow-up: a renewed pre-1964 work still gets the full 95-year
// term from copyright.Year — the new renewal logic must not change this,
// otherwise-existing case.
func TestComputeLikelyPublicDomain_RenewedPre1964GetsFullTerm(t *testing.T) {
	result, err := copyright.ComputeLikelyPublicDomain(2026, intPtr(1931), nil, true, "en-US")
	if err != nil {
		t.Fatalf("ComputeLikelyPublicDomain: %v", err)
	}
	wantExpiry := 1931 + 95 // 2026
	if result.ExpiryYear == nil || *result.ExpiryYear != wantExpiry {
		t.Errorf("ExpiryYear = %v, want %d", result.ExpiryYear, wantExpiry)
	}
	if !result.IsLikelyPD {
		t.Errorf("IsLikelyPD = false, want true (2026 >= %d)", wantExpiry)
	}
	if result.LowConfidence {
		t.Errorf("LowConfidence = true, want false (renewal was confirmed, not assumed)")
	}
}

// An unrenewed pre-1964 work only gets 28 years, not 95 — the actual new
// behavior this follow-up exists to add. 1962 + 28 = 1990, long elapsed by
// 2026, so this is public domain, but only via the unconfirmed-non-renewal
// assumption, so LowConfidence must be true.
func TestComputeLikelyPublicDomain_UnrenewedPre1964GetsShortTerm(t *testing.T) {
	result, err := copyright.ComputeLikelyPublicDomain(2026, intPtr(1962), nil, false, "en-US")
	if err != nil {
		t.Fatalf("ComputeLikelyPublicDomain: %v", err)
	}
	wantExpiry := 1962 + 28 // 1990
	if result.ExpiryYear == nil || *result.ExpiryYear != wantExpiry {
		t.Errorf("ExpiryYear = %v, want %d", result.ExpiryYear, wantExpiry)
	}
	if !result.IsLikelyPD {
		t.Errorf("IsLikelyPD = false, want true (2026 >= %d)", wantExpiry)
	}
	if !result.LowConfidence {
		t.Errorf("LowConfidence = false, want true (PD conclusion rests on an assumed, not confirmed, non-renewal)")
	}
}

// An unrenewed pre-1964 work whose short 28-year term genuinely hasn't
// elapsed yet is NOT public domain — confirms the short term is a real
// term with its own expiry, not just "always PD," and that LowConfidence
// only applies once it actually contributes to a PD conclusion.
func TestComputeLikelyPublicDomain_UnrenewedButStillWithin28Years(t *testing.T) {
	result, err := copyright.ComputeLikelyPublicDomain(1970, intPtr(1962), nil, false, "en-US")
	if err != nil {
		t.Fatalf("ComputeLikelyPublicDomain: %v", err)
	}
	if result.IsLikelyPD {
		t.Errorf("IsLikelyPD = true, want false (1970 < 1962+28=1990)")
	}
	if result.LowConfidence {
		t.Errorf("LowConfidence = true, want false (not a PD conclusion at all yet)")
	}
}

// Outside the renewal window (1964+), the renewed flag must have no effect
// at all — this era got automatic renewal, so it always uses the region's
// normal 95-year term regardless of what the caller passes.
func TestComputeLikelyPublicDomain_OutsideWindowIgnoresRenewedFlag(t *testing.T) {
	renewed, err := copyright.ComputeLikelyPublicDomain(2026, intPtr(1970), nil, true, "en-US")
	if err != nil {
		t.Fatalf("ComputeLikelyPublicDomain (renewed=true): %v", err)
	}
	notRenewed, err := copyright.ComputeLikelyPublicDomain(2026, intPtr(1970), nil, false, "en-US")
	if err != nil {
		t.Fatalf("ComputeLikelyPublicDomain (renewed=false): %v", err)
	}
	if *renewed.ExpiryYear != *notRenewed.ExpiryYear || *renewed.ExpiryYear != 1970+95 {
		t.Errorf("expiry years differ by renewed flag outside the window: renewed=%d, notRenewed=%d, want both %d",
			*renewed.ExpiryYear, *notRenewed.ExpiryYear, 1970+95)
	}
	if renewed.LowConfidence || notRenewed.LowConfidence {
		t.Errorf("LowConfidence should never be true outside the renewal window")
	}
}

// Also before the window (pre-1923) — same "renewed flag ignored" guarantee
// at the other boundary.
func TestComputeLikelyPublicDomain_BeforeWindowIgnoresRenewedFlag(t *testing.T) {
	result, err := copyright.ComputeLikelyPublicDomain(2026, intPtr(1900), nil, false, "en-US")
	if err != nil {
		t.Fatalf("ComputeLikelyPublicDomain: %v", err)
	}
	wantExpiry := 1900 + 95
	if *result.ExpiryYear != wantExpiry {
		t.Errorf("ExpiryYear = %d, want %d (95-year term, not the 28-year unrenewed one)", *result.ExpiryYear, wantExpiry)
	}
	if result.LowConfidence {
		t.Errorf("LowConfidence = true, want false (outside the renewal window)")
	}
}

// Boundary years: the window is inclusive on both ends (1923 and 1963).
func TestComputeLikelyPublicDomain_WindowBoundaries(t *testing.T) {
	for _, year := range []int{1923, 1963} {
		result, err := copyright.ComputeLikelyPublicDomain(2026, intPtr(year), nil, false, "en-US")
		if err != nil {
			t.Fatalf("year %d: ComputeLikelyPublicDomain: %v", year, err)
		}
		wantExpiry := year + 28
		if *result.ExpiryYear != wantExpiry {
			t.Errorf("year %d: ExpiryYear = %d, want %d (should be in the renewal window)", year, *result.ExpiryYear, wantExpiry)
		}
	}
	for _, year := range []int{1922, 1964} {
		result, err := copyright.ComputeLikelyPublicDomain(2026, intPtr(year), nil, false, "en-US")
		if err != nil {
			t.Fatalf("year %d: ComputeLikelyPublicDomain: %v", year, err)
		}
		wantExpiry := year + 95
		if *result.ExpiryYear != wantExpiry {
			t.Errorf("year %d: ExpiryYear = %d, want %d (should be outside the renewal window)", year, *result.ExpiryYear, wantExpiry)
		}
	}
}

// The renewal logic is en-US (fixed-term) specific — a life-plus region
// must ignore the renewed flag entirely, even for a copyrightYear that
// would fall inside en-US's own renewal window if it applied there.
func TestComputeLikelyPublicDomain_LifePlusRegionIgnoresRenewedFlag(t *testing.T) {
	deathYears := []*int{intPtr(1950)}
	renewed, err := copyright.ComputeLikelyPublicDomain(2026, intPtr(1940), deathYears, true, "eu-generic")
	if err != nil {
		t.Fatalf("ComputeLikelyPublicDomain (renewed=true): %v", err)
	}
	notRenewed, err := copyright.ComputeLikelyPublicDomain(2026, intPtr(1940), deathYears, false, "eu-generic")
	if err != nil {
		t.Fatalf("ComputeLikelyPublicDomain (renewed=false): %v", err)
	}
	if *renewed.ExpiryYear != *notRenewed.ExpiryYear || *renewed.ExpiryYear != 1950+70 {
		t.Errorf("life-plus region's expiry should be unaffected by renewed: got renewed=%d, notRenewed=%d, want both %d",
			*renewed.ExpiryYear, *notRenewed.ExpiryYear, 1950+70)
	}
}
