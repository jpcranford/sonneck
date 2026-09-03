import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

// Coordinates click/tap-opened tooltips across the whole page: several
// InfoTooltip instances can exist at once (Piece Details alone has 7+
// "inherited" pills plus the opus/publisher-id info icons), each with its
// own independent `open` state — with no coordination, tapping a second
// trigger on mobile (where hover doesn't exist, so tap is the only way to
// reveal one) left the first tooltip visibly stuck open alongside it.
// Plain document-level custom event, not React context — a context
// provider would need wrapping every page that renders any InfoTooltip,
// while this event is opt-in per-instance (mirrors Modal.tsx's own
// module-level openModalStack for the identical class of "many independent
// instances of the same component need one piece of cross-instance
// coordination" problem, just pub/sub instead of a stack since there's no
// ordering to track here).
const TOOLTIP_OPENED_EVENT = 'sonneck:tooltip-opened'

interface InfoTooltipProps {
  message: string
  ariaLabel: string
  triggerClassName: string
  children: ReactNode
  // Defaults to true (every existing caller relies on this, unchanged) —
  // set false for a trigger that's genuinely read-only-feeling and
  // shouldn't invite a click, like the public domain badge (Public Domain
  // Badge feature): it's still tap-to-open on touch (design doc §12 — no
  // hover-dependent interactions), only the desktop mouse cursor differs.
  showPointerCursor?: boolean
}

/**
 * Hover-or-tap info bubble: hover reveals it on desktop, click/tap toggles
 * it open on touch (design doc §12's "no hover-dependent interactions").
 * Each instance owns its own open state, so several can appear on one page
 * independently. Originally built inline for the Piece Details page's
 * "inherited" badges and public domain badge — pulled out here once a
 * third/fourth use (the Piece Details page's opus-number info icon, the
 * Edit Piece modal's own copy
 * of it) made the duplication worth naming.
 *
 * Horizontally clamps to its nearest clipping ancestor: the bubble is
 * centered on its trigger by default, but a trigger sitting near a
 * container's edge (e.g. the public-domain badge, the rightmost element
 * in its row) would center a bubble that extends past the visible area.
 * Clamping against just the browser viewport is correct for a page-level
 * trigger, but wrong for one
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
 *
 * Vertically flips instead of clamping — found live (2026-08-30) via the
 * People Library filter drawer's "Show all composers" row, the first row
 * of a scrollable drawer body: the bubble's default open-upward placement
 * (`bottom-full`) had nowhere to go above the trigger within that
 * scrollable ancestor, so its top portion rendered clipped clean off. A
 * horizontal-style clamp (nudge it back within bounds) doesn't fit this
 * axis the way it does left/right — squeezing a short, wide bubble
 * vertically would just make it taller/narrower against its own
 * `max-w`. Flipping which side it opens on (`top-full` instead) is the
 * right fix, same as how a dropdown menu flips above its trigger when
 * there's no room below.
 */
function getClipBoundary(el: HTMLElement): { left: number; right: number; top: number; bottom: number } {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
      const rect = node.getBoundingClientRect()
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
    }
  }
  return {
    left: 0,
    right: document.documentElement.clientWidth,
    top: 0,
    bottom: document.documentElement.clientHeight,
  }
}

export function InfoTooltip({
  message,
  ariaLabel,
  triggerClassName,
  children,
  showPointerCursor = true,
}: InfoTooltipProps) {
  const [open, setOpen] = useState(false)
  const bubbleRef = useRef<HTMLSpanElement>(null)
  const [shiftPx, setShiftPx] = useState(0)
  // Mirrors shiftPx, written synchronously inside clamp() itself (not via
  // a separate useEffect keyed on shiftPx) — see clamp()'s own comment for
  // why this needs to be a ref at all, not just closure-captured state.
  const shiftPxRef = useRef(0)
  // Same ref-mirrors-state reasoning as shiftPx/shiftPxRef above (the
  // mount effect's `clamp` closure is stale after the first render, so a
  // later call reading React state directly would see a stale value —
  // reading/writing the ref instead is always current). One-way only:
  // once flipped below, clamp() never flips it back — a trigger that
  // needs this at all is reliably pinned near one edge, not oscillating
  // near the middle, so there's no real case to handle where flipping
  // back would matter, and a one-way flip can't itself cause flicker.
  const [placeBelow, setPlaceBelow] = useState(false)
  const placeBelowRef = useRef(false)

  // Stable per-instance identity for the open-coordination event below —
  // a plain object reference (not a counter/id prop) is enough since it
  // only ever needs to be compared for "is this the instance that just
  // opened," never serialized or looked up.
  const instanceRef = useRef({})

  // Close this tooltip whenever a *different* instance announces it just
  // opened. Doesn't fire for this instance's own open (the dispatch below
  // carries this same instanceRef, filtered out here) — only ever reacts
  // to another trigger's click.
  useEffect(() => {
    function handleOtherOpened(event: Event) {
      if ((event as CustomEvent<object>).detail !== instanceRef.current) {
        setOpen(false)
      }
    }
    document.addEventListener(TOOLTIP_OPENED_EVENT, handleOtherOpened)
    return () => document.removeEventListener(TOOLTIP_OPENED_EVENT, handleOtherOpened)
  }, [])

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
    const boundary = getClipBoundary(el)

    // Vertical: rect reflects wherever the bubble is *currently* placed
    // (bottom-full by default) — if its top would land above the nearest
    // clipping ancestor's own top edge, flip to opening downward instead.
    // Checked before the horizontal math below, but order doesn't matter
    // between the two — they clamp independent axes.
    if (!placeBelowRef.current && rect.top < boundary.top + margin) {
      placeBelowRef.current = true
      setPlaceBelow(true)
    }

    const unshiftedRight = rect.right - shiftPxRef.current
    const unshiftedLeft = rect.left - shiftPxRef.current
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
          if (!open) {
            clamp()
            // Announce before flipping local state — every other open
            // instance's own listener (registered above) reacts to this
            // and closes itself, so only one tooltip is ever open at a
            // time page-wide.
            document.dispatchEvent(new CustomEvent(TOOLTIP_OPENED_EVENT, { detail: instanceRef.current }))
          }
          setOpen((o) => !o)
        }}
        aria-expanded={open}
        aria-label={ariaLabel}
        // cursor-pointer baked in here (not left to each caller's own
        // triggerClassName) by default — a plain <button> resets to
        // cursor: default (Tailwind's preflight, CLAUDE.md > Frontend),
        // and this component exists specifically so callers don't have to
        // each remember the rest of this trigger's styling either,
        // cursor included. showPointerCursor={false} opts a specific
        // trigger back out — written as a ternary between two literal
        // class strings (`cursor-pointer`/`cursor-default`), not a
        // template-interpolated `cursor-${x}`, so both possible classes
        // appear verbatim in this file's source for Tailwind's build-time
        // scanner to find; a runtime-only interpolated class name isn't
        // guaranteed to exist in the generated stylesheet at all.
        className={`${showPointerCursor ? 'cursor-pointer' : 'cursor-default'} ${triggerClassName}`}
      >
        {children}
      </button>
      <span
        ref={bubbleRef}
        role="tooltip"
        style={{ transform: `translateX(calc(-50% + ${shiftPx}px))` }}
        className={`pointer-events-none absolute left-1/2 z-10 w-max max-w-[220px] rounded-md bg-ink px-2 py-1 text-center text-xs text-paper shadow-md transition-opacity ${
          placeBelow ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
        } ${open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
      >
        {message}
      </span>
    </span>
  )
}
