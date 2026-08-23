import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconArrowLeft,
  IconArrowRight,
  IconScissors,
  IconEyeOff,
  IconArrowsLeftRight,
  IconDots,
  IconX,
} from '@tabler/icons-react'
import { useMockupTitle } from '../lib/useMockupTitle'
import {
  applyRangeAction,
  computeLayout,
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
// ---------------------------------------------------------------------

const PAGE_COUNT = 8
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
// its two real states (see setPageState's comment on why 'shared' isn't
// one of them).
function pageMenuItems(page: number): PageMenuItem[] {
  if (page === 1) {
    return [
      { label: 'Start piece here', icon: <IconScissors size={14} />, target: 'start' },
      { label: 'Skip this page', icon: <IconEyeOff size={14} />, target: 'skip' },
    ]
  }
  return [
    { label: 'Start a new piece', icon: <IconScissors size={14} />, target: 'start' },
    { label: 'Split page (finish previous, start new)', icon: <IconArrowsLeftRight size={14} />, target: 'shared' },
    { label: 'Skip this page', icon: <IconEyeOff size={14} />, target: 'skip' },
    { label: 'Clear (plain page)', icon: <IconX size={14} />, target: 'normal' },
  ]
}

function PageThumb({ page }: { page: number }) {
  const blank = page === 4
  return (
    <svg viewBox="0 0 100 130" className="block h-auto w-full">
      <rect x="0.5" y="0.5" width="99" height="129" fill={blank ? '#f7f5f0' : '#fffdf9'} stroke="#e4e0d8" />
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
        {page}
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
  const [contextMenu, setContextMenu] = useState<{ page: number; x: number; y: number } | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const pieces = computeLayout(state, PAGE_COUNT)
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
        setState((s) => cyclePage(dragAnchor, s, PAGE_COUNT, shiftHeldRef.current ? 'backward' : 'forward', wasTouched))
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
        (design doc §5). Not wired to real data — genuinely interactive: tap a page to cycle its state, press-hold
        and drag to select a range.
      </div>

      {/* Wizard chrome — identical to Screen 3's, carried forward verbatim. */}
      <div className="flex items-center justify-between">
        <button type="button" className="flex items-center gap-1.5 text-base text-ink-soft hover:text-ink">
          <IconArrowLeft size={24} />
          Back
        </button>
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-xs text-ink-soft">
            Step {CURRENT_STEP} of {TOTAL_STEPS}
          </span>
          <div className="flex gap-1.5">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((step) => (
              <span
                key={step}
                className={`h-1 w-5 rounded-full ${
                  step < CURRENT_STEP ? 'bg-accent-on-dark' : step === CURRENT_STEP ? 'bg-accent' : 'bg-border'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      <div>
        <h1 className="font-display text-2xl font-medium text-ink">Mark where each piece begins</h1>
        <p className="text-sm text-ink-soft">
          Tap a page to start a new piece there, tap again to also mark it as finishing the piece before it, again to
          clear it, and again to skip it — shift-click to step backward instead. Press and hold, then drag, to select
          a run of pages at once. Long-press or right-click a page to pick its state directly.
        </p>
      </div>

      <div
        ref={gridRef}
        className="grid grid-cols-3 gap-3 touch-none select-none sm:grid-cols-6"
        onPointerMove={handlePointerMove}
      >
        {Array.from({ length: PAGE_COUNT }, (_, i) => i + 1).map((page) => {
          const isSkip = state.skips.has(page)
          const pieceIdx = pieceIndexForPage(pieces, page)
          const piece = pieces[pieceIdx]
          const isStart = page === piece?.start
          const isSharedStart = isStart && state.shared.has(page)
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
          // requested — not fighting the invariants to get it.
          const badgeKind: 'start' | 'shared' | 'pending' | 'skip' | null = isSharedStart
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
          // bug in this app's own styles — so a shared/split page rendered
          // with square corners while every other page had rounded ones.
          // sharedGradient carries the same two-color diagonal as a plain
          // `background`, painted on a padded outer box instead (padding
          // equal to the border width, radius on both the outer box and
          // an inner overflow-hidden wrapper) — that combination respects
          // rounding the way `border-image` never does.
          let borderStyle: React.CSSProperties = {}
          let sharedGradient: string | null = null
          if (badgeKind === 'skip') {
            borderStyle = { borderStyle: 'dashed', borderColor: '#c9c2b6' }
          } else if (badgeKind === 'shared') {
            // The previous-piece half is tinted (~38% alpha) UNLESS that
            // "previous piece" is actually the synthetic bridge piece
            // sharing this same start page (a gap sits right before this
            // page, so there's no real adjacent piece to tint against) —
            // that bridge piece has no plain-member neighbor of its own
            // to visually match, so it stays full strength, same as any
            // other start page would.
            const prevPiece = pieces[pieceIdx - 1]
            const prevIsBridgeCounterpart = prevPiece && prevPiece.start === piece.start
            const prevColor = prevPiece
              ? prevIsBridgeCounterpart
                ? prevPiece.color
                : `${prevPiece.color}61`
              : piece.color
            sharedGradient = `linear-gradient(135deg, ${prevColor} 50%, ${piece.color} 50%)`
          } else if (badgeKind === 'start') {
            borderStyle = { borderColor: piece.color }
          } else {
            // Any plain member page — pending (still-open piece) or
            // already closed — gets the same tinted border. Reserving
            // full-strength solid color for pages that were actually
            // tapped (start/shared) reads more clearly than only tinting
            // the open piece's pages: a page with no badge never looked
            // meaningfully different from a page you explicitly marked,
            // which was the actual complaint.
            borderStyle = { borderColor: `${piece.color}61` } // ~38% alpha
          }

          return (
            <div key={page} className="flex flex-col items-center gap-1">
              <div
                data-page={page}
                className="relative w-full cursor-pointer"
                onPointerDown={(e) => {
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
                  <div className="overflow-hidden rounded-md p-[2px]" style={{ background: sharedGradient }}>
                    <div className="overflow-hidden rounded-[4px]">
                      <PageThumb page={page} />
                    </div>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-md border-2 transition-shadow" style={borderStyle}>
                    <PageThumb page={page} />
                  </div>
                )}
                {isSelected && (
                  <div className="pointer-events-none absolute inset-0 rounded-md bg-accent/15 outline outline-3 outline-offset-2 outline-accent" />
                )}
                {badgeKind && (
                  <span className="absolute top-1 right-1 flex size-[18px] items-center justify-center rounded bg-ink/75 text-white">
                    {badgeKind === 'skip' && <IconEyeOff size={11} />}
                    {badgeKind === 'shared' && <IconArrowsLeftRight size={11} />}
                    {badgeKind === 'start' && <IconScissors size={11} />}
                    {badgeKind === 'pending' && <IconDots size={12} />}
                  </span>
                )}
              </div>
              <span className="text-[0.65rem] text-ink-soft">p.{page}</span>
            </div>
          )
        })}
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
            Piece {index + 1} • pp {piece.start}
            {piece.end !== piece.start ? `–${piece.end}` : ''}
          </span>
        ))}
        {state.skips.size > 0 && (
          <span className="flex items-center gap-1.5 rounded-full border border-border border-dashed bg-paper-sunken px-3 py-1 text-xs text-ink-soft">
            Skipped • p {formatPageList([...state.skips])}
          </span>
        )}
      </div>

      {/* Floating action bar — only appears once a genuine drag (not a
          plain tap) has produced a real range. */}
      {selection && (
        <div className="flex w-fit items-center gap-2 rounded-full bg-ink py-1.5 pr-1.5 pl-4 text-white shadow-lg">
          <span className="text-sm font-medium">{selection[1] - selection[0] + 1} pages selected</span>
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

      <div className="flex justify-end border-t border-border pt-5">
        <button
          type="button"
          onClick={() => console.log('Mockup: advance to Piece Titles', { state, pieces })}
          className="flex items-center gap-1.5 rounded-md bg-accent px-5 py-2.5 font-display font-medium text-white hover:bg-accent/90"
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
          <div className="px-3 pt-1 pb-1.5 text-xs text-ink-soft">p.{contextMenu.page}</div>
          {pageMenuItems(contextMenu.page).map((item) => (
            <button
              key={item.target}
              role="menuitem"
              type="button"
              onClick={() => {
                setState((s) => setPageState(contextMenu.page, item.target, s, PAGE_COUNT))
                touchedRef.current.add(contextMenu.page)
                setContextMenu(null)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-paper"
            >
              <span className="text-ink-soft">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
