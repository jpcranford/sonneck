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

  useLayoutEffect(() => {
    const margin = 8

    function clamp() {
      const el = bubbleRef.current
      if (!el) return
      // Measure against the bubble's own un-shifted centered position each
      // time, not the previous (already-shifted) rect — otherwise repeated
      // measurements would compound the correction.
      el.style.transform = 'translateX(-50%)'
      const rect = el.getBoundingClientRect()
      const boundary = getClipBoundary(el)
      let shift = 0
      if (rect.right > boundary.right - margin) {
        shift = boundary.right - margin - rect.right
      } else if (rect.left < boundary.left + margin) {
        shift = boundary.left + margin - rect.left
      }
      setShiftPx(shift)
    }

    clamp()
    window.addEventListener('resize', clamp)
    return () => window.removeEventListener('resize', clamp)
  }, [message])

  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
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
