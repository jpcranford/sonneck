import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconArrowLeft,
  IconArrowRight,
  IconArrowsSplit2,
  IconBoxMultiple2,
  IconCircleCaretLeftFilled,
  IconCircleCaretRightFilled,
  IconCircleFilled,
  IconFile,
  IconScissors,
  IconArrowsLeftRight,
  IconDots,
  IconX,
} from '@tabler/icons-react'
import { getBookPageThumbnailUrl } from '../api/books'
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
import { TOTAL_WIZARD_STEPS } from './BookUploadWizard'

// Book Upload Wizard, Screen 4 of 6: "Mark where each piece begins"
// (design doc §5's "split" step). Real build of UploadBookSplitMockup.tsx
// (/mockup/upload-book-split, kept as a standing design reference) — same
// interaction model (tap cycle, shift-click reverse, drag-select,
// long-press/right-click menu), wired to the real book's real page count
// and real page thumbnails instead of an 8-page fixture. The pure
// page-assignment algorithm itself lives in lib/pieceSplitLogic.ts,
// shared with the mockup — see that file's own comment for why.
//
// A controlled component: pageAssignments/onChange are lifted to
// BookUploadWizard so Back navigation doesn't lose the split. touchedPagesRef
// is also owned by the container and passed down (not created here) for
// the same reason — it's a plain ref, so creating it in this component
// would reset on every remount (e.g. Back then Next again), which would
// wrongly make an already-marked page's next tap force back to "start"
// instead of continuing the cycle from wherever it actually is.

const LONG_PRESS_MS = 500
const LONG_PRESS_MOVE_CANCEL_PX = 10
const CURRENT_STEP = 4

// A generic portrait-page guess (matches UploadBookSplitMockup.tsx's own
// placeholder SVG viewBox, 100x130) used only until the *real* aspect
// ratio is known — see the pageAspectRatio state's own comment for why a
// real measurement always wins once one exists.
const FALLBACK_PAGE_ASPECT_RATIO = 100 / 130

interface PageMenuItem {
  label: string
  icon: ReactNode
  target: CycleState
}

// "Begin and split" (target: 'single', added post-launch) is menu-only,
// not part of the plain tap cycle (see CYCLE_ORDER's own comment in
// pieceSplitLogic.ts) — distinct from "Finish previous and split" just
// above it: that one shares a page between two pieces
// where the *first* of the two was already running from earlier pages.
// This one closes a brand-new, self-contained one-page piece right on
// this exact page — cleanly split from whatever ran before it — and, on
// that same page, begins a second piece that stays open, continuing
// forward exactly like any other piece start would. One page belonging
// to two Piece entries this way isn't a new shape (see computeLayout's
// own synthetic-bridge case for `shared` after a skip) — this just
// triggers that shape directly, on request, instead of only as a side
// effect of a skip.
//
// "Finish previous and split twice" (target: 'double', ported from
// UploadBookSplitMockup.tsx once approved there) sits right after "Finish
// previous and split" — it's that same behavior *plus* "Begin and split"
// chained onto it: the previous piece still finishes exactly here, but
// instead of the new piece starting directly, a brand-new one-page piece
// closes immediately first, *then* the real continuing piece begins.
// Three Piece entries share this one page. `IconArrowsSplit2` (also used
// by "Begin and split" now) reads as a two-way fork, echoing
// `IconArrowsLeftRight`'s own arrow language for "Finish previous and
// split" just above it — `IconBoxMultiple2` marks "twice."
function pageMenuItems(page: number): PageMenuItem[] {
  if (page === 1) {
    return [
      { label: 'Start piece here', icon: <IconScissors size={14} />, target: 'start' },
      { label: 'Begin and split', icon: <IconArrowsSplit2 size={14} />, target: 'single' },
      { label: 'Skip this page', icon: <IconX size={14} />, target: 'skip' },
    ]
  }
  return [
    { label: 'Start a new piece', icon: <IconScissors size={14} />, target: 'start' },
    {
      label: 'Finish previous and split',
      icon: <IconArrowsLeftRight size={14} />,
      target: 'shared',
    },
    {
      label: 'Finish previous and split twice',
      icon: <IconBoxMultiple2 size={14} />,
      target: 'double',
    },
    { label: 'Begin and split', icon: <IconArrowsSplit2 size={14} />, target: 'single' },
    { label: 'Skip this page', icon: <IconX size={14} />, target: 'skip' },
    { label: 'Clear (plain page)', icon: <IconFile size={14} />, target: 'normal' },
  ]
}

interface BookUploadSplitStepProps {
  bookId: number
  pageCount: number
  // Printed-PDF page offset, set on Screen 3 ("About this book") — every
  // page number shown below is displayed offset-adjusted (physical +
  // pageOffset), matching what actually gets written to each piece's
  // SourcePageStart/SourcePageEnd at import; the grid's own interaction
  // logic (data-page, drag-select, pieceIndexForPage, computeLayout)
  // still runs against the raw physical page throughout, since that's
  // what extraction actually needs.
  pageOffset: number
  pageAssignments: PageAssignments
  onChange: (next: PageAssignments) => void
  touchedPagesRef: React.RefObject<Set<number>>
  onBack: () => void
  onNext: () => void
  onCancel: () => void
  cancelPending: boolean
}

export function BookUploadSplitStep({
  bookId,
  pageCount,
  pageOffset,
  pageAssignments: state,
  onChange: setState,
  touchedPagesRef: touchedRef,
  onBack,
  onNext,
  onCancel,
  cancelPending,
}: BookUploadSplitStepProps) {
  const [dragAnchor, setDragAnchor] = useState<number | null>(null)
  const [dragCurrent, setDragCurrent] = useState<number | null>(null)
  const isPointerDownRef = useRef(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const shiftHeldRef = useRef(false)
  const [contextMenu, setContextMenu] = useState<{ page: number; x: number; y: number } | null>(
    null,
  )
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Real bug, found live against a 400+ page book (never surfaced against
  // this screen's own small test fixtures, which load close enough to
  // instantly that the gap this fixes is never visible): each tile's
  // `<img loading="lazy">` has *no* declared size, so a page whose
  // thumbnail hasn't loaded yet — the overwhelming majority of a long
  // book's pages, most of them off-screen and not even requested yet
  // under lazy-loading — collapses its own grid row to near-zero height.
  // The Group Lane/chevron overlays both depend on every real row being
  // the *same* height (their own `repeat(totalRows, 1fr)` division is only
  // valid under that assumption — see their own comments) — a wildly
  // non-uniform mix of full-height (loaded) and collapsed (not-yet-loaded)
  // rows breaks that outright, which is what actually produced "lanes not
  // lining up with the thumbs at all" at real scale.
  //
  // Fix: every tile reserves its final height *before* its image has
  // loaded, via a wrapper `aspect-ratio` box, so every row is uniformly
  // sized regardless of load state — the placeholder protects the layout,
  // then the real thumbnail hot-swaps in on top of it once it's ready.
  // `pageAspectRatio` is shared (not per-tile) specifically so a
  // not-yet-loaded page's placeholder uses the *real*, measured ratio the
  // moment any other page on the same book has already revealed it — one
  // real PDF's pages are always uniform aspect ratio in practice (the same
  // assumption the lane math itself already depends on), so the first
  // loaded thumbnail is as good a source of truth as any. Falls back to
  // FALLBACK_PAGE_ASPECT_RATIO only for the brief window before literally
  // anything has loaded.
  const [pageAspectRatio, setPageAspectRatio] = useState<number | null>(null)
  const [loadedPages, setLoadedPages] = useState<Set<number>>(new Set())
  const handleThumbnailLoad = useCallback(
    (page: number, event: React.SyntheticEvent<HTMLImageElement>) => {
      const img = event.currentTarget
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setPageAspectRatio((current) => current ?? img.naturalWidth / img.naturalHeight)
      }
      setLoadedPages((current) => {
        if (current.has(page)) return current
        const next = new Set(current)
        next.add(page)
        return next
      })
    },
    [],
  )

  // The mockup this was ported from kept `state` in a local `useState` and
  // read it via a functional updater (`setState((s) => cyclePage(..., s))`)
  // inside the pointerup effect below, which is always fresh regardless of
  // the effect's own dependency array. Here `state`/`setState` are
  // controlled props instead (lifted to the wizard container so Back
  // navigation doesn't lose the split), which reintroduces exactly the
  // stale-closure trap this project has already hit once before with
  // Modal.tsx's own prop-sync bug: the pointerup effect only re-subscribes
  // when `dragAnchor`/`dragCurrent` change, so a `state`/`onChange` value
  // closed over from a stale render would silently go out of date if
  // anything else (e.g. the context menu) changed state without also
  // changing drag position. Mirrored refs, kept fresh via an effect (not a
  // direct render-time assignment — this app's lint rules for the React
  // Compiler flag that as unsafe) rather than a functional updater,
  // sidestep this. Since the effect runs after every commit, before any
  // subsequent real user interaction can fire, the ref is always fresh by
  // the time the pointerup handler actually reads it.
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])
  const setStateRef = useRef(setState)
  useEffect(() => {
    setStateRef.current = setState
  }, [setState])

  const pieces = computeLayout(state, pageCount)
  const columns = useGridColumns()
  const laneSegments = computeLaneSegments(pieces, columns)
  const totalRows = Math.ceil(pageCount / columns)
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
        const wasTouched = touchedRef.current.has(dragAnchor)
        touchedRef.current.add(dragAnchor)
        setStateRef.current(
          cyclePage(
            dragAnchor,
            stateRef.current,
            pageCount,
            shiftHeldRef.current ? 'backward' : 'forward',
            wasTouched,
          ),
        )
        setDragAnchor(null)
        setDragCurrent(null)
      }
    }
    window.addEventListener('pointerup', handlePointerUp)
    return () => window.removeEventListener('pointerup', handlePointerUp)
  }, [dragAnchor, dragCurrent, pageCount, touchedRef])

  const handlePointerMove = useCallback((event: React.PointerEvent) => {
    if (!isPointerDownRef.current) return
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

  function openPageMenu(page: number, x: number, y: number) {
    isPointerDownRef.current = false
    clearLongPressTimer()
    setDragAnchor(null)
    setDragCurrent(null)
    setContextMenu({ page, x, y })
  }

  function resolveSelection(action: 'group' | 'skip') {
    if (!selection) return
    setState(applyRangeAction(action, selection[0], selection[1], state, pageCount))
    for (let p = selection[0]; p <= selection[1]; p++) touchedRef.current.add(p)
    clearSelection()
  }

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
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex cursor-pointer items-center gap-1.5 text-base text-ink-soft hover:text-ink"
        >
          <IconArrowLeft size={24} />
          Back
        </button>
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-xs text-ink-soft">
            Step {CURRENT_STEP} of {TOTAL_WIZARD_STEPS}
          </span>
          <div className="flex gap-1.5">
            {Array.from({ length: TOTAL_WIZARD_STEPS }, (_, i) => i + 1).map((step) => (
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
            that same grid via explicit grid-column/grid-row (browsers
            reserve an explicitly-placed item's cells and route
            auto-placed siblings *around* them, scrambling the whole
            layout — confirmed live building the mockup this was ported
            from). Same column template/gap so column lines land in the
            same place; `grid-template-rows: repeat(rows, 1fr)` divides
            its own (absolutely-positioned, so definite-height) box evenly
            to match, which is only valid because every real row here is
            the same height (identical page-thumbnail aspect ratio
            throughout) — not a general solution if that ever stops being
            true. pointer-events-none throughout so drag-select/long-press
            (hit-testing via elementFromPoint) always resolves to the real
            tile, never a lane sitting in front of it. See
            UploadBookSplitMockup.tsx and lib/pieceLaneLayout.ts for the
            full design/bugfix history behind this. */}
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
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => {
            const isSkip = state.skips.has(page)
            const pieceIdx = pieceIndexForPage(pieces, page)
            const piece = pieces[pieceIdx]
            const isStart = page === piece?.start
            const isSharedStart = isStart && state.shared.has(page)
            const isSingleStart = isStart && (state.single?.has(page) ?? false)
            const isDoubleStart = isStart && (state.double?.has(page) ?? false)
            const isPending = piece?.isLast && !isStart && !isSkip && page !== pageCount
            const isSelected = selection && page >= selection[0] && page <= selection[1]

            // 'single', 'double', and 'shared' never collide with each
            // other (setPageState keeps them mutually exclusive), so their
            // relative priority here doesn't matter in practice — most
            // specific first, matching UploadBookSplitMockup.tsx.
            const badgeKind: 'single' | 'double' | 'start' | 'shared' | 'pending' | 'skip' | null =
              isDoubleStart
                ? 'double'
                : isSingleStart
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

            let borderStyle: React.CSSProperties = {}
            let sharedGradient: string | null = null
            if (badgeKind === 'skip') {
              // No border at all — kept as an invisible, same-width border
              // via a transparent color rather than dropping border-width
              // itself, so the grid doesn't visually jump when a page
              // toggles to/from skip. A skipped page is excluded content,
              // not a piece boundary. Paired with the thumbnail's own
              // reduced opacity (see the className below) and the badge
              // using a plain X rather than an eye-off icon.
              borderStyle = { borderColor: 'transparent' }
            } else if (badgeKind === 'shared') {
              const prevPiece = pieces[pieceIdx - 1]
              const prevIsBridgeCounterpart = prevPiece && prevPiece.start === piece.start
              const prevColor = prevPiece
                ? prevIsBridgeCounterpart
                  ? prevPiece.color
                  : `${prevPiece.color}61`
                : piece.color
              sharedGradient = `linear-gradient(135deg, ${prevColor} 50%, ${piece.color} 50%)`
            } else if (badgeKind === 'single') {
              // Same two-color diagonal as 'shared' just above, but both
              // halves stay full strength (not tinted) — pieces[pieceIdx-1]
              // is always the synthetic one-page piece computeLayout pushes
              // immediately before the continuing piece for a 'single'
              // start (the exact same "two Piece entries share one start"
              // shape as 'shared' after a skip), so this is that same
              // bridge-counterpart case 'shared' already special-cases to
              // full strength — just always true here, not only sometimes.
              const closedPiece = pieces[pieceIdx - 1]
              const closedColor = closedPiece ? closedPiece.color : piece.color
              sharedGradient = `linear-gradient(135deg, ${closedColor} 50%, ${piece.color} 50%)`
            } else if (badgeKind === 'double') {
              // "Finish previous and split twice" — three Piece entries
              // touch this one page, so this is a three-stop diagonal
              // instead of 'shared'/'single's two. pieces[pieceIdx-1] is
              // always the middle synthetic bridge (computeLayout pushes
              // it unconditionally, same as 'single' does) — full
              // strength, same "always a genuine same-page beginning"
              // reasoning 'single' already uses. pieces[pieceIdx-2] is
              // whichever piece precedes *that* bridge: the real previous
              // piece if one exists (tinted, unless it's itself a same-
              // page bridge-counterpart, mirroring 'shared's own
              // prevColor logic exactly), or undefined only if something
              // upstream is inconsistent. See UploadBookSplitMockup.tsx
              // for the full derivation.
              const middleBridge = pieces[pieceIdx - 1]
              const middleColor = middleBridge ? middleBridge.color : piece.color
              const prevPiece = pieces[pieceIdx - 2]
              const prevIsBridgeCounterpart = prevPiece && prevPiece.start === piece.start
              const prevColor = prevPiece
                ? prevIsBridgeCounterpart
                  ? prevPiece.color
                  : `${prevPiece.color}61`
                : piece.color
              sharedGradient = `linear-gradient(135deg, ${prevColor} 33%, ${middleColor} 33% 67%, ${piece.color} 67%)`
            } else if (badgeKind === 'start') {
              borderStyle = { borderColor: piece.color }
            } else if (badgeKind === 'pending') {
              // The still-open piece (no explicit closing boundary yet)
              // keeps a tinted dashed border — the one remaining real
              // signal a border still needs to carry: "this piece might not
              // be done." A genuinely plain member page (below) no longer
              // needs a border at all for the same purpose, since the Group
              // Lane background already shows which piece a page belongs to.
              borderStyle = { borderStyle: 'dashed', borderColor: `${piece.color}61` } // ~38% alpha
            } else {
              // Plain member page (badgeKind null) — no badge, no border.
              // Same transparent-border treatment as 'skip' above, for the
              // same reflow-avoidance reason. The Group Lane fill is now the
              // only thing marking a plain page as part of its piece.
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
                    <div
                      className="overflow-hidden rounded-[4px] bg-paper-sunken"
                      style={{ aspectRatio: pageAspectRatio ?? FALLBACK_PAGE_ASPECT_RATIO }}
                    >
                      <img
                        src={getBookPageThumbnailUrl(bookId, page)}
                        alt=""
                        loading="lazy"
                        onLoad={(e) => handleThumbnailLoad(page, e)}
                        className={`block h-auto w-full transition-opacity duration-300 ${
                          loadedPages.has(page) ? 'opacity-100' : 'opacity-0'
                        }`}
                      />
                    </div>
                  </div>
                ) : (
                  <div
                    className={`overflow-hidden rounded-md border-2 bg-paper-sunken transition-shadow ${
                      badgeKind === 'skip' ? 'opacity-40' : ''
                    }`}
                    style={{
                      ...borderStyle,
                      aspectRatio: pageAspectRatio ?? FALLBACK_PAGE_ASPECT_RATIO,
                    }}
                  >
                    <img
                      src={getBookPageThumbnailUrl(bookId, page)}
                      alt=""
                      loading="lazy"
                      onLoad={(e) => handleThumbnailLoad(page, e)}
                      className={`block h-auto w-full transition-opacity duration-300 ${
                        loadedPages.has(page) ? 'opacity-100' : 'opacity-0'
                      }`}
                    />
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
                    {badgeKind === 'single' && <IconArrowsSplit2 size={11} />}
                    {badgeKind === 'double' && <IconBoxMultiple2 size={11} />}
                    {badgeKind === 'pending' && <IconDots size={12} />}
                  </span>
                )}
                {/* In normal flow, inside this same per-page grid cell — see
                  UploadBookSplitMockup.tsx's own comment on why (a
                  separate captions grid stacked below the whole thing only
                  lines up by coincidence once there's more than one tile
                  row). Being a real DOM sibling inside the tile's own cell
                  makes correct placement automatic, and makes every real
                  tile row uniformly taller by exactly one caption's
                  height — which the Group Lane/chevron overlays below pick
                  up for free, since they already divide their own box into
                  totalRows equal fractions matching the real tiles grid's
                  own natural height. */}
                <span className="mt-1 block text-center text-[0.65rem] text-ink-soft">
                  p.{page + pageOffset}
                </span>
              </div>
            )
          })}
        </div>

        {/* Row-wrap continuation marks — a lane simply stopping at the
            row's right edge is indistinguishable from a piece that
            genuinely ends there by coincidence. A stacked pair at
            whichever edge the *same* piece actually continues across:
            `IconCircleFilled` (paper-colored) as an opaque backdrop,
            with `IconCircleCaretRightFilled`/`...LeftFilled` (colored to
            the wrapping lane) on top — see lib/pieceLaneLayout.ts and
            UploadBookSplitMockup.tsx for the full derivation of why this
            needs to be a two-layer stack, and why it's a *third* overlay
            grid rendered after the real tiles grid rather than inside the
            lane grid above. */}
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

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {pieces.map((piece, index) => (
          <span
            key={index}
            className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs"
            style={{ borderColor: piece.color, backgroundColor: `${piece.color}1a` }}
          >
            <span className="size-1.5 rounded-full" style={{ backgroundColor: piece.color }} />
            Piece {index + 1} • {piece.end !== piece.start ? 'pp.' : 'p.'}{' '}
            {piece.start + pageOffset}
            {piece.end !== piece.start ? `–${piece.end + pageOffset}` : ''}
          </span>
        ))}
        {state.skips.size > 0 && (
          <span className="flex items-center gap-1.5 rounded-full border border-border border-dashed bg-paper-sunken px-3 py-1 text-xs text-ink-soft">
            Skipped • p. {formatPageList([...state.skips].map((p) => p + pageOffset))}
          </span>
        )}
      </div>

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
          BookUploadAboutStep.tsx's own comment on this same row for the
          full placement/styling reasoning. */}
      <div className="flex items-center justify-between border-t border-border pt-5">
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelPending}
          className="flex cursor-pointer items-center gap-1.5 text-base text-red-700 hover:text-red-800 disabled:cursor-default disabled:opacity-45"
        >
          <IconX size={24} />
          Cancel upload
        </button>
        <button
          type="button"
          onClick={onNext}
          className="flex cursor-pointer items-center gap-1.5 rounded-md bg-accent px-5 py-2.5 font-display font-medium text-white hover:bg-accent/90"
        >
          Next
          <IconArrowRight size={16} />
        </button>
      </div>

      {contextMenu && (
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-50 min-w-56 rounded-lg border border-border bg-paper-raised py-1 shadow-lg"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="px-3 pt-1 pb-1.5 text-xs text-ink-soft">
            p.{contextMenu.page + pageOffset}
          </div>
          {(() => {
            // Page 1 has no 'normal' menu option (no "Clear" entry — see
            // pageMenuItems) because its own default/untouched state
            // already reads as 'normal' from currentCycleState, even
            // though it's semantically page 1's implicit start: setPageState's
            // own page-1 branch never adds anything for target 'start', so
            // picking "Start piece here" on an untouched page 1 is a true
            // no-op, identical before and after. Treat 'normal' as 'start'
            // for page 1 specifically so that option greys out too,
            // instead of nothing in the menu ever reading as "current."
            const rawState = currentCycleState(contextMenu.page, state)
            const effectiveState =
              contextMenu.page === 1 && rawState === 'normal' ? 'start' : rawState
            return pageMenuItems(contextMenu.page).map((item) => {
              // The option matching the page's own current state isn't a
              // real choice — picking it would be a no-op — so it's greyed
              // out and unclickable rather than left looking identical to
              // every other, actually-actionable option.
              const isCurrent = item.target === effectiveState
              return (
                <button
                  key={item.target}
                  role="menuitem"
                  type="button"
                  disabled={isCurrent}
                  aria-current={isCurrent || undefined}
                  onClick={() => {
                    setState(setPageState(contextMenu.page, item.target, state, pageCount))
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
