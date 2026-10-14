import { useId, useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

export interface AnchorRect {
  top: number
  bottom: number
  left: number
  right: number
  width: number
}

// WebKit (every iPhone/iPad browser: Safari, Orion, Chrome for iOS, and
// desktop Safari) draws a position: fixed element relative to the visual
// viewport, but getBoundingClientRect measures against the layout viewport,
// leaving out visualViewport.offsetTop/offsetLeft (WebKit bug 257375). Once
// the on-screen keyboard (or a pinch-zoom) pans the visual viewport, a
// panel placed straight from the rect drifts off its anchor by that offset,
// so it's added back there. Blink (Chrome on Android) measures and draws in
// the same space and must not get it; outside a pan the offset is 0 anyway.
const isWebKit =
  typeof navigator !== 'undefined' &&
  /AppleWebKit/.test(navigator.userAgent) &&
  !/Chrome\/|Chromium|Android/.test(navigator.userAgent)

// How long the anchor must sit still before the frame loop stops.
const SETTLE_MS = 500

function sameRect(a: AnchorRect | null, b: AnchorRect): boolean {
  return (
    a !== null &&
    a.top === b.top &&
    a.bottom === b.bottom &&
    a.left === b.left &&
    a.right === b.right &&
    a.width === b.width
  )
}

/**
 * The live on-screen rect of `ref`'s element while `active`, for a floating
 * panel portaled to <body> (a dropdown that must escape a Modal's
 * overflow-hidden) to stay attached to its anchor. Re-measured every
 * animation frame, updating only when it actually moved — scroll and
 * resize events alone missed an anchor that grows in place (TagComboBox's
 * pills wrapping onto a new line as names are picked, which left the list
 * covering the field on phones) and the on-screen keyboard shifting the
 * page, neither of which fires them. The frame loop stops once the anchor
 * has sat still for SETTLE_MS — an open menu otherwise kept the processor
 * busy indefinitely, a real battery cost on slow devices (e-ink tablets
 * among them, which tend to lack anchor positioning) — and restarts on
 * anything that could move it: scroll, resize, the visual viewport
 * panning, the anchor resizing, or a touch, click or key press. On WebKit
 * the rect is corrected for the visual viewport's pan (see isWebKit). Null
 * while inactive.
 */
export function useAnchorRect(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
): AnchorRect | null {
  const [rect, setRect] = useState<AnchorRect | null>(null)
  useLayoutEffect(() => {
    if (!active) return
    let last: AnchorRect | null = null
    let frame = 0
    function check() {
      const el = ref.current
      if (el) {
        const r = el.getBoundingClientRect()
        const vv = isWebKit ? window.visualViewport : null
        const dy = vv?.offsetTop ?? 0
        const dx = vv?.offsetLeft ?? 0
        const next = {
          top: r.top + dy,
          bottom: r.bottom + dy,
          left: r.left + dx,
          right: r.right + dx,
          width: r.width,
        }
        if (!sameRect(last, next)) {
          last = next
          setRect(next)
        }
      }
    }
    let stillSince = 0
    function measure(now: number) {
      const before = last
      check()
      if (last !== before) stillSince = now
      frame = now - stillSince < SETTLE_MS ? requestAnimationFrame(measure) : 0
    }
    function wake() {
      check()
      stillSince = performance.now()
      if (!frame) frame = requestAnimationFrame(measure)
    }
    wake()
    // Scroll events fire before the frame paints, so most browsers move
    // the panel in that same frame instead of one later.
    const wakeEvents = ['scroll', 'resize', 'pointerdown', 'keydown', 'input'] as const
    wakeEvents.forEach((type) => window.addEventListener(type, wake, true))
    const vv = window.visualViewport
    vv?.addEventListener('resize', wake)
    vv?.addEventListener('scroll', wake)
    const resizeObserver = new ResizeObserver(wake)
    if (ref.current) resizeObserver.observe(ref.current)
    return () => {
      cancelAnimationFrame(frame)
      wakeEvents.forEach((type) => window.removeEventListener(type, wake, true))
      vv?.removeEventListener('resize', wake)
      vv?.removeEventListener('scroll', wake)
      resizeObserver.disconnect()
    }
  }, [ref, active])
  return active ? rect : null
}

// CSS anchor positioning (Safari 26 / every iOS 26 browser, Chrome and Edge
// 125, Firefox 147): the browser itself keeps the panel on its anchor on
// every frame, scroll included — no lag behind a momentum scroll, which the
// per-frame measuring above can't avoid (iOS slows scripts while it
// scrolls), and no visual-viewport correction to get wrong.
const supportsAnchorPositioning =
  typeof CSS !== 'undefined' && CSS.supports?.('anchor-name: --a') === true

/** Where the panel sits against its anchor: under it at the same width,
 * under it and centered on it, under it with right edges aligned, or above
 * it with left edges aligned. */
export type AnchorPlacement = 'below' | 'below-center' | 'below-right' | 'above'

/** Space kept between an edge-aware panel and the screen's sides, in px. */
const EDGE_MARGIN = 8

/**
 * Style for a floating panel portaled to <body> that must stay attached to
 * `ref`'s element while `active`: native CSS anchor positioning where
 * supported (the hook names the anchor element itself), else coordinates
 * from useAnchorRect. Null until the fallback has measured, or while
 * inactive. `gap` is the space between anchor and panel, in px.
 *
 * Give `panelWidth` (a fixed-width panel) to make it edge-aware: it keeps
 * its placement's alignment when that fits, and otherwise slides back
 * inside the screen, EDGE_MARGIN from either side — narrowing to fit only
 * when the screen itself is narrower than the panel. (A 'below' panel
 * takes the anchor's own width and never needs it.)
 */
export function useAnchoredPanel(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  placement: AnchorPlacement,
  { gap = 4, panelWidth }: { gap?: number; panelWidth?: number } = {},
): CSSProperties | null {
  const id = useId()
  const name = `--anchor-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`
  useLayoutEffect(() => {
    const el = ref.current
    if (!active || !supportsAnchorPositioning || !el) return
    el.style.setProperty('anchor-name', name)
    return () => {
      el.style.removeProperty('anchor-name')
    }
  }, [ref, active, name])

  const rect = useAnchorRect(ref, active && !supportsAnchorPositioning)
  if (!active) return null

  const m = EDGE_MARGIN
  if (supportsAnchorPositioning) {
    const base = { position: 'fixed', positionAnchor: name } as CSSProperties
    if (placement === 'below') {
      return {
        ...base,
        top: `calc(anchor(bottom) + ${gap}px)`,
        left: 'anchor(left)',
        width: 'anchor-size(width)',
      }
    }
    // The horizontal inset, clamped so the panel's far edge stays on screen.
    const width = panelWidth ? `min(${panelWidth}px, 100vw - ${2 * m}px)` : undefined
    const clamp = (edge: string) =>
      width ? `clamp(${m}px, ${edge}, calc(100vw - ${width} - ${m}px))` : edge
    if (placement === 'below-center') {
      const w = width ?? `${panelWidth ?? 0}px`
      return {
        ...base,
        top: `calc(anchor(bottom) + ${gap}px)`,
        left: clamp(`calc(anchor(center) - ${w} / 2)`),
        width,
      }
    }
    if (placement === 'below-right') {
      return {
        ...base,
        top: `calc(anchor(bottom) + ${gap}px)`,
        right: clamp('anchor(right)'),
        width,
      }
    }
    return { ...base, bottom: `calc(anchor(top) + ${gap}px)`, left: clamp('anchor(left)'), width }
  }

  if (!rect) return null
  if (placement === 'below') {
    return { position: 'fixed', top: rect.bottom + gap, left: rect.left, width: rect.width }
  }
  const vw = window.innerWidth
  const width = panelWidth ? Math.min(panelWidth, vw - 2 * m) : undefined
  const clamp = (inset: number) =>
    width === undefined ? inset : Math.min(Math.max(inset, m), vw - width - m)
  if (placement === 'below-center') {
    const w = width ?? 0
    return {
      position: 'fixed',
      top: rect.bottom + gap,
      left: clamp(rect.left + rect.width / 2 - w / 2),
      width,
    }
  }
  if (placement === 'below-right') {
    return { position: 'fixed', top: rect.bottom + gap, right: clamp(vw - rect.right), width }
  }
  return {
    position: 'fixed',
    bottom: window.innerHeight - rect.top + gap,
    left: clamp(rect.left),
    width,
  }
}
