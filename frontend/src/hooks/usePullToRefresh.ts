import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { afterMinDuration } from '../lib/minDuration'

// Post-resistance px the gesture must reach before release triggers a
// refresh — resistance (below) means the finger travels roughly 2x this
// before the indicator itself reaches it.
const REFRESH_THRESHOLD = 64
// Damps raw finger travel into a shorter, squishier indicator pull —
// standard pull-to-refresh feel (iOS/Android both use a similar ratio).
const PULL_RESISTANCE = 0.5
// Visual cap so the indicator can't be dragged arbitrarily far down.
const MAX_PULL = 96

export type PullToRefreshPhase = 'idle' | 'pulling' | 'ready' | 'refreshing'

interface UsePullToRefreshOptions {
  containerRef: RefObject<HTMLElement | null>
  onRefresh: () => Promise<unknown>
  enabled: boolean
}

// Walks from the touch target up to (but not including) the scroll
// container, bailing out of the gesture if it crosses either: a
// `position: fixed` ancestor (this app's own established shape for every
// full-screen overlay — Modal.tsx/PageLightbox.tsx/MobileNav.tsx's drawer
// all use `fixed inset-0`, none of them lock the container's own
// scrollTop, so without this check a downward drag inside any of them
// would incorrectly read as "the container is at the top, start
// pulling"), or a genuinely independently-scrollable region (a Modal's own
// `overflow-y-auto` body, a dropdown/context-menu list) — either way, the
// drag belongs to whatever's on top, not to the page underneath it.
function isInsideOverlayOrScrollable(target: EventTarget | null, container: HTMLElement): boolean {
  let el = target instanceof Element ? target : null
  while (el && el !== container) {
    if (el instanceof HTMLElement) {
      const style = getComputedStyle(el)
      if (style.position === 'fixed') return true
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
        return true
      }
    }
    el = el.parentElement
  }
  return false
}

/**
 * App-wide pull-to-refresh gesture, attached directly to a scroll
 * container (real DOM listeners via a ref + effect, not React's synthetic
 * touch handlers — `{ passive: false }` on touchmove is what lets
 * `preventDefault()` actually suppress the container's native scroll/
 * bounce while our own gesture owns the motion, and React's synthetic
 * touch handlers can't reliably guarantee that).
 *
 * `phase`/`pullDistance` are plain render-triggering state for the
 * indicator; gesture branching inside the event handlers reads a parallel
 * ref (`phaseRef`) instead, so the effect's own listeners never need to be
 * torn down and re-added mid-gesture just because `phase` changed.
 */
export function usePullToRefresh({ containerRef, onRefresh, enabled }: UsePullToRefreshOptions) {
  const [pullDistance, setPullDistance] = useState(0)
  const [phase, setPhase] = useState<PullToRefreshPhase>('idle')
  const phaseRef = useRef<PullToRefreshPhase>('idle')
  const startY = useRef<number | null>(null)

  const setPhaseBoth = useCallback((next: PullToRefreshPhase) => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  useEffect(() => {
    const maybeContainer = containerRef.current
    if (!maybeContainer || !enabled) return
    // Explicitly typed as non-null — TS's flow narrowing above doesn't
    // propagate into the nested closures below, which reference this
    // across an addEventListener callback boundary.
    const container: HTMLElement = maybeContainer

    function handleTouchStart(event: TouchEvent) {
      if (phaseRef.current === 'refreshing') return
      if (event.touches.length !== 1) return
      if (container.scrollTop > 0) return
      if (isInsideOverlayOrScrollable(event.target, container)) return
      startY.current = event.touches[0].clientY
    }

    function handleTouchMove(event: TouchEvent) {
      if (startY.current === null || phaseRef.current === 'refreshing') return
      const rawDelta = event.touches[0].clientY - startY.current
      if (rawDelta <= 0) {
        // Scrolling back up past the start point, or not actually a
        // downward pull — release the gesture, let the browser scroll
        // normally.
        startY.current = null
        setPullDistance(0)
        setPhaseBoth('idle')
        return
      }
      // We own this motion now — suppress the container's native
      // scroll/rubber-band so it doesn't fight our own transform.
      event.preventDefault()
      const pulled = Math.min(rawDelta * PULL_RESISTANCE, MAX_PULL)
      setPullDistance(pulled)
      setPhaseBoth(pulled >= REFRESH_THRESHOLD ? 'ready' : 'pulling')
    }

    function handleTouchEnd() {
      if (startY.current === null) return
      startY.current = null
      if (phaseRef.current === 'ready') {
        setPhaseBoth('refreshing')
        setPullDistance(REFRESH_THRESHOLD)
        const startedAt = Date.now()
        onRefresh().finally(() => {
          afterMinDuration(startedAt, () => {
            setPhaseBoth('idle')
            setPullDistance(0)
          })
        })
      } else if (phaseRef.current !== 'refreshing') {
        setPhaseBoth('idle')
        setPullDistance(0)
      }
    }

    container.addEventListener('touchstart', handleTouchStart, { passive: true })
    container.addEventListener('touchmove', handleTouchMove, { passive: false })
    container.addEventListener('touchend', handleTouchEnd)
    container.addEventListener('touchcancel', handleTouchEnd)
    return () => {
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('touchend', handleTouchEnd)
      container.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [containerRef, enabled, onRefresh, setPhaseBoth])

  return { pullDistance, phase, threshold: REFRESH_THRESHOLD }
}
