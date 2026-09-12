import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconArrowLeft,
  IconArrowRight,
  IconBoxMultiple1,
  IconBoxMultiple2,
  IconBoxMultiple3,
  IconChevronRightPipe,
  IconCircleCaretLeftFilled,
  IconCircleCaretRightFilled,
  IconCircleFilled,
  IconFile,
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
// interaction model (tap cycle, shift-click to select a page range,
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
  // Whether this mode finishes a piece that's already been running since
  // earlier pages — rendered as the same IconChevronRightPipe tile the
  // page's own corner badge shows for 'shared'/'double', so "finishes
  // previous" reads identically in both places instead of only on the tile.
  finishesPrevious?: boolean
}

// Long-press (touch) or right-click (desktop) opens a menu offering every
// reachable state directly, instead of stepping through the tap cycle.
// Page 1 only offers its three real states (see setPageState's comment on
// why 'shared' isn't one of them).
//
// Icon encodes how many pieces *begin* on this exact page — one
// (IconBoxMultiple1) for 'start'/'shared', two (IconBoxMultiple2) for
// 'single'/'double' — "Begin and split" and "Finish previous and split
// twice" both close a synthetic one-page bridge piece here in addition to
// the piece that continues forward (see PageAssignments' own comment in
// pieceSplitLogic.ts). Whether a piece already running from before also
// finishes right on this page is a separate, independent axis — carried
// by `finishesPrevious` above, not folded into the count icon itself.
// "Start three pieces" (target: 'triple') extends that same counting
// logic one step further — two synthetic bridges in a row, then the real
// continuing piece — and never finishes anything that ran before it.
function pageMenuItems(page: number): PageMenuItem[] {
  if (page === 1) {
    return [
      { label: 'Start piece here', icon: <IconBoxMultiple1 size={14} />, target: 'start' },
      { label: 'Start two pieces', icon: <IconBoxMultiple2 size={14} />, target: 'single' },
      { label: 'Skip this page', icon: <IconX size={14} />, target: 'skip' },
    ]
  }
  return [
    { label: 'Start a new piece', icon: <IconBoxMultiple1 size={14} />, target: 'start' },
    {
      label: 'Finish previous and start a new piece',
      icon: <IconBoxMultiple1 size={14} />,
      target: 'shared',
      finishesPrevious: true,
    },
    { label: 'Start two pieces', icon: <IconBoxMultiple2 size={14} />, target: 'single' },
    {
      label: 'Finish previous and start two pieces',
      icon: <IconBoxMultiple2 size={14} />,
      target: 'double',
      finishesPrevious: true,
    },
    { label: 'Start three pieces', icon: <IconBoxMultiple3 size={14} />, target: 'triple' },
    { label: 'Skip this page', icon: <IconX size={14} />, target: 'skip' },
    { label: 'Reset page', icon: <IconFile size={14} />, target: 'normal' },
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
  // The resolved multi-page range (shift-click's own target) — real state,
  // since it drives the highlight overlay and the floating action bar's
  // visibility.
  const [selection, setSelection] = useState<[number, number] | null>(null)
  // The last *plain*-clicked page — a shift-click ranges from here to
  // whatever page is shift-clicked next, same "anchor stays fixed until a
  // plain click moves it" convention file managers use for range-select.
  // A ref, not state: it has no visual representation of its own (only
  // `selection` above needs to trigger a re-render).
  const anchorRef = useRef<number | null>(null)
  // Which page the pointer actually went down on — read by the global
  // pointerup handler below to know which page a resolved tap/shift-click
  // applies to.
  const pressedPageRef = useRef<number | null>(null)
  const isPointerDownRef = useRef(false)
  // Set once the long-press timer (or a right-click) has already opened
  // the context menu for this exact press — checked by the pointerup
  // handler so releasing the button afterward doesn't *also* resolve as a
  // tap/shift-click on top of whatever the menu already did.
  const suppressTapRef = useRef(false)
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
  // Modal.tsx's own prop-sync bug: the pointerup effect below only
  // depends on `[pageCount, touchedRef]` — both effectively fixed for the
  // component's whole life — so it subscribes essentially once and would
  // otherwise close over whatever `state`/`setState` were on that very
  // first render, forever, no matter how many times the context menu or
  // anything else changes state afterward. Mirrored refs, kept fresh via
  // an effect (not a direct render-time assignment — this app's lint rules
  // for the React Compiler flag that as unsafe) rather than a functional
  // updater, sidestep this. Since the effect runs after every commit,
  // before any subsequent real user interaction can fire, the ref is
  // always fresh by the time the pointerup handler actually reads it.
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

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  // A single global listener rather than a per-tile onClick: it needs to
  // run even if the pointer drifted slightly between down and up (pointer
  // capture, set in onPointerDown below, keeps both targeting the same
  // tile regardless), and it's the one place that already knows whether a
  // long-press/right-click beat it to opening the menu for this exact
  // press (`suppressTapRef`). Reads `stateRef`/`setStateRef`, not
  // `state`/`setState` directly — see those refs' own comment above for
  // why a controlled `state` prop needs this indirection here.
  useEffect(() => {
    function handlePointerUp(event: PointerEvent) {
      if (!isPointerDownRef.current) return
      isPointerDownRef.current = false
      clearLongPressTimer()
      if (suppressTapRef.current) {
        // The long-press timer (or a right-click) already opened the
        // context menu for this exact press — releasing the button here
        // must not *also* resolve as a tap/shift-click on top of that.
        suppressTapRef.current = false
        return
      }
      const page = pressedPageRef.current
      if (page === null) return
      if (event.shiftKey && anchorRef.current !== null && anchorRef.current !== page) {
        // Range from the fixed anchor to this page — never cycles state,
        // and never moves the anchor, so a further shift-click can still
        // extend/shrink the same range from that same fixed point.
        setSelection([Math.min(anchorRef.current, page), Math.max(anchorRef.current, page)])
        return
      }
      // A plain click (or a shift-click with no usable anchor yet): cycle
      // this page's state, adopt it as the new anchor, and drop any
      // pending range — a plain click always starts fresh.
      const wasTouched = touchedRef.current.has(page)
      touchedRef.current.add(page)
      setStateRef.current(cyclePage(page, stateRef.current, pageCount, 'forward', wasTouched))
      anchorRef.current = page
      setSelection(null)
    }
    window.addEventListener('pointerup', handlePointerUp)
    return () => window.removeEventListener('pointerup', handlePointerUp)
  }, [pageCount, touchedRef])

  function clearSelection() {
    anchorRef.current = null
    setSelection(null)
  }

  function openPageMenu(page: number, x: number, y: number) {
    suppressTapRef.current = true
    clearLongPressTimer()
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
          before it, again to clear it, and again to skip it. Shift-click a second page to select
          every page in between as one run. Long-press or right-click a page to pick its state
          directly.
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

        <div className="relative grid grid-cols-3 gap-3 touch-none select-none sm:grid-cols-6">
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => {
            const isSkip = state.skips.has(page)
            const pieceIdx = pieceIndexForPage(pieces, page)
            const piece = pieces[pieceIdx]
            const isStart = page === piece?.start
            const isSharedStart = isStart && state.shared.has(page)
            const isSingleStart = isStart && (state.single?.has(page) ?? false)
            const isDoubleStart = isStart && (state.double?.has(page) ?? false)
            const isTripleStart = isStart && (state.triple?.has(page) ?? false)
            const isPending = piece?.isLast && !isStart && !isSkip && page !== pageCount
            const isSelected = selection && page >= selection[0] && page <= selection[1]

            // 'single', 'double', 'triple', and 'shared' never collide with
            // each other (setPageState keeps them mutually exclusive), so
            // their relative priority here doesn't matter in practice —
            // most specific first, matching UploadBookSplitMockup.tsx.
            const badgeKind:
              | 'single'
              | 'double'
              | 'triple'
              | 'start'
              | 'shared'
              | 'pending'
              | 'skip'
              | null = isTripleStart
              ? 'triple'
              : isDoubleStart
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
            } else if (badgeKind === 'triple') {
              // "Start three pieces" — also a three-stop diagonal, same
              // shape as 'double' just above, but never finishing anything
              // that ran before it: both pieces[pieceIdx-1] and
              // pieces[pieceIdx-2] are computeLayout's own two synthetic
              // one-page bridges for this exact start (pushed
              // unconditionally, same "always a genuine same-page
              // beginning" reasoning 'single'/'double' already use) — so,
              // unlike 'double', neither ever needs prevColor's tinting:
              // there's no real earlier piece in this picture at all.
              const bridge2 = pieces[pieceIdx - 1]
              const bridge2Color = bridge2 ? bridge2.color : piece.color
              const bridge1 = pieces[pieceIdx - 2]
              const bridge1Color = bridge1 ? bridge1.color : piece.color
              sharedGradient = `linear-gradient(135deg, ${bridge1Color} 33%, ${bridge2Color} 33% 67%, ${piece.color} 67%)`
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
                  // without this guard it would also arm the long-press
                  // timer below, and releasing the right button then fired
                  // the same single-page cycle a left click would — the
                  // reported bug: right-click did both, not just open the
                  // menu. Bail before touching any state so the only thing
                  // a right-click does is what onContextMenu below already
                  // handles.
                  if (e.button !== 0) return
                  e.preventDefault()
                  // Keeps subsequent pointermove/pointerup events targeting
                  // this exact tile even if the pointer drifts elsewhere
                  // before release — this is what lets the plain
                  // onPointerUp listener above always know which page was
                  // actually pressed, and lets the move-cancels-long-press
                  // check just below fire reliably for a mouse (unlike
                  // touch, a mouse isn't implicitly captured to its down
                  // target).
                  e.currentTarget.setPointerCapture(e.pointerId)
                  isPointerDownRef.current = true
                  suppressTapRef.current = false
                  pressedPageRef.current = page
                  longPressOriginRef.current = { x: e.clientX, y: e.clientY }
                  clearLongPressTimer()
                  const { clientX, clientY } = e
                  longPressTimerRef.current = setTimeout(() => {
                    openPageMenu(page, clientX, clientY)
                  }, LONG_PRESS_MS)
                }}
                onPointerMove={(e) => {
                  // A finger/cursor that's clearly moving is a scroll or a
                  // drag, not holding still for a long-press — cancel the
                  // pending timer rather than popping the menu out from
                  // under it. No range-tracking here — a range is formed by
                  // two separate clicks (shift-click), never by dragging.
                  if (!isPointerDownRef.current || !longPressOriginRef.current) return
                  const dx = e.clientX - longPressOriginRef.current.x
                  const dy = e.clientY - longPressOriginRef.current.y
                  if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_CANCEL_PX) clearLongPressTimer()
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
                  <span className="absolute top-1 right-1 flex items-center gap-1">
                    {/* A second, distinct tile — not folded into the mode
                        badge itself — for the two modes where a piece
                        already running from earlier pages finishes right
                        here ('shared'/'double', both "Finish previous and
                        start..."): the pipe marks where that incoming piece
                        stops, the chevron whichever direction it arrived
                        from. 'pending' (a plain member page riding along
                        inside a still-open piece) doesn't get one — that's
                        a derived state, not a mode the menu ever offers to
                        pick, and the Group Lane fill already carries its
                        own "continues" signal across every such page. */}
                    {(badgeKind === 'shared' || badgeKind === 'double') && (
                      <span className="flex size-6 items-center justify-center rounded-md bg-ink/75 text-white">
                        <IconChevronRightPipe size={14} />
                      </span>
                    )}
                    <span className="flex size-6 items-center justify-center rounded-md bg-ink/75 text-white">
                      {badgeKind === 'skip' && <IconX size={14} />}
                      {badgeKind === 'shared' && <IconBoxMultiple1 size={14} />}
                      {badgeKind === 'start' && <IconBoxMultiple1 size={14} />}
                      {badgeKind === 'single' && <IconBoxMultiple2 size={14} />}
                      {badgeKind === 'double' && <IconBoxMultiple2 size={14} />}
                      {badgeKind === 'triple' && <IconBoxMultiple3 size={14} />}
                      {badgeKind === 'pending' && <IconDots size={14} />}
                    </span>
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
                  <span className="flex items-center gap-1 text-ink-soft">
                    {item.finishesPrevious && <IconChevronRightPipe size={14} />}
                    {item.icon}
                  </span>
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
