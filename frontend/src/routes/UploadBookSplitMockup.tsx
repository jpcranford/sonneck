import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  IconArrowLeft,
  IconArrowRight,
  IconCircleCaretLeftFilled,
  IconCircleCaretRightFilled,
  IconCircleFilled,
  IconScissors,
  IconEyeOff,
  IconArrowsLeftRight,
  IconCrop,
  IconDots,
  IconX,
} from '@tabler/icons-react'
import { useMockupTitle } from '../lib/useMockupTitle'
import {
  computeLaneSegments,
  laneDiagonalMaskStyle,
  useGridColumns,
  LANE_OUTSET_PX,
} from '../lib/pieceLaneLayout'
import {
  applyRangeAction,
  computeLayout,
  currentCycleState,
  cyclePage,
  formatPageList,
  pieceIndexForPage,
  setPageState,
  type CycleState,
  type PageAssignments,
} from '../lib/pieceSplitLogic'

// ---------------------------------------------------------------------
// DESIGN MOCKUP — Book Upload Wizard, Screen 4 of 6: "Mark where each
// piece begins" (design doc §5's "split" step). Not wired to the API —
// all page-assignment state lives client-side in this component.
// Design: the tap-marks-start model, a tinted open-piece indicator, and
// the 7-color Garden Variety palette.
//
// Genuinely interactive: tap a page to cycle its state, press-hold and
// drag across pages to range-select. This is the real reason to build a
// mockup instead of stopping at a static comparison — a static comparison
// can describe a gesture, it can't prove it feels right (this file's own
// revision history is proof: five real bugs surfaced by actually using it
// that a static comparison never would have caught).
//
// PAGE_OFFSET simulates a printed-page correction having been set back on
// Screen 3 ("About this book," see its own "Printed-PDF page number
// offset" field) — every interaction here (data-page, drag-select,
// pieceIndexForPage, computeLayout) still runs against the raw
// 1..PAGE_COUNT physical PDF position, since that's what extraction
// actually needs; only what's *displayed* below (thumbnail corner
// numbers, the p.N caption, the piece/skip summary pills) is shown in the
// offset-adjusted, citation-facing numbering.
// ---------------------------------------------------------------------

const PAGE_COUNT = 8
const PAGE_OFFSET = 6
const TOTAL_STEPS = 6
const CURRENT_STEP = 4

// Same values as the shared ContextMenu component (components/ContextMenu.tsx)
// uses for its own long-press — kept in step so a long-press feels
// identical everywhere in the app, even though this screen's own
// pointerdown/drag lifecycle means it can't reuse that component directly
// (see the state/ref comments below for why).
const LONG_PRESS_MS = 500
const LONG_PRESS_MOVE_CANCEL_PX = 10

// Same 8-page/3-piece fixture used throughout the wizard's design phase,
// carried into this mockup so screenshots and this live version describe
// the same book: p.1-3 "Prelude in C," p.4 skipped, p.5-7 "Nocturne,"
// p.7 also starts "Waltz in A♭" (shared boundary), p.8 Waltz continues —
// and because nothing has closed the Waltz yet, it's still "open."
const INITIAL_STATE: PageAssignments = {
  starts: new Set([5, 7]),
  skips: new Set([4]),
  shared: new Set([7]),
  single: new Set(),
}

interface PageMenuItem {
  label: string
  icon: ReactNode
  target: CycleState
}

// Long-press (touch) or right-click (desktop) opens a menu offering every
// reachable state directly, instead of stepping through the cycle —
// requested alongside shift-click-to-reverse, as a second way to skip
// past however many taps a state is otherwise away. Page 1 only offers
// its three real states (see setPageState's comment on why 'shared' isn't
// one of them).
//
// "Begin and split" (target: 'single', added post-launch) is menu-only,
// not part of the plain tap cycle (see CYCLE_ORDER's own comment in
// pieceSplitLogic.ts) — it's a distinct capability from "Finish previous
// and split" just above it: that one shares a page
// between two pieces where the *first* of the two was already running
// from earlier pages. This one closes a brand-new, self-contained
// one-page piece right on this exact page — cleanly split from whatever
// ran before it — and, on that same page, begins a second piece that
// stays open, continuing forward exactly like any other piece start
// would. One page belonging to two Piece entries this way isn't a new
// shape (see computeLayout's own synthetic-bridge case for `shared` after
// a skip) — this just triggers that shape directly, on request, instead
// of only as a side effect of a skip.
function pageMenuItems(page: number): PageMenuItem[] {
  if (page === 1) {
    return [
      { label: 'Start piece here', icon: <IconScissors size={14} />, target: 'start' },
      { label: 'Begin and split', icon: <IconCrop size={14} />, target: 'single' },
      { label: 'Skip this page', icon: <IconEyeOff size={14} />, target: 'skip' },
    ]
  }
  return [
    { label: 'Start a new piece', icon: <IconScissors size={14} />, target: 'start' },
    {
      label: 'Finish previous and split',
      icon: <IconArrowsLeftRight size={14} />,
      target: 'shared',
    },
    { label: 'Begin and split', icon: <IconCrop size={14} />, target: 'single' },
    { label: 'Skip this page', icon: <IconEyeOff size={14} />, target: 'skip' },
    { label: 'Clear (plain page)', icon: <IconX size={14} />, target: 'normal' },
  ]
}

// Group Lane (design doc: the "Piece Length Indicator" comparison
// artifact) — a light tint fill connecting the thumbnails of one piece, so
// its true page length reads directly as the shape's own width, on top of
// the existing per-tile border treatment. Promoted to lib/pieceLaneLayout.ts
// once approved and ported into the real BookUploadSplitStep.tsx, so both
// call sites share one implementation instead of two hand-synced copies —
// see that file's own header comment for the full reasoning.

function PageThumb({ page, printedPage }: { page: number; printedPage: number }) {
  const blank = page === 4
  return (
    <svg viewBox="0 0 100 130" className="block h-auto w-full">
      <rect
        x="0.5"
        y="0.5"
        width="99"
        height="129"
        fill={blank ? '#f7f5f0' : '#fffdf9'}
        stroke="#e4e0d8"
      />
      {blank ? (
        <text x="50" y="68" textAnchor="middle" fontSize="5" fill="#c9c2b6" fontStyle="italic">
          (blank)
        </text>
      ) : (
        [29, 46, 63, 80, 97, 114].map((y) => (
          <g key={y} stroke="#c9c2b6" strokeWidth="0.35">
            {[0, 1.8, 3.6, 5.4, 7.2].map((offset) => (
              <line key={offset} x1="9" x2="91" y1={y + offset} y2={y + offset} />
            ))}
          </g>
        ))
      )}
      <text x="92" y="124" textAnchor="end" fontSize="4" fill="#8f857a">
        {printedPage}
      </text>
    </svg>
  )
}

export function UploadBookSplitMockup() {
  useMockupTitle('Upload — Split the Book')

  const [state, setState] = useState<PageAssignments>(INITIAL_STATE)
  const [dragAnchor, setDragAnchor] = useState<number | null>(null)
  const [dragCurrent, setDragCurrent] = useState<number | null>(null)
  // Separate from dragAnchor !== null: a resolved range keeps dragAnchor
  // set (so the action bar stays up) after the pointer is released, but
  // must stop *tracking new pages* the instant the button/finger lifts.
  // The original bug used dragAnchor !== null for both "is there a
  // pending selection" and "should pointer-enter still move it" — so
  // just moving the mouse afterward (no button held) kept silently
  // growing or shrinking the selection.
  const isPointerDownRef = useRef(false)
  const gridRef = useRef<HTMLDivElement>(null)
  // Pages that have had at least one real interaction (tap, shift-tap,
  // menu pick, or drag-range action) — see cyclePage's own comment for
  // why the tap cycle needs this instead of just reading current state.
  // A ref, not React state: it only ever needs to be read from inside
  // event handlers when the next mutation is computed, never during
  // render, so there's nothing for it to usefully trigger a re-render for.
  const touchedRef = useRef<Set<number>>(new Set())
  // Which page a click/tap started on was shift-held — read by the global
  // pointerup handler below, which is where the tap actually resolves
  // into a cyclePage call (see its own comment for why that's a separate
  // effect rather than living directly on the pointerdown handler).
  const shiftHeldRef = useRef(false)
  // Long-press (touch) / right-click (desktop) opens this instead of
  // resolving as a tap — same underlying pointerdown/pointerup lifecycle
  // as drag-select, not a second parallel touch-event system, so the two
  // can't double-fire against each other on the same gesture.
  const [contextMenu, setContextMenu] = useState<{ page: number; x: number; y: number } | null>(
    null,
  )
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const pieces = computeLayout(state, PAGE_COUNT)
  const columns = useGridColumns()
  const laneSegments = computeLaneSegments(pieces, columns)
  const totalRows = Math.ceil(PAGE_COUNT / columns)
  const selection =
    dragAnchor !== null && dragCurrent !== null && dragAnchor !== dragCurrent
      ? [Math.min(dragAnchor, dragCurrent), Math.max(dragAnchor, dragCurrent)]
      : null

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  useEffect(() => {
    function handlePointerUp() {
      isPointerDownRef.current = false
      clearLongPressTimer()
      if (dragAnchor !== null && dragAnchor === dragCurrent) {
        // No real drag happened — treat as a plain tap. Shift reverses
        // the cycle direction (captured at pointerdown time, since by the
        // time this fires — a separate global listener — the key may
        // already have been released).
        const wasTouched = touchedRef.current.has(dragAnchor)
        touchedRef.current.add(dragAnchor)
        setState((s) =>
          cyclePage(
            dragAnchor,
            s,
            PAGE_COUNT,
            shiftHeldRef.current ? 'backward' : 'forward',
            wasTouched,
          ),
        )
        setDragAnchor(null)
        setDragCurrent(null)
      }
      // A genuine range stays selected (action bar visible) until the
      // user resolves or cancels it — releasing the pointer doesn't
      // discard the selection on its own.
    }
    window.addEventListener('pointerup', handlePointerUp)
    return () => window.removeEventListener('pointerup', handlePointerUp)
  }, [dragAnchor, dragCurrent])

  // Container-level move tracking + elementFromPoint hit-testing instead
  // of a per-cell onPointerEnter — touch pointers implicitly capture to
  // whichever cell received the pointerdown, so onPointerEnter on the
  // *other* cells never fires during a real finger-drag (this only
  // worked in the earlier version by accident, with a mouse, which
  // doesn't capture the same way — checked directly, since "does it work
  // the same on touch" isn't something to assume). Reading coordinates
  // off the bubbled event and hit-testing manually works identically for
  // mouse and touch.
  const handlePointerMove = useCallback((event: React.PointerEvent) => {
    if (!isPointerDownRef.current) return
    // A finger/cursor that's clearly moving is dragging to select a
    // range, not holding still for a long-press — cancel the pending
    // timer rather than popping the menu out from under it.
    if (longPressTimerRef.current && longPressOriginRef.current) {
      const dx = event.clientX - longPressOriginRef.current.x
      const dy = event.clientY - longPressOriginRef.current.y
      if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_CANCEL_PX) clearLongPressTimer()
    }
    const el = document.elementFromPoint(event.clientX, event.clientY)
    const cell = el?.closest<HTMLElement>('[data-page]')
    if (cell) {
      const page = Number(cell.dataset.page)
      setDragCurrent(page)
    }
  }, [])

  function clearSelection() {
    setDragAnchor(null)
    setDragCurrent(null)
  }

  // Shared by the long-press timer and the right-click handler — both
  // cancel whatever the ordinary tap/drag lifecycle had in flight (so
  // release doesn't *also* fire a tap on top of opening the menu) and
  // open the menu at the same point.
  function openPageMenu(page: number, x: number, y: number) {
    isPointerDownRef.current = false
    clearLongPressTimer()
    setDragAnchor(null)
    setDragCurrent(null)
    setContextMenu({ page, x, y })
  }

  function resolveSelection(action: 'group' | 'skip') {
    if (!selection) return
    setState((s) => applyRangeAction(action, selection[0], selection[1], s, PAGE_COUNT))
    for (let p = selection[0]; p <= selection[1]; p++) touchedRef.current.add(p)
    clearSelection()
  }

  function handleCancelUpload() {
    const confirmed = window.confirm(
      'Cancel this upload? The uploaded file and its generated page previews will be permanently removed from the server.',
    )
    if (!confirmed) return
    // Mockup only — see UploadBookAboutMockup.tsx's own copy of this
    // function for the real-build notes (DELETE /api/books/{id}, thumbnail
    // cache cleanup gap, return-to-Upload-landing).
    console.log(
      'Mockup: cancel confirmed — would delete book + cached thumbnails, return to Upload landing',
    )
  }

  // Dismiss-on-outside-click / Escape, same convention as the shared
  // ContextMenu component.
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [contextMenu])

  // Clamp the menu back on-screen if its anchor point sits near a
  // viewport edge — same technique and margin as ContextMenu.tsx.
  useLayoutEffect(() => {
    if (!contextMenu || !menuRef.current) return
    const margin = 8
    const rect = menuRef.current.getBoundingClientRect()
    const clampedX = Math.min(contextMenu.x, window.innerWidth - rect.width - margin)
    const clampedY = Math.min(contextMenu.y, window.innerHeight - rect.height - margin)
    menuRef.current.style.left = `${Math.max(margin, clampedX)}px`
    menuRef.current.style.top = `${Math.max(margin, clampedY)}px`
  }, [contextMenu])

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6 md:p-8">
      <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
        Design mockup —{' '}
        <span className="font-medium text-ink">
          Book Upload Wizard, Screen 4 of 6: "Mark where each piece begins"
        </span>{' '}
        (design doc §5). Not wired to real data — genuinely interactive: tap a page to cycle its
        state, press-hold and drag to select a range.
      </div>

      {/* Wizard chrome — identical to Screen 3's, carried forward verbatim,
          including Back routing to /mockup rather than simulating real
          step-nav — see UploadBookAboutMockup.tsx's own comment on this. */}
      <div className="flex items-center justify-between">
        <Link
          to="/mockup"
          className="flex items-center gap-1.5 text-base text-ink-soft hover:text-ink"
        >
          <IconArrowLeft size={24} />
          Back
        </Link>
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-xs text-ink-soft">
            Step {CURRENT_STEP} of {TOTAL_STEPS}
          </span>
          <div className="flex gap-1.5">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((step) => (
              <span
                key={step}
                className={`h-1 w-5 rounded-full ${
                  step < CURRENT_STEP
                    ? 'bg-accent-on-dark'
                    : step === CURRENT_STEP
                      ? 'bg-accent'
                      : 'bg-border'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      <div>
        <h1 className="font-display text-2xl font-medium text-ink">Mark where each piece begins</h1>
        <p className="text-sm text-ink-soft">
          Tap a page to start a new piece there, tap again to also mark it as finishing the piece
          before it, again to clear it, and again to skip it — shift-click to step backward instead.
          Press and hold, then drag, to select a run of pages at once. Long-press or right-click a
          page to pick its state directly.
        </p>
      </div>

      <div className="relative">
        {/* Lanes live in a wholly separate grid, absolutely positioned to
            exactly cover the real tiles grid below — not interleaved into
            that same grid via explicit grid-column/grid-row. Tried that
            first and it broke badly: browsers reserve an explicitly-
            placed item's cells and route auto-placed siblings *around*
            them, so every tile past the first lane segment got pushed
            into the wrong cell entirely (confirmed live — the whole grid
            scrambled). A separate overlay grid can't interfere with the
            tiles' own auto-placement since the two grids never share a
            layout pass. Same column template/gap so column lines land in
            the same place; `grid-template-rows: repeat(rows, 1fr)`
            divides its own (absolutely-positioned, so definite-height)
            box evenly to match, which is only valid because every real
            row here is the same height (identical page-thumbnail aspect
            ratio throughout) — not a general solution if that ever
            stops being true. pointer-events-none throughout so drag-
            select/long-press (hit-testing via elementFromPoint) always
            resolves to the real tile, never a lane sitting in front of it. */}
        <div
          className="pointer-events-none absolute inset-0 grid grid-cols-3 gap-3 sm:grid-cols-6"
          style={{ gridTemplateRows: `repeat(${totalRows}, 1fr)` }}
        >
          {laneSegments.map((seg) => (
            <div
              key={seg.key}
              className="rounded-[10px]"
              style={{
                gridColumn: `${seg.colStart + 1} / ${seg.colEnd + 1}`,
                gridRow: seg.row + 1,
                // Symmetric outward expansion on every side (negative
                // margin, not padding — the grid cell itself, and the
                // tile/caption it holds, are unchanged) — this is what
                // opens up a hair of visible gap between the lane's own
                // border and the thumbnail/caption it wraps, instead of
                // the two sharing an identical edge-to-edge footprint.
                // Symmetric matters here for the same reason it matters in
                // laneDiagonalMaskStyle below: it grows the box around its
                // own center without moving that center at all.
                margin: -LANE_OUTSET_PX,
                background: `${seg.color}1a`, // ~10% alpha
                border: `1.5px solid ${seg.color}73`, // ~45% alpha
                ...laneDiagonalMaskStyle(seg),
              }}
            />
          ))}
        </div>

        <div
          ref={gridRef}
          className="relative grid grid-cols-3 gap-3 touch-none select-none sm:grid-cols-6"
          onPointerMove={handlePointerMove}
        >
          {Array.from({ length: PAGE_COUNT }, (_, i) => i + 1).map((page) => {
            const isSkip = state.skips.has(page)
            const pieceIdx = pieceIndexForPage(pieces, page)
            const piece = pieces[pieceIdx]
            const isStart = page === piece?.start
            const isSharedStart = isStart && state.shared.has(page)
            const isSingleStart = isStart && (state.single?.has(page) ?? false)
            // Guarded with !isSkip so this can never be true for a page
            // that's also marked skip — pieceIndexForPage doesn't know
            // about skip status (it's a pure position lookup), so without
            // this guard a skipped page could still resolve to "pending"
            // purely by coincidence of which piece it falls after. Also
            // guarded against the book's own last page: "pending" means
            // "this piece has no explicit closing boundary yet, and might
            // still extend" — true for every other trailing member, but
            // never true for literally the final page, since there's no
            // page after it left to start a new piece and close this one.
            // Showing the same "still open" badge there would be
            // misleading, not just redundant.
            const isPending = piece?.isLast && !isStart && !isSkip && page !== PAGE_COUNT
            const isSelected = selection && page >= selection[0] && page <= selection[1]

            // Single source of truth for which badge shows, in the
            // requested priority order: a page you explicitly marked wins
            // over a page that's just riding along. skip > shared and
            // skip > pending never actually collide in practice (isPending
            // is guarded above, and starts/skips are kept disjoint
            // everywhere state changes), so this order is safe as well as
            // requested — not fighting the invariants to get it. 'single'
            // and 'shared' never collide either (setPageState keeps them
            // mutually exclusive), so their relative order here doesn't
            // matter in practice — 'single' first since it's the newer,
            // more specific mark.
            const badgeKind: 'single' | 'start' | 'shared' | 'pending' | 'skip' | null =
              isSingleStart
                ? 'single'
                : isSharedStart
                  ? 'shared'
                  : isStart
                    ? 'start'
                    : isPending
                      ? 'pending'
                      : isSkip
                        ? 'skip'
                        : null

            // `border-image` (the obvious way to paint a two-color diagonal
            // border) ignores `border-radius` entirely — a CSS quirk, not a
            // bug in this app's own styles. sharedGradient carries the
            // two-color diagonal as a plain `background`, painted on a
            // padded outer box instead (padding equal to the border width,
            // radius on both the outer box and an inner overflow-hidden
            // wrapper) — that combination respects rounding the way
            // `border-image` never does.
            //
            // Real per-side `border-*-color`/`border-*-style` properties
            // (dividing at the box's own corners, not the diagonal) were
            // tried and reverted 2026-08-30 — direct correction: it moved
            // the color divider away from the diagonal offset the original
            // gradient design used, and it was applied to 'single' too,
            // which shouldn't get any dashed treatment at all (see below).
            let borderStyle: React.CSSProperties = {}
            let sharedGradient: string | null = null
            if (badgeKind === 'skip') {
              // No border at all (added 2026-08-30, direct request) — kept
              // as an invisible, same-width border via a transparent color
              // rather than dropping border-width itself, so the grid
              // doesn't visually jump when a page toggles to/from skip. A
              // skipped page is excluded content, not a piece boundary, so
              // the dashed border it used to get read as more meaningful
              // than it actually was. Paired with the thumbnail's own
              // reduced opacity (see the className below) and the badge
              // switching from an eye-off icon to a plain X.
              borderStyle = { borderColor: 'transparent' }
            } else if (badgeKind === 'shared') {
              // The previous-piece half is tinted (~38% alpha) UNLESS that
              // "previous piece" is actually the synthetic bridge piece
              // sharing this same start page (a gap sits right before this
              // page, so there's no real adjacent piece to tint against) —
              // that bridge piece has no plain-member neighbor of its own
              // to visually match, so it stays full strength, same as any
              // other start page would.
              //
              // No dashed overlay on this half (removed 2026-08-30, direct
              // request: "remove the dashed part from 'finish and split'")
              // — both halves are now a plain solid fill, same treatment
              // 'single' already gets just below (and the same reasoning:
              // the Group Lane fill already carries the "continues from
              // before" signal, so the border doesn't need to as well).
              // This is a reversal of the same-day fix right below in
              // 'single''s own comment ("no dashed overlay ... direct
              // correction") — that one was about *never* dashing this
              // half in the first place for a semantically-different
              // reason (both halves of 'single' are beginnings); this one
              // is the later, broader decision that dashed borders aren't
              // needed here at all anymore, for any badge kind.
              const prevPiece = pieces[pieceIdx - 1]
              const prevIsBridgeCounterpart = prevPiece && prevPiece.start === piece.start
              const prevColor = prevPiece
                ? prevIsBridgeCounterpart
                  ? prevPiece.color
                  : `${prevPiece.color}61`
                : piece.color
              sharedGradient = `linear-gradient(135deg, ${prevColor} 50%, ${piece.color} 50%)`
            } else if (badgeKind === 'single') {
              // Same two-color diagonal as 'shared' just above, but no
              // dashed overlay (direct correction 2026-08-30: "Begin and
              // split" is a piece-*beginning* status, not a continuation —
              // neither half here is "riding along from before": the first
              // half is a brand-new synthetic one-page piece that closes
              // immediately, the second is the piece that begins right
              // after it. Both are beginnings, so both stay solid, exactly
              // as this looked before any of today's changes). Both halves
              // stay full strength (not tinted) — pieces[pieceIdx-1] is
              // always the synthetic one-page piece computeLayout pushes
              // immediately before the continuing piece for a 'single'
              // start (the exact same "two Piece entries share one start"
              // shape as 'shared' after a skip), so this is that same
              // bridge-counterpart case 'shared' already special-cases to
              // full strength — just always true here, not only sometimes.
              const closedPiece = pieces[pieceIdx - 1]
              const closedColor = closedPiece ? closedPiece.color : piece.color
              sharedGradient = `linear-gradient(135deg, ${closedColor} 50%, ${piece.color} 50%)`
            } else if (badgeKind === 'start') {
              borderStyle = { borderColor: piece.color }
            } else if (badgeKind === 'pending') {
              // The still-open piece (no explicit closing boundary yet)
              // keeps a tinted dashed border — this is the one remaining
              // real signal a border still needs to carry: "this piece
              // might not be done." A genuinely plain member page (below)
              // no longer needs a border at all for the same purpose, since
              // the Group Lane background already shows which piece a page
              // belongs to.
              borderStyle = { borderStyle: 'dashed', borderColor: `${piece.color}61` } // ~38% alpha
            } else {
              // Plain member page (badgeKind null) — no badge, no border
              // (removed 2026-08-30, direct request: "try removing the
              // dashed lines from plain pages"). Kept as an invisible,
              // same-width transparent border rather than dropping
              // border-width itself, same reasoning as the 'skip' case
              // above — no grid reflow as a page's state changes. The
              // Group Lane fill (background tint spanning the whole piece)
              // is now the only thing marking a plain page as part of its
              // piece; the border was doing double duty with that lane once
              // it existed, and dropping it here is what's actually being
              // tried.
              borderStyle = { borderColor: 'transparent' }
            }

            return (
              <div
                key={page}
                data-page={page}
                className="relative w-full cursor-pointer"
                onPointerDown={(e) => {
                  // Right-click (button 2) reaches this handler too — a
                  // plain click/tap always has button 0 (touch's synthetic
                  // primary contact included), but a real right-click's
                  // pointerdown fires before its contextmenu event, so
                  // without this guard it would also arm the drag-select/
                  // long-press state machine below, and releasing the
                  // right button then fired the same single-page cyclePage
                  // toggle a left click would — the reported bug: right-
                  // click did both, not just open the menu. Bail before
                  // touching any state so the only thing a right-click
                  // does is what onContextMenu below already handles.
                  if (e.button !== 0) return
                  e.preventDefault()
                  isPointerDownRef.current = true
                  shiftHeldRef.current = e.shiftKey
                  setDragAnchor(page)
                  setDragCurrent(page)
                  longPressOriginRef.current = { x: e.clientX, y: e.clientY }
                  clearLongPressTimer()
                  const { clientX, clientY } = e
                  longPressTimerRef.current = setTimeout(() => {
                    openPageMenu(page, clientX, clientY)
                  }, LONG_PRESS_MS)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  openPageMenu(page, e.clientX, e.clientY)
                }}
              >
                {sharedGradient ? (
                  <div
                    className="relative overflow-hidden rounded-md p-[2px]"
                    style={{ background: sharedGradient }}
                  >
                    <div className="overflow-hidden rounded-[4px]">
                      <PageThumb page={page} printedPage={page + PAGE_OFFSET} />
                    </div>
                  </div>
                ) : (
                  <div
                    className={`overflow-hidden rounded-md border-2 transition-shadow ${
                      badgeKind === 'skip' ? 'opacity-40' : ''
                    }`}
                    style={borderStyle}
                  >
                    <PageThumb page={page} printedPage={page + PAGE_OFFSET} />
                  </div>
                )}
                {isSelected && (
                  <div className="pointer-events-none absolute inset-0 rounded-md bg-accent/15 outline outline-3 outline-offset-2 outline-accent" />
                )}
                {badgeKind && (
                  <span className="absolute top-1 right-1 flex size-[18px] items-center justify-center rounded bg-ink/75 text-white">
                    {badgeKind === 'skip' && <IconX size={11} />}
                    {badgeKind === 'shared' && <IconArrowsLeftRight size={11} />}
                    {badgeKind === 'start' && <IconScissors size={11} />}
                    {badgeKind === 'single' && <IconCrop size={11} />}
                    {badgeKind === 'pending' && <IconDots size={12} />}
                  </span>
                )}
                {/* In normal flow, inside this same per-page grid cell —
                    not a separate grid stacked below the whole thing (see
                    this file's own git history: that version's captions
                    only ever lined up under their own tile by coincidence,
                    when there happened to be exactly one tile row; a real
                    bug report ("the page numbers aren't underneath their
                    pages") caught it the moment a second/third row existed,
                    since a wholly separate grid wraps its own short-row
                    captions independently of where the much-taller real
                    tile rows actually are, bunching every caption row
                    together right after the first tile row instead of each
                    one sitting under its own. Being a real DOM sibling
                    inside the tile's own cell instead makes correct
                    placement automatic — this caption can never be
                    anywhere but under its own tile, regardless of how many
                    rows there are or how the grid wraps. It also makes
                    every real tile row uniformly taller by exactly one
                    caption's height, which — since the Group Lane/chevron
                    overlays already divide their own box into totalRows
                    equal fractions matching the real tiles grid's own
                    natural height (see that overlay's own comment) — they
                    pick up for free with no code change of their own: the
                    lane background now extends slightly behind the caption
                    text too, a minor, acceptable cosmetic trade for
                    captions that are actually correctly positioned. */}
                <span className="mt-1 block text-center text-[0.65rem] text-ink-soft">
                  p.{page + PAGE_OFFSET}
                </span>
              </div>
            )
          })}
        </div>

        {/* Row-wrap continuation marks (added 2026-08-30, direct report: a
            lane simply stopping at the row's right edge was
            indistinguishable from a piece that genuinely ends there by
            coincidence) — Tabler's own `IconCircleCaretRightFilled`/
            `...LeftFilled` (24px, colored solid to the wrapping lane's own
            color — swapped in for the visually-similar `IconCircleChevron*`
            pair, direct request, since the caret notch reads bigger/bolder
            at the same 24px size than the thinner chevron did), stacked
            *on top of* a same-size, paper-colored `IconCircleFilled`
            backdrop, at whichever edge the *same* piece actually continues
            across, pointing in the direction it continues.
            The two-layer stack exists because `IconCircleCaretRightFilled`
            (like its chevron sibling before it) is a single SVG path where
            the caret notch is a transparent *cutout* (fill-rule hole), not
            an explicitly-colored fill — on its own it reads correctly only
            by coincidence, by revealing whatever's directly behind the
            badge in the DOM, which isn't guaranteed to be plain page
            background this close to a dashed border/lane seam. Rather than
            abandon this nicer, standard icon family for a hand-assembled
            substitute (tried and reverted: a plain `IconChevronRight`/`Left`
            foreground, then a solid `IconCaretRightFilled`/`Left`
            foreground, both explicitly colored `text-paper` on top of the
            same backdrop circle — both worked but neither looked as
            polished as the real icon), the fix is to control what's
            *directly behind* the cutout instead: an `IconCircleFilled` of
            the exact same size, explicitly colored `text-paper`, absolutely
            stacked directly underneath. The caret cutout now always
            reveals that deliberate paper circle, never the border/lane
            content further beneath — the two circles are the same
            footprint, so nothing peeks out around the edges. This
            architecture is what let the caret swap above be a one-line
            icon-name change with no risk of reintroducing bleed-through —
            it's robust to *any* single-cutout Tabler icon placed as the
            foreground, not just the chevron it was first built for.
            Never coincides with a diagonal edge:
            diagonalLeft/Right mean *this* segment is the piece's own true
            start/end, wrapsFromPrevRow/ToNextRow mean the opposite (more of
            this exact piece before/after this row) — computeLaneSegments
            only ever sets one or the other per edge, never both.
            This is a *third* overlay grid, rendered after the real tiles
            grid rather than inside the lane grid above — two real bugs
            fixed by that, in order: (1) nested inside a lane div, a chevron
            inherited that div's own `mask-image` on diagonal segments —
            `mask-image` clips its entire painted subtree, not just the
            element's own background/border, so the icon rendered as a
            broken, partially-cut-off shape. Moving it to its own unmasked
            grid cell fixed that. (2) even unmasked, the circle badge still
            painted *underneath* the real tile squares on either side of it
            — this grid and the lane grid are both `position: absolute`,
            the tiles grid is `position: relative`, and among positioned
            siblings with no z-index it's DOM order that decides paint
            order, so a badge grid sitting *before* the tiles grid in the
            markup always lost to them, leaving only the sliver of circle
            that happened to fall inside the gap between tiles visible (a
            lens/kite shape, not a circle) — direct screenshot report. Fix:
            this grid is now the *last* sibling, so it paints in front of
            both lanes and tiles. */}
        <div
          className="pointer-events-none absolute inset-0 grid grid-cols-3 gap-3 sm:grid-cols-6"
          style={{ gridTemplateRows: `repeat(${totalRows}, 1fr)` }}
        >
          {laneSegments
            .filter((seg) => seg.wrapsToNextRow || seg.wrapsFromPrevRow)
            .map((seg) => (
              <div
                key={`${seg.key}-wrap`}
                className="relative"
                style={{
                  gridColumn: `${seg.colStart + 1} / ${seg.colEnd + 1}`,
                  gridRow: seg.row + 1,
                }}
              >
                {seg.wrapsToNextRow && (
                  <span className="absolute top-1/2 -right-[12px] flex size-6 -translate-y-1/2 items-center justify-center">
                    <IconCircleFilled size={24} className="absolute text-paper" />
                    <IconCircleCaretRightFilled
                      size={24}
                      className="absolute"
                      style={{ color: seg.color }}
                    />
                  </span>
                )}
                {seg.wrapsFromPrevRow && (
                  <span className="absolute top-1/2 -left-[12px] flex size-6 -translate-y-1/2 items-center justify-center">
                    <IconCircleFilled size={24} className="absolute text-paper" />
                    <IconCircleCaretLeftFilled
                      size={24}
                      className="absolute"
                      style={{ color: seg.color }}
                    />
                  </span>
                )}
              </div>
            ))}
        </div>
      </div>

      {/* Bottom pill-row summary — a locked element from the very first
          design pass, dropped in one mid-session rewrite and explicitly
          asked to be restored. Fully derived from state, not tracked
          separately. */}
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {pieces.map((piece, index) => (
          // key is the array index, not piece.start — a bridge page
          // legitimately produces two adjacent pieces sharing the same
          // start (see computeLayout), and keying by that shared value
          // gave React two list items with an identical key. React can't
          // tell those apart during reconciliation and started reusing/
          // misattributing DOM nodes between them — the actual cause of
          // the "erroneous extra pills" (stale text left behind, pieces
          // showing the wrong range) that combos of skips+splits surfaced.
          // The array itself was always correct; only the keying was
          // wrong. Positional index is safe here since this list has no
          // per-item local state and is fully recomputed every render.
          <span
            key={index}
            className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs"
            style={{ borderColor: piece.color, backgroundColor: `${piece.color}1a` }}
          >
            <span className="size-1.5 rounded-full" style={{ backgroundColor: piece.color }} />
            Piece {index + 1} • {piece.end !== piece.start ? 'pp.' : 'p.'}{' '}
            {piece.start + PAGE_OFFSET}
            {piece.end !== piece.start ? `–${piece.end + PAGE_OFFSET}` : ''}
          </span>
        ))}
        {state.skips.size > 0 && (
          <span className="flex items-center gap-1.5 rounded-full border border-border border-dashed bg-paper-sunken px-3 py-1 text-xs text-ink-soft">
            Skipped • p. {formatPageList([...state.skips].map((p) => p + PAGE_OFFSET))}
          </span>
        )}
      </div>

      {/* Floating action bar — only appears once a genuine drag (not a
          plain tap) has produced a real range. */}
      {selection && (
        <div className="flex w-fit items-center gap-2 rounded-full bg-ink py-1.5 pr-1.5 pl-4 text-white shadow-lg">
          <span className="text-sm font-medium">
            {selection[1] - selection[0] + 1} pages selected
          </span>
          <button
            type="button"
            onClick={() => resolveSelection('group')}
            className="rounded-full bg-accent-on-dark px-3 py-1.5 text-xs font-semibold text-ink hover:brightness-95"
          >
            Make this one piece
          </button>
          <button
            type="button"
            onClick={() => resolveSelection('skip')}
            className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/15"
          >
            Skip these
          </button>
          <button
            type="button"
            onClick={clearSelection}
            aria-label="Cancel selection"
            className="flex size-7 items-center justify-center rounded-full text-white/60 hover:text-white"
          >
            <IconX size={14} />
          </button>
        </div>
      )}

      {/* Cancel upload shares this row with Next — see
          UploadBookAboutMockup.tsx's own comment on this same row for the
          full placement/styling reasoning. */}
      <div className="flex items-center justify-between border-t border-border pt-5">
        <button
          type="button"
          onClick={handleCancelUpload}
          className="flex cursor-pointer items-center gap-1.5 text-base text-red-700 hover:text-red-800"
        >
          <IconX size={24} />
          Cancel upload
        </button>
        <button
          type="button"
          onClick={() => console.log('Mockup: advance to Piece Titles', { state, pieces })}
          className="flex cursor-pointer items-center gap-1.5 rounded-md bg-accent px-5 py-2.5 font-display font-medium text-white hover:bg-accent/90"
        >
          Next
          <IconArrowRight size={16} />
        </button>
      </div>

      {/* Long-press / right-click menu — every reachable state for the one
          page it's anchored to, each paired with the same icon its badge
          uses elsewhere on this screen so the choice reads consistently. */}
      {contextMenu && (
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-50 min-w-56 rounded-lg border border-border bg-paper-raised py-1 shadow-lg"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="px-3 pt-1 pb-1.5 text-xs text-ink-soft">
            p.{contextMenu.page + PAGE_OFFSET}
          </div>
          {(() => {
            // Kept in sync with the real BookUploadSplitStep.tsx — see
            // that file's own comment for the page-1 special case.
            const rawState = currentCycleState(contextMenu.page, state)
            const effectiveState =
              contextMenu.page === 1 && rawState === 'normal' ? 'start' : rawState
            return pageMenuItems(contextMenu.page).map((item) => {
              const isCurrent = item.target === effectiveState
              return (
                <button
                  key={item.target}
                  role="menuitem"
                  type="button"
                  disabled={isCurrent}
                  aria-current={isCurrent || undefined}
                  onClick={() => {
                    setState((s) => setPageState(contextMenu.page, item.target, s, PAGE_COUNT))
                    touchedRef.current.add(contextMenu.page)
                    setContextMenu(null)
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                    isCurrent
                      ? 'cursor-default text-ink-soft/60'
                      : 'cursor-pointer text-ink hover:bg-paper'
                  }`}
                >
                  <span className="text-ink-soft">{item.icon}</span>
                  {item.label}
                </button>
              )
            })
          })()}
        </div>
      )}
    </div>
  )
}
