package repo

import (
	"context"
	"time"

	"github.com/jpcranford/sonneck/internal/copyright"
)

// ResolveCopyrightStatus computes eff's effective (badge-displayed)
// copyright status — the design artifact's "resolution order" (§1),
// applied on top of the raw explicit pick ResolveEffective already
// resolved into eff.CopyrightStatus.
//
// An explicit pick doesn't stop the live calculation from running — it
// always runs. What differs is which two states it's allowed to override:
// 'copyleft'/'inCopyright' describe the piece's *current* legal status,
// which can genuinely go stale (the term quietly expires while nothing in
// the app changes), so the calculation can push either of them forward to
// 'likelyPublicDomain' — never backward. 'publicDomain'/'likelyPublicDomain'
// both mean "nothing is protecting this anymore," which can't become false
// again later (a term doesn't un-expire), so once either is the effective
// status the calculation has nothing left to override.
//
// This is a read-time correction only, never a database write (CLAUDE.md's
// "resolve, don't denormalize" convention, the same one book-inheritance
// itself runs on) — the stored copyright_status column keeps whatever was
// actually picked; every consumer (badge, citation, the reopened dropdown)
// calls this function and sees the corrected value instead.
//
// expiryYear is only ever non-nil for the two "as of {year}" tooltip
// states (publicDomain/likelyPublicDomain) — an explicit 'copyleft'/
// 'inCopyright' pick the calculation hasn't (yet) overridden shows no year,
// matching the badge design (design artifact §5).
//
// calculatedLikelyPD is the *raw* calculation's own conclusion — what
// calc.IsLikelyPD says — independent of any explicit override, including
// the sticky publicDomain/likelyPublicDomain cases where it plays no part
// in the returned effective status. Exists for the one caller that needs
// to know whether an explicit 'publicDomain' pick actually contradicts
// what the calculation would otherwise show (citation.go's decision on
// whether to append a clarifying note) — every other caller ignores it.
//
// The calculation's copyright year input is eff.CopyrightYearForCalc, not
// eff.CopyrightYear — a book/piece is very often missing an explicit
// Copyright Year while still having a Year Published on record, so the
// calc falls further back to that (and, last, the piece's own Year
// Written) rather than conservatively giving up. See
// CopyrightYearForCalc's own doc comment for the full fallback order.
func ResolveCopyrightStatus(ctx context.Context, q Queryer, eff *EffectivePiece, region string) (effective string, expiryYear *int, calculatedLikelyPD bool, err error) {
	deathYears, err := PersonDeathYearsByIDs(ctx, q, eff.Composer.IDs)
	if err != nil {
		return "", nil, false, err
	}

	calc, err := copyright.ComputeLikelyPublicDomain(time.Now().Year(), eff.CopyrightYearForCalc, deathYears, region)
	if err != nil {
		return "", nil, false, err
	}

	explicit := eff.CopyrightStatus.Value

	switch explicit {
	case "publicDomain", "likelyPublicDomain":
		// Sticky — but still surface the calculation's own expiry year for
		// the tooltip when it happens to be computable, even though the
		// status itself isn't up for override here.
		return explicit, calc.ExpiryYear, calc.IsLikelyPD, nil
	case "copyleft", "inCopyright":
		if calc.IsLikelyPD {
			return "likelyPublicDomain", calc.ExpiryYear, calc.IsLikelyPD, nil
		}
		return explicit, nil, calc.IsLikelyPD, nil
	default: // "" — nothing explicitly picked anywhere
		if calc.IsLikelyPD {
			return "likelyPublicDomain", calc.ExpiryYear, calc.IsLikelyPD, nil
		}
		return "inCopyright", nil, calc.IsLikelyPD, nil
	}
}
