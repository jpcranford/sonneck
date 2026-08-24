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
import { getBookPageThumbnailUrl } from '../api/books'
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

interface PageMenuItem {
  label: string
  icon: ReactNode
  target: CycleState
}

function pageMenuItems(page: number): PageMenuItem[] {
  if (page === 1) {
    return [
      { label: 'Start piece here', icon: <IconScissors size={14} />, target: 'start' },
      { label: 'Skip this page', icon: <IconEyeOff size={14} />, target: 'skip' },
    ]
  }
  return [
    { label: 'Start a new piece', icon: <IconScissors size={14} />, target: 'start' },
    {
      label: 'Split page (finish previous, start new)',
      icon: <IconArrowsLeftRight size={14} />,
      target: 'shared',
    },
    { label: 'Skip this page', icon: <IconEyeOff size={14} />, target: 'skip' },
    { label: 'Clear (plain page)', icon: <IconX size={14} />, target: 'normal' },
  ]
}

interface BookUploadSplitStepProps {
  bookId: number
  pageCount: number
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
          className="flex items-center gap-1.5 text-base text-ink-soft hover:text-ink"
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

      <div
        ref={gridRef}
        className="grid grid-cols-3 gap-3 touch-none select-none sm:grid-cols-6"
        onPointerMove={handlePointerMove}
      >
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => {
          const isSkip = state.skips.has(page)
          const pieceIdx = pieceIndexForPage(pieces, page)
          const piece = pieces[pieceIdx]
          const isStart = page === piece?.start
          const isSharedStart = isStart && state.shared.has(page)
          const isPending = piece?.isLast && !isStart && !isSkip && page !== pageCount
          const isSelected = selection && page >= selection[0] && page <= selection[1]

          const badgeKind: 'start' | 'shared' | 'pending' | 'skip' | null = isSharedStart
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
            borderStyle = { borderStyle: 'dashed', borderColor: '#c9c2b6' }
          } else if (badgeKind === 'shared') {
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
            borderStyle = { borderColor: `${piece.color}61` }
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
                  <div
                    className="overflow-hidden rounded-md p-[2px]"
                    style={{ background: sharedGradient }}
                  >
                    <div className="overflow-hidden rounded-[4px]">
                      <img
                        src={getBookPageThumbnailUrl(bookId, page)}
                        alt=""
                        loading="lazy"
                        className="block h-auto w-full"
                      />
                    </div>
                  </div>
                ) : (
                  <div
                    className="overflow-hidden rounded-md border-2 transition-shadow"
                    style={borderStyle}
                  >
                    <img
                      src={getBookPageThumbnailUrl(bookId, page)}
                      alt=""
                      loading="lazy"
                      className="block h-auto w-full"
                    />
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

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {pieces.map((piece, index) => (
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
          className="flex items-center gap-1.5 text-base text-red-700 hover:text-red-800 disabled:cursor-default disabled:opacity-45"
        >
          <IconX size={24} />
          Cancel upload
        </button>
        <button
          type="button"
          onClick={onNext}
          className="flex items-center gap-1.5 rounded-md bg-accent px-5 py-2.5 font-display font-medium text-white hover:bg-accent/90"
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
          <div className="px-3 pt-1 pb-1.5 text-xs text-ink-soft">p.{contextMenu.page}</div>
          {pageMenuItems(contextMenu.page).map((item) => (
            <button
              key={item.target}
              role="menuitem"
              type="button"
              onClick={() => {
                setState(setPageState(contextMenu.page, item.target, state, pageCount))
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
