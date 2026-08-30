// Book Upload Wizard's Split step (design doc §5's "split" step) — the
// tested, correctness-critical page-assignment algorithm shared by the
// real step (routes/BookUploadSplitStep.tsx) and its design-reference
// mockup (routes/UploadBookSplitMockup.tsx). Extracted here specifically
// because CLAUDE.md > Frontend > Testing calls this exact logic out by
// name as needing unit tests (see pieceSplitLogic.test.ts) — a narrow,
// deliberate exception to this project's usual "mockup and real component
// are separately hand-maintained" convention, which is about UI, not
// tested algorithm code. One implementation is safer than two hand-synced
// copies of logic this load-bearing.
//
// Every invariant here was exhaustively brute-force-verified live before
// being formalized into pieceSplitLogic.test.ts — see that file for real
// bugs this caught along the way (a React key-collision bug, a
// setState/ref race, several off-by-one and bridge-piece edge cases).

// Garden Variety, expanded to 10 (locked) — the "double" split option
// (a single page belonging to 3 Piece entries at once, see the `double`
// field below) made 7 colors too collision-prone for adjacent pieces.
// Ordered so every adjacent pair, including the wrap, contrasts well —
// not hue-sorted, since a pure hue-sort clusters warm and cool hues into
// two separate arcs instead of alternating them. Two colors (citrine,
// terracotta) are deliberately off the palette's usual S/L tier: citrine
// because at the tier-matched value it read as near-identical to a color
// it replaced, terracotta because at the tier-matched value it measured
// the lowest contrast of any palette color against the app's own paper
// background. Full derivation (hue math, rejected intermediates, both
// tier-exception bugs) saved in memory, project_split_palette_expansion.
export const PALETTE = [
  '#7a9c6b',
  '#b87aaf',
  '#5c8a8a',
  '#b8935a',
  '#9c7ab8',
  '#b8827a',
  '#6b8a9c',
  '#87a249',
  '#ac6939',
  '#b87a97',
]

export interface PageAssignments {
  // Every piece-start page except page 1, which is always an implicit
  // start unless explicitly skipped (see computeLayout) — kept out of
  // this set so "is page 1 skipped" has one source of truth instead of
  // two that could disagree.
  starts: Set<number>
  skips: Set<number>
  // Subset of `starts` — a page that starts a new piece AND also finishes
  // the previous one (design doc §5's "page 24 has a short piece's ending
  // and the next piece's beginning" case).
  shared: Set<number>
  // "Begin and split" (added post-launch) — a page that begins a new,
  // immediately-closed one-page piece AND, on that same page, begins a
  // second piece that stays open, continuing forward exactly like any
  // other piece start would. One page legitimately belonging to two
  // Piece entries this way isn't a new shape — computeLayout already
  // produces it for a `shared` page whose preceding page is a skip (the
  // "bridge" case below); `single` always forces that same two-pieces-
  // one-start shape, not just when the page before happens to be a skip.
  // Deliberately independent of `starts` (unlike `shared`, which is a
  // subset of it) so it can be set on page 1 too, which never appears in
  // `starts` itself. Optional — every function in this module treats a
  // missing value as an empty set, so existing PageAssignments literals
  // that predate this field (tests, the real wizard/step, which don't
  // expose this state in their UI yet) don't need updating.
  single?: Set<number>
  // "Finish previous and split twice" (added 2026-08-30, mockup-only so
  // far — not yet exposed in BookUploadSplitStep.tsx's own menu). The
  // natural extension of `shared` and `single` combined: this page both
  // finishes whatever piece was running before it (`shared`'s own
  // behavior) *and* begins its own immediately-closed one-page piece
  // before that (`single`'s own bridge behavior), before finally
  // beginning a third piece that stays open, continuing forward. Three
  // Piece entries touch this one physical page: the real previous piece
  // (or a synthetic stand-in, if the page right before this one is a
  // skip — same "no real piece to extend into" problem `shared` already
  // solves this same way), the synthetic one-page bridge, and the new
  // continuing piece. Independent of both `starts` and `single` for the
  // same reasons `single` is independent of them — not offered on page 1
  // (there's no "previous" for it to finish there), so unlike `single`
  // this one is never meaningful there and setPageState makes no special
  // case for it.
  double?: Set<number>
}

export interface Piece {
  start: number
  end: number
  isLast: boolean
  color: string
}

// A skipped page splits whatever piece it sits in the middle of — a piece
// is a physically contiguous run of pages, so a skip gap means the pages
// after it genuinely aren't the same piece anymore, not just "the same
// piece with a hole in it." Run after every mutation that can introduce a
// new skip: for each skip immediately followed by a non-skip page that
// isn't already a start, that following page becomes a new implicit
// start. A run of several consecutive skips only splits once, at the
// page where it resumes — not at every skipped page.
export function normalizeSplits(state: PageAssignments, pageCount: number): PageAssignments {
  const starts = new Set(state.starts)
  let changed = false

  for (let p = 1; p < pageCount; p++) {
    if (state.skips.has(p) && !state.skips.has(p + 1) && !starts.has(p + 1)) {
      starts.add(p + 1)
      changed = true
    }
  }

  if (!changed) return state
  return { ...state, starts }
}

// Color is purely positional — Piece 1 (leftmost in the book) is always
// PALETTE[0], Piece 2 is always PALETTE[1], etc., recomputed fresh by
// computeLayout every render. An earlier version keyed color to a piece's
// identity (its start page) instead, specifically so a piece's color
// wouldn't shift when an unrelated earlier piece was inserted — but that
// traded one confusing behavior for another: the same book, split
// differently only in what order you happened to tap things in, could
// land on a different color for "the first piece in the book," which
// read as arbitrary. Position-based coloring means the same final split
// always produces the same colors, regardless of the order the taps
// happened in — the more important invariant of the two.
export function computeLayout(state: PageAssignments, pageCount: number): Piece[] {
  const single = state.single ?? new Set<number>()
  const double = state.double ?? new Set<number>()
  // Union with `single`/`double`, not just `state.starts` — both are
  // independent of `starts` (see PageAssignments' own comments on why,
  // page 1 in particular for `single`) but still need their own entry in
  // this array for the loop below to give them a piece.
  let starts = [...new Set([...state.starts, ...single, ...double])].sort((a, b) => a - b)
  // Page 1 implicitly starts the first piece by default (tapping it isn't
  // required) — but only while it isn't explicitly skipped. A skipped
  // page 1 must not silently remain "part of a piece" just because of
  // that default.
  if (!state.skips.has(1)) {
    if (!starts.includes(1)) starts = [1, ...starts]
  } else if (starts.length === 0) {
    let firstPage = 2
    while (firstPage <= pageCount && state.skips.has(firstPage)) firstPage++
    if (firstPage <= pageCount) starts = [firstPage]
  }
  if (starts.length === 0) return []

  const pieces: Piece[] = []
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]
    const nextStart = starts[i + 1]
    const isLast = i === starts.length - 1

    // A shared (or double) page whose preceding page is a skip has no
    // real adjacent piece to extend backward into — give it its own
    // synthetic single-page piece first (immediately before its own
    // continuing piece in this array), rather than reaching across the
    // gap into whatever piece happens to sit further back. Both pieces
    // share the same start page on purpose; pushing it first (its own
    // array slot) is what gives it a color one step earlier than the
    // piece it precedes, same as any other two adjacent pieces. `double`
    // shares this exact "finish previous" problem — see its own comment
    // on PageAssignments — so it triggers the same fallback.
    if ((state.shared.has(start) || double.has(start)) && state.skips.has(start - 1)) {
      pieces.push({
        start,
        end: start,
        isLast: false,
        color: PALETTE[pieces.length % PALETTE.length],
      })
    }

    // "Begin and split" (`single`) and "finish previous and split twice"
    // (`double`) both always produce the same synthetic-bridge shape as
    // the shared-after-skip case just above, unconditionally rather than
    // only when the preceding page happens to be a skip — this page
    // closes its own one-page piece immediately (pushed here, its own
    // array slot, its own color) *and* — falling through to the normal
    // end computation right below with the exact same `start` — also
    // begins a second piece from that same page, staying open and
    // continuing forward exactly like any other piece start would. For
    // `double` this is the *second* of its two split points — the first
    // (finishing whatever ran before) is handled by the block above (a
    // skip-adjacent stand-in) or by the previous iteration's own `end`
    // computation below (the ordinary case, extending the real previous
    // piece's `end` to reach here) — never both at once for a `double`
    // that isn't skip-adjacent, since a real previous piece can't also
    // need a synthetic stand-in.
    if (single.has(start) || double.has(start)) {
      pieces.push({
        start,
        end: start,
        isLast: false,
        color: PALETTE[pieces.length % PALETTE.length],
      })
    }

    let end: number
    if (
      nextStart &&
      (state.shared.has(nextStart) || double.has(nextStart)) &&
      !state.skips.has(nextStart - 1)
    ) {
      end = nextStart
    } else {
      // A skip sitting right before the next piece's start (or the
      // book's last page) doesn't belong to this piece — walk back to
      // the last page that's actually included.
      end = nextStart ? nextStart - 1 : pageCount
      while (end > start && state.skips.has(end)) end--
    }
    pieces.push({ start, end, isLast, color: PALETTE[pieces.length % PALETTE.length] })
  }
  return pieces
}

export function pieceIndexForPage(pieces: Piece[], page: number): number {
  let idx = 0
  for (let i = 0; i < pieces.length; i++) {
    if (pieces[i].start <= page) idx = i
    else break
  }
  return idx
}

export type CycleState = 'normal' | 'start' | 'shared' | 'single' | 'double' | 'skip'

// Sets a page directly to one of its reachable states, bypassing the tap
// cycle — used by both cyclePage (below) and the long-press/right-click
// menu, which lets a user jump straight to a state instead of stepping
// through it. Page 1 has fewer real states than other pages: there's no
// piece before it to finish, so 'shared' isn't offered for it, and
// 'start' is just its default (implicit, per computeLayout) rather than
// something that needs to live in the `starts` set — adding it there too
// would give computeLayout's own implicit-page-1 prepend a duplicate to
// collide with. 'single' ("begin and split," added post-launch — a
// standalone single-page piece) IS meaningful on page 1 (e.g. a title
// page counted as its own piece) and is tracked independently of
// `starts` specifically so it can apply there too. 'double' ("finish
// previous and split twice," added later still) needs a real previous
// piece to finish the same way 'shared' does, so — like 'shared' — it's
// simply never offered on page 1's own menu and has no explicit handling
// in the page-1 branch below.
export function setPageState(
  page: number,
  target: CycleState,
  state: PageAssignments,
  pageCount: number,
): PageAssignments {
  const starts = new Set(state.starts)
  const skips = new Set(state.skips)
  const shared = new Set(state.shared)
  const single = new Set(state.single ?? [])
  const double = new Set(state.double ?? [])

  if (page === 1) {
    single.delete(1)
    double.delete(1)
    if (target === 'skip') {
      skips.add(1)
    } else {
      skips.delete(1)
      if (target === 'single') single.add(1)
    }
    return normalizeSplits({ starts, skips, shared, single, double }, pageCount)
  }

  starts.delete(page)
  shared.delete(page)
  skips.delete(page)
  single.delete(page)
  double.delete(page)
  if (target === 'start') {
    starts.add(page)
  } else if (target === 'shared') {
    starts.add(page)
    shared.add(page)
  } else if (target === 'skip') {
    skips.add(page)
  } else if (target === 'single') {
    single.add(page)
  } else if (target === 'double') {
    // Independent of `starts`, same as `single` (not a subset of it, the
    // way `shared` is) — computeLayout unions `double` into its own
    // working `starts` array at read time instead.
    double.add(page)
  }
  return normalizeSplits({ starts, skips, shared, single, double }, pageCount)
}

export function currentCycleState(page: number, state: PageAssignments): CycleState {
  if (state.skips.has(page)) return 'skip'
  if (state.single?.has(page)) return 'single'
  if (state.double?.has(page)) return 'double'
  if (state.starts.has(page)) return state.shared.has(page) ? 'shared' : 'start'
  return 'normal'
}

// 'normal' sits between 'shared' and 'skip', not at the front — the ring
// only governs a page that's already partway through being marked.
// Whatever a page's data looks like on load (nothing marked at all) is
// deliberately *not* a position in this ring; see cyclePage's own comment
// for why that distinction needs separate tracking.
//
// 'single' ("begin and split") is deliberately left out of this ring —
// it's reachable only via the long-press/right-click menu, same as every
// other state is also reachable there, but without also lengthening the
// plain tap cycle for the common case. Tapping a page that's currently
// 'single' falls out of the ring at whichever end the tap direction
// implies (CYCLE_ORDER.indexOf returns -1, so the wraparound math lands
// on 'start' going forward or 'normal' going backward) — an accepted,
// intentional fallback, not a bug: 'single' is meant to be a deliberate
// long-press choice, not something a quick tap should be able to land on
// or need to tap past.
export const CYCLE_ORDER: CycleState[] = ['start', 'shared', 'normal', 'skip']

// Tap cycle for a single page: starts a piece -> also finishes the
// previous piece -> cleared back to a plain page -> skipped -> starts a
// piece again, and so on. Shift-click (direction: 'backward') walks the
// same four states in reverse.
//
// The cycle only begins once a page has actually been interacted with —
// `alreadyTouched` (a page-number set the caller maintains across the
// whole component's lifetime, separate from PageAssignments itself) is
// what makes that distinction possible at all. Without it, "a page
// nothing has ever been marked on" and "a page that's been cycled back to
// cleared via shared -> normal" are the exact same data (empty membership
// in starts/shared/skips) — genuinely indistinguishable from state alone.
// A page's very first interaction, in either direction, always marks it
// as a new piece start; only from there does it enter the ring above.
export function cyclePage(
  page: number,
  state: PageAssignments,
  pageCount: number,
  direction: 'forward' | 'backward' = 'forward',
  // A boolean snapshot, not a live touched-pages Set: setState's updater
  // callback doesn't run until React gets around to it, by which point a
  // caller that mutates the same Set object synchronously right after
  // calling setState would already show up as "touched" inside this
  // closure — the mutation and the deferred read racing against each
  // other despite reading top-to-bottom as sequential. A primitive
  // captured before either the mutation or the setState call has no such
  // race (found live: this is exactly what made the very first tap on an
  // untouched page register as 'skip' instead of 'start').
  alreadyTouched = false,
): PageAssignments {
  if (page === 1) {
    return setPageState(page, state.skips.has(1) ? 'normal' : 'skip', state, pageCount)
  }
  if (!alreadyTouched) {
    return setPageState(page, 'start', state, pageCount)
  }
  const currentIndex = CYCLE_ORDER.indexOf(currentCycleState(page, state))
  const delta = direction === 'forward' ? 1 : -1
  const next = CYCLE_ORDER[(currentIndex + delta + CYCLE_ORDER.length) % CYCLE_ORDER.length]
  return setPageState(page, next, state, pageCount)
}

export function applyRangeAction(
  action: 'group' | 'skip',
  lo: number,
  hi: number,
  state: PageAssignments,
  pageCount: number,
): PageAssignments {
  const starts = new Set(state.starts)
  const skips = new Set(state.skips)
  const shared = new Set(state.shared)
  const single = new Set(state.single ?? [])
  const double = new Set(state.double ?? [])
  for (let p = lo; p <= hi; p++) {
    starts.delete(p)
    shared.delete(p)
    skips.delete(p)
    single.delete(p)
    double.delete(p)
  }
  if (action === 'group') {
    if (lo !== 1) starts.add(lo)
  } else {
    for (let p = lo; p <= hi; p++) skips.add(p)
  }
  return normalizeSplits({ starts, skips, shared, single, double }, pageCount)
}

// Compact page-list formatting for the Skipped pill — "4, 5, 6" reads as
// three separate facts; "4-6" reads as one, matching how piece ranges
// already display ("pp 5-7", not "pp 5, 6, 7").
export function formatPageList(pages: number[]): string {
  const sorted = [...pages].sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  const parts: string[] = []
  let rangeStart = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i <= sorted.length; i++) {
    const current = sorted[i]
    if (current !== prev + 1) {
      parts.push(rangeStart === prev ? `${rangeStart}` : `${rangeStart}–${prev}`)
      rangeStart = current
    }
    prev = current
  }
  return parts.join(', ')
}
