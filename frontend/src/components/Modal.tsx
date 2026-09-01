import { useEffect, useRef, useState, type ReactNode } from 'react'

// "Very short" pop animation duration — kept as one constant so the
// unmount-delay timeout below can't drift out of sync with the CSS
// transition duration it's paired with.
const TRANSITION_MS = 150

// Module-level stack of currently-open modals, oldest first — lets a
// nested modal (opened while another Modal is already open, e.g. Upload
// Portrait opened from inside Edit Person, added 2026-09-02) claim Escape
// for itself instead of every open modal's own independent document
// keydown listener racing for the same event. Real bug found live: with
// no coordination, BOTH modals' listeners are genuinely registered on
// `document`, but the FIRST-opened (background) modal's listener is also
// always registered FIRST and therefore always fires first — closing the
// modal *behind* the one the user was actually looking at, backwards from
// what Escape should do, and (via a cascading re-render from that close)
// tearing down the topmost modal's own listener before the same
// synchronous event dispatch pass ever reaches it. Keyed by a stable
// per-instance id (assigned once via lazy useRef init below), not by
// `onClose` reference — an unstable inline `onClose` prop is common
// (arrow function at the call site) and must not cause spurious stack
// reordering on every unrelated re-render.
let nextModalStackId = 0
const openModalStack: { id: number; onClose: () => void }[] = []

interface ModalProps {
  open: boolean
  onClose: () => void
  labelledBy?: string
  children: ReactNode
  /** 'md' (default, max-w-lg) fits the simple modals (rename, placeholder
   * confirmations). 'lg' (max-w-2xl) is for genuinely field-dense forms —
   * added for the Piece Properties Edit Menu (§15), which has far more
   * fields than max-w-lg can lay out without feeling cramped. 'xl'
   * (max-w-3xl) is for a two-column field layout specifically — the Book
   * Properties Edit Menu (§16) needs real room for two side-by-side
   * columns at desktop width without cramming either one; collapses to a
   * single column below `sm` regardless of this prop. */
  size?: 'md' | 'lg' | 'xl'
  /** Rendered outside the scrolling body, pinned to the top of the dialog
   * — mirrors `footer` below but for content that must stay visible while
   * the rest scrolls underneath it (the Piece Properties Edit Menu's
   * title/close row plus its collapsible page preview — a preview that
   * scrolled away with the fields it's meant to be referenced against
   * would defeat the point of having it). Short modals
   * with nothing that needs pinning above the fields can leave this unset
   * and put everything in `children` as before. */
  header?: ReactNode
  /** Rendered outside the scrolling body, pinned to the bottom of the
   * dialog — for a form's Cancel/Save row that should stay visible while
   * long content scrolls above it (the Piece Properties Edit Menu is long
   * enough to need this; short modals can just leave this unset and let
   * their own trailing buttons scroll with everything else). */
  footer?: ReactNode
}

/**
 * Shared modal shell for every popup in the app (design doc §15: "popup/
 * blurred bkgd thing (desktop) or slide-up popover (mobile)") — built once
 * here so the piece edit menu, book edit menu, and anything else that
 * needs a modal all get identical Escape-to-close and backdrop-click-to-
 * close behavior for free, rather than each screen reimplementing it.
 */
export function Modal({ open, onClose, labelledBy, children, size = 'md', header, footer }: ModalProps) {
  // Stays mounted slightly past `open` going false, so the exit transition
  // (scale/opacity back down) actually has something to animate instead of
  // the dialog just vanishing — `visible` is the one driving the CSS
  // transition classes; `mounted` is only about whether to render at all.
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(false)
  // Tracks whichever of the two nested rAF handles below is currently
  // pending, so the effect's cleanup can cancel the right one regardless
  // of which of the two frames the effect gets torn down on.
  const rafRef = useRef(0)

  // Stable per-instance identity for the modal stack below — assigned
  // once, lazily, on first render (the standard "useRef as a mutable
  // instance id" pattern, since useState would need an initializer
  // function to only run once too, and this is simpler for a value that's
  // never rendered or used to trigger updates).
  const stackIdRef = useRef<number | null>(null)
  if (stackIdRef.current === null) stackIdRef.current = nextModalStackId++
  // Always points at the current onClose, even though the stack entry
  // itself (pushed once per open, see below) is a stable wrapper — avoids
  // a stale closure without making the push/pop effect depend on onClose,
  // which would otherwise reorder the stack on every unrelated re-render
  // an unstable inline onClose prop causes.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  // Synchronizes mounted/visible to the open prop inside a real effect —
  // not the "adjust state during render" pattern this used previously.
  // That earlier version set `mounted` synchronously during render
  // specifically to satisfy the react-hooks/set-state-in-effect lint rule,
  // but it had a real, confirmed bug: when a parent re-renders while this
  // effect's pending rAF/timeout is still in flight (e.g. EditPieceModal's
  // own reset() call notifying react-hook-form's subscribers right as the
  // modal opens), the render-phase update and the async callback could
  // race, leaving `mounted` stuck false even though `open` was still true
  // — the modal would silently never appear. Confirmed via direct
  // instrumentation (logging every render's state across the transition)
  // before switching back to this straightforward effect-based version,
  // which is the standard, correct way to synchronize local state to an
  // external controlled prop. Worth the lint rule's nudge here — see the
  // inline disable below — not worth reintroducing that race.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: see the comment above this effect for why the render-phase-update alternative is broken, not just a lint-appeasement choice.
      setMounted(true)
      // Starts in the "hidden" classes (mounted just went true above),
      // then flips to visible — needs a DOUBLE rAF, not one. A single rAF
      // fires before the browser has actually painted the just-mounted
      // "hidden" frame (opacity-0 scale-95): React commits `mounted=true`
      // and the rAF callback runs `setVisible(true)` within the same
      // paint cycle, so the browser coalesces both into one frame and the
      // transition has nothing to animate from — the dialog just pops in
      // at full opacity/scale instantly. Confirmed via instrumentation
      // (polling computed opacity/transform + listening for
      // transitionrun/transitionstart across the open transition): with a
      // single rAF, opacity was already "1" and transform "none" on the
      // very first sampled frame, and no transition event ever fired.
      // Nesting a second rAF forces a full paint of the hidden state
      // first, so the visible flip lands on a later frame and the CSS
      // transition actually has something to animate between.
      const raf1 = requestAnimationFrame(() => {
        const raf2 = requestAnimationFrame(() => setVisible(true))
        rafRef.current = raf2
      })
      rafRef.current = raf1
      return () => cancelAnimationFrame(rafRef.current)
    }
    setVisible(false)
    // visible already dropped (above) so the exit transition is already
    // playing — wait for it to finish before actually unmounting.
    const timeout = setTimeout(() => setMounted(false), TRANSITION_MS)
    return () => clearTimeout(timeout)
  }, [open])

  // Pushes onto the shared stack exactly once per open (deliberately not
  // keyed on `onClose` — see onCloseRef above), so this modal knows its
  // own position relative to any other Modal that opens later on top of
  // it.
  useEffect(() => {
    if (!open) return
    const id = stackIdRef.current!
    openModalStack.push({ id, onClose: () => onCloseRef.current() })
    return () => {
      const idx = openModalStack.findIndex((entry) => entry.id === id)
      if (idx !== -1) openModalStack.splice(idx, 1)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      // Only the topmost (most recently opened) modal responds — see the
      // openModalStack comment up top for why this matters the moment two
      // Modals are open at once.
      const top = openModalStack[openModalStack.length - 1]
      if (top?.id !== stackIdRef.current) return
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!mounted) return null

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center bg-ink/40 backdrop-blur-sm transition-opacity duration-150 sm:items-center ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl bg-paper-raised shadow-xl transition-[transform,opacity] duration-150 sm:rounded-2xl ${
          size === 'xl' ? 'max-w-3xl' : size === 'lg' ? 'max-w-2xl' : 'max-w-lg'
        } ${visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
      >
        {header && <div className="shrink-0 px-6 pt-6">{header}</div>}
        <div className="overflow-y-auto p-6">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-border bg-paper-raised px-6 py-4">{footer}</div>
        )}
      </div>
    </div>
  )
}
