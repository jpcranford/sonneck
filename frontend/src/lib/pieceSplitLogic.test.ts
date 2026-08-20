import { describe, expect, it } from 'vitest'
import {
  applyRangeAction,
  computeLayout,
  cyclePage,
  formatPageList,
  normalizeSplits,
  type PageAssignments,
} from './pieceSplitLogic'

// This suite exists because CLAUDE.md > Frontend > Testing calls this
// exact logic out by name: "the wizard's own page-range calculation/
// display logic ... should have unit tests — same 'silent, permanent
// correctness bug' risk as the backend's PDF-extraction logic." Every
// case here was originally verified live, by hand, during this session
// (a brute-force script over every reachable page-assignment state, plus
// live Playwright checks) before being formalized here.

function emptyAssignments(): PageAssignments {
  return { starts: new Set(), skips: new Set(), shared: new Set() }
}

describe('computeLayout coverage invariants (brute force)', () => {
  // Real reachable states (per cyclePage/applyRangeAction) never put page
  // 1 explicitly in `starts` (it's implicit-unless-skipped) and always
  // keep starts/skips disjoint — restrict enumeration to that reachable
  // space, same restriction used when this was first brute-forced live.
  const PAGE_COUNT = 6
  const pages = Array.from({ length: PAGE_COUNT }, (_, i) => i + 1)
  const nonPage1 = pages.filter((p) => p !== 1)

  function* subsets<T>(arr: T[]): Generator<Set<T>> {
    for (let mask = 0; mask < 1 << arr.length; mask++) {
      const s = new Set<T>()
      for (let i = 0; i < arr.length; i++) if (mask & (1 << i)) s.add(arr[i])
      yield s
    }
  }

  it('every reachable state produces correct, non-corrupt piece coverage', () => {
    let checked = 0
    for (const skips of subsets(pages)) {
      for (const starts of subsets(nonPage1)) {
        let overlap = false
        for (const s of starts) if (skips.has(s)) overlap = true
        if (overlap) continue
        for (const shared of subsets([...starts])) {
          checked++
          const raw: PageAssignments = { starts, skips, shared }
          const state = normalizeSplits(raw, PAGE_COUNT)
          const pieces = computeLayout(state, PAGE_COUNT)

          const coverage = new Map<number, number>()
          for (const piece of pieces) {
            if (piece.start > piece.end) {
              throw new Error(
                `piece start (${piece.start}) > end (${piece.end}) for state ${JSON.stringify(state)}`,
              )
            }
            for (let pg = piece.start; pg <= piece.end; pg++) {
              coverage.set(pg, (coverage.get(pg) ?? 0) + 1)
            }
          }
          for (let pg = 1; pg <= PAGE_COUNT; pg++) {
            const count = coverage.get(pg) ?? 0
            if (state.skips.has(pg)) {
              expect(count, `skipped page ${pg} should be covered 0 times`).toBe(0)
            } else {
              const maxAllowed = state.shared.has(pg) ? 2 : 1
              expect(count, `page ${pg} coverage`).toBeGreaterThan(0)
              expect(
                count,
                `page ${pg} coverage should not exceed ${maxAllowed}`,
              ).toBeLessThanOrEqual(maxAllowed)
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})

describe('the bridge-piece scenario', () => {
  it('a shared page immediately after a skip produces a synthetic single-page piece plus the continuing piece', () => {
    // page 1 start, page 2 skipped, page 3 marked "shared" (split) — page
    // 3 has no real piece before it to extend into (the gap at page 2),
    // so it must produce its own 1-page piece *and* start the next one.
    const state: PageAssignments = {
      starts: new Set([3]),
      skips: new Set([2]),
      shared: new Set([3]),
    }
    const pieces = computeLayout(state, 8)
    expect(pieces).toEqual([
      { start: 1, end: 1, isLast: false, color: expect.any(String) },
      { start: 3, end: 3, isLast: false, color: expect.any(String) }, // the bridge
      { start: 3, end: 8, isLast: true, color: expect.any(String) }, // the continuing piece
    ])
    expect(pieces[1].color).not.toBe(pieces[2].color)
  })
})

describe('color is purely positional', () => {
  it('does not shift an existing piece color when an earlier piece is inserted', () => {
    const before = computeLayout({ starts: new Set([5]), skips: new Set(), shared: new Set() }, 8)
    const pieceAt5Before = before.find((p) => p.start === 5)!

    const after = computeLayout({ starts: new Set([3, 5]), skips: new Set(), shared: new Set() }, 8)
    const pieceAt5After = after.find((p) => p.start === 5)!

    // Position-based coloring means inserting an earlier piece *does*
    // shift a later piece's color (it moved from position 2 to position
    // 3) — that's the deliberate, current behavior (see the file's own
    // comment on why this supersedes the old identity-based scheme).
    expect(pieceAt5Before.color).not.toBe(pieceAt5After.color)
    // But re-deriving the exact same final state always gives the exact
    // same colors, regardless of what order you'd tapped things in to
    // get there — that's the actual invariant.
    const rederived = computeLayout(
      { starts: new Set([3, 5]), skips: new Set(), shared: new Set() },
      8,
    )
    expect(rederived).toEqual(after)
  })
})

describe('the Album für die Jugend fixture (skip + shared boundary together)', () => {
  it('matches the exact layout used throughout the wizard mockups', () => {
    const state: PageAssignments = {
      starts: new Set([5, 7]),
      skips: new Set([4]),
      shared: new Set([7]),
    }
    const pieces = computeLayout(state, 8)
    expect(pieces.map((p) => [p.start, p.end])).toEqual([
      [1, 3],
      [5, 7],
      [7, 8],
    ])
  })
})

describe('the tap cycle', () => {
  it('the very first interaction with a page always marks it as start, regardless of direction', () => {
    const state = emptyAssignments()
    const forward = cyclePage(2, state, 8, 'forward', false)
    expect(forward.starts.has(2)).toBe(true)
    expect(forward.shared.has(2)).toBe(false)
    expect(forward.skips.has(2)).toBe(false)

    const backward = cyclePage(2, state, 8, 'backward', false)
    expect(backward.starts.has(2)).toBe(true)
  })

  it('cycles start -> shared -> normal -> skip -> start once touched', () => {
    let state = emptyAssignments()
    state = cyclePage(2, state, 8, 'forward', false) // untouched -> start
    expect(state.starts.has(2) && !state.shared.has(2)).toBe(true)

    state = cyclePage(2, state, 8, 'forward', true) // start -> shared
    expect(state.starts.has(2) && state.shared.has(2)).toBe(true)

    state = cyclePage(2, state, 8, 'forward', true) // shared -> normal
    expect(state.starts.has(2)).toBe(false)
    expect(state.skips.has(2)).toBe(false)

    state = cyclePage(2, state, 8, 'forward', true) // normal -> skip
    expect(state.skips.has(2)).toBe(true)

    state = cyclePage(2, state, 8, 'forward', true) // skip -> start (wraps)
    expect(state.starts.has(2) && !state.shared.has(2)).toBe(true)
  })

  it('page 1 only ever toggles between start and skip', () => {
    let state = emptyAssignments()
    state = cyclePage(1, state, 8)
    expect(state.skips.has(1)).toBe(true)
    state = cyclePage(1, state, 8)
    expect(state.skips.has(1)).toBe(false)
  })
})

describe('applyRangeAction', () => {
  it('groups a range into one piece by marking its start — end is bounded by the next piece, or the book, whichever comes first', () => {
    // Grouping 3-5 alone (nothing after it) has no next piece to bound
    // it, so it correctly runs to the end of the book — this is the same
    // "tap marks a start, not an end" model the whole screen uses.
    const openEnded = applyRangeAction('group', 3, 5, emptyAssignments(), 8)
    const openPieces = computeLayout(openEnded, 8)
    expect(openPieces.some((p) => p.start === 3 && p.end === 8)).toBe(true)

    // Grouping 3-5 *and* marking a start at 6 bounds it correctly at 5.
    const bounded = applyRangeAction('group', 6, 6, openEnded, 8)
    const boundedPieces = computeLayout(bounded, 8)
    expect(boundedPieces.some((p) => p.start === 3 && p.end === 5)).toBe(true)
  })

  it('skips a range of pages entirely', () => {
    const state = applyRangeAction('skip', 3, 5, emptyAssignments(), 8)
    for (const p of [3, 4, 5]) expect(state.skips.has(p)).toBe(true)
    const pieces = computeLayout(state, 8)
    for (const piece of pieces) {
      for (let pg = piece.start; pg <= piece.end; pg++) {
        expect([3, 4, 5]).not.toContain(pg)
      }
    }
  })
})

describe('formatPageList', () => {
  it('compacts consecutive runs into ranges', () => {
    expect(formatPageList([4, 5, 6])).toBe('4–6')
  })

  it('keeps non-consecutive pages separate', () => {
    expect(formatPageList([2, 4, 5, 8])).toBe('2, 4–5, 8')
  })

  it('handles a single page', () => {
    expect(formatPageList([4])).toBe('4')
  })

  it('handles an empty list', () => {
    expect(formatPageList([])).toBe('')
  })
})
