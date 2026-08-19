import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

interface InfoTooltipProps {
  message: string
  ariaLabel: string
  triggerClassName: string
  children: ReactNode
}

/**
 * Hover-or-tap info bubble: hover reveals it on desktop, click/tap toggles
 * it open on touch (design doc §12's "no hover-dependent interactions").
 * Each instance owns its own open state, so several can appear on one page
 * independently. Originally built inline for the Piece View's "inherited"
 * badges and public domain badge — pulled out here once a third/fourth use
 * (the Piece View's opus-number info icon, the Edit Piece modal's own copy
 * of it) made the duplication worth naming.
 *
 * Horizontally clamps to its nearest clipping ancestor (added 2026-08-17,
 * widened 2026-08-18): the bubble is centered on its trigger by default,
 * but a trigger sitting near a container's edge (e.g. the public-domain
 * badge, the rightmost element in its row) would center a bubble that
 * extends past the visible area. Originally clamped against the browser
 * viewport only — correct for a page-level trigger, but wrong for one
 * inside Modal.tsx's dialog: that dialog is `overflow-hidden` (for its
 * rounded corners) and narrower than the viewport, so a bubble could stay
 * within the viewport's bounds yet still get silently clipped by the
 * dialog around it (found via the Edit Piece modal's Publisher ID field,
 * the first trigger placed in that modal's narrow rightmost column).
 * `getClipBoundary` below walks up from the trigger to the nearest
 * ancestor that actually clips overflow — auto/hidden/scroll/clip on
 * either axis, which also catches an ancestor whose overflow-x silently
 * computed to auto because only overflow-y was set (CSS spec behavior,
 * already documented elsewhere in this codebase — see AppShell.tsx) — and
 * clamps against that element's rect instead of the viewport when one
 * exists. Measured via a real getBoundingClientRect() check in
 * useLayoutEffect — which fires before paint, so the correction is already
 * applied on the very first visible frame, no flash of a misplaced bubble
 * — rather than hiding the overflow at the container level (that approach
 * was tried first and reverted: it stopped the phantom scrollable space
 * but then silently clipped this exact tooltip's text whenever it was
 * actually opened near an edge, trading one bug for a worse one).
 */
function getClipBoundary(el: HTMLElement): { left: number; right: number } {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
      const rect = node.getBoundingClientRect()
      return { left: rect.left, right: rect.right }
    }
  }
  return { left: 0, right: document.documentElement.clientWidth }
}

export function InfoTooltip({ message, ariaLabel, triggerClassName, children }: InfoTooltipProps) {
  const [open, setOpen] = useState(false)
  const bubbleRef = useRef<HTMLSpanElement>(null)
  const [shiftPx, setShiftPx] = useState(0)
  // Mirrors shiftPx, written synchronously inside clamp() itself (not via
  // a separate useEffect keyed on shiftPx) — see clamp()'s own comment for
  // why this needs to be a ref at all, not just closure-captured state.
  const shiftPxRef = useRef(0)

  // Stable across renders (not redefined inside the effect below) so both
  // the mount effect and the hover/open handlers further down can call the
  // exact same measurement logic.
  //
  // Two real bugs already found and fixed here, both worth keeping in mind
  // before touching this function again:
  //
  // 1. An earlier version measured the bubble's "unshifted" baseline by
  //    imperatively mutating the DOM first (`el.style.transform =
  //    'translateX(-50%)'`), then reading getBoundingClientRect(), then
  //    calling setShiftPx(shift). That broke on a *second* hover (mouse
  //    off, then back on): the freshly computed shift is often identical
  //    to the current shiftPx state (same trigger, same boundary — nothing
  //    moved), and React bails out of re-rendering when a state setter is
  //    called with a value equal to the current one (Object.is check). The
  //    DOM was left holding whatever the imperative reset-to-unshifted
  //    line wrote at the *top* of this function, never overwritten by
  //    React's own controlled style, since React never re-ran — the
  //    bubble rendered off-center/overflowing on every second-and-later
  //    hover. Fixed by never mutating the DOM here: instead, mathematically
  //    subtract the *currently applied* shift back out of the measured
  //    rect to recover the same unshifted baseline.
  //
  // 2. That "currently applied shift" can't be read from the `shiftPx`
  //    state variable via closure, either — the mount effect below
  //    registers a `resize` listener exactly once (its dependency array is
  //    just `[message]`, which never changes after mount), so that
  //    listener permanently holds the `clamp` closure — and thus the
  //    `shiftPx` value — from the very first render. Any resize handled
  //    after the bubble had already been shifted once would undo the wrong
  //    (stale, usually 0) amount. Fixed with `shiftPxRef`, updated
  //    synchronously in the same place `setShiftPx` is called — always
  //    current regardless of which closure happens to be calling `clamp`.
  function clamp() {
    const margin = 8
    const el = bubbleRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const unshiftedRight = rect.right - shiftPxRef.current
    const unshiftedLeft = rect.left - shiftPxRef.current
    const boundary = getClipBoundary(el)
    let shift = 0
    if (unshiftedRight > boundary.right - margin) {
      shift = boundary.right - margin - unshiftedRight
    } else if (unshiftedLeft < boundary.left + margin) {
      shift = boundary.left + margin - unshiftedLeft
    }
    shiftPxRef.current = shift
    setShiftPx(shift)
  }

  useLayoutEffect(() => {
    // This mount-time measurement is necessarily approximate when the
    // tooltip mounts inside Modal.tsx: Modal sets `mounted` (which is what
    // renders this component's subtree at all) synchronously, before its
    // own scale-95→scale-100 entrance transition has played out — so this
    // first clamp() can run while the dialog is still visually scaled
    // down, computing a boundary/shift in a coordinate space that's ~5%
    // off from the settled, fully-open dialog. Harmless on its own (the
    // `open`/`onMouseEnter` recomputes below run again once the tooltip
    // is actually about to be shown, which is always after a real user has
    // had time to notice and move toward it, i.e. well past the 150ms
    // transition) — this effect just gets the shift roughly right before
    // that point, and handles plain window resizes after mount.
    clamp()
    window.addEventListener('resize', clamp)
    return () => window.removeEventListener('resize', clamp)
  }, [message])

  return (
    <span className="group relative inline-flex" onMouseEnter={clamp}>
      <button
        type="button"
        onClick={() => {
          // Recompute right before opening — the mount-time measurement
          // above can be stale (see its comment), and by the time a user
          // actually clicks, any entrance animation on an ancestor modal
          // has long since settled, so this reflects real, final geometry.
          if (!open) clamp()
          setOpen((o) => !o)
        }}
        aria-expanded={open}
        aria-label={ariaLabel}
        className={triggerClassName}
      >
        {children}
      </button>
      <span
        ref={bubbleRef}
        role="tooltip"
        style={{ transform: `translateX(calc(-50% + ${shiftPx}px))` }}
        className={`pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-max max-w-[220px] rounded-md bg-ink px-2 py-1 text-center text-xs text-paper shadow-md transition-opacity ${
          open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        {message}
      </span>
    </span>
  )
}
