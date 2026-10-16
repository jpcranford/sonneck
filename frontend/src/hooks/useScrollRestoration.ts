import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

// The app scrolls inside #app-scroll-container, not the window, so the
// browser's own handling (top of a new page, back to where you were on
// Back/Forward) never applies — the container just kept whatever position
// the previous page had. A page whose data was already cached rendered at
// full height straight away and opened partway down (Piece Details on a
// phone, from a scrolled library: the title off-screen, the sheet music
// showing); one that loaded first only reached the top by accident, its
// short "Loading…" clamping the position to 0.
//
// So: a new page (a link, a button that navigates) starts at the top;
// Back/Forward returns to the position that page was left at. Positions
// are remembered per history entry (location.key) as the container
// scrolls. A page coming back before its content has rendered tall enough
// is re-tried for up to a second, and given up the moment the user
// scrolls or touches.
const RESTORE_FOR_MS = 1000

export function useScrollRestoration(containerRef: RefObject<HTMLElement | null>) {
  const location = useLocation()
  const navigationType = useNavigationType()
  const positions = useRef(new Map<string, number>())
  const currentKey = useRef(location.key)

  // Remember each page's position as it scrolls — read at leave time it
  // would already be the next page's (the DOM changes before any effect).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const save = () => positions.current.set(currentKey.current, el.scrollTop)
    el.addEventListener('scroll', save, { passive: true })
    return () => el.removeEventListener('scroll', save)
  }, [containerRef])

  useLayoutEffect(() => {
    currentKey.current = location.key
    const el = containerRef.current
    if (!el) return
    const target = navigationType === 'POP' ? (positions.current.get(location.key) ?? 0) : 0
    el.scrollTop = target
    if (target === 0 || el.scrollTop === target) return

    // Not tall enough yet — keep trying as the page fills in.
    let frame = 0
    const until = performance.now() + RESTORE_FOR_MS
    const stop = () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('wheel', stop)
      el.removeEventListener('touchstart', stop)
    }
    const retry = () => {
      el.scrollTop = target
      if (el.scrollTop === target || performance.now() > until) stop()
      else frame = requestAnimationFrame(retry)
    }
    el.addEventListener('wheel', stop, { passive: true })
    el.addEventListener('touchstart', stop, { passive: true })
    frame = requestAnimationFrame(retry)
    return stop
  }, [location.key, navigationType, containerRef])
}
