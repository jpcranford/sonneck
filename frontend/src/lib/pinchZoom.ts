// Pinch-zoom in the Sheet Viewer is the browser's own (the visual viewport
// scales up over the page), so everything on the page grows and pans away
// with it. A page can't undo it (iPad Safari ignores every viewport-tag
// trick; Cmd+0 works, but a page can't press it), so instead the zoomed
// Annotate bar is held steady on screen. Shared by the viewer and its
// mockup.

/** Zoomed in, the same threshold the viewer uses for its zoomed behavior. */
const ZOOMED = 1.05
/** How long after the last touch or viewport event to keep following. */
const FOLLOW_MS = 800

/**
 * Keeps an element steady on screen while pinch-zoomed, and hidden when
 * not: it's moved to where the visible area is and scaled back down by the
 * zoom, so it looks and sits exactly as at 100%. The element must be a
 * fixed full-screen layer (`fixed inset-0`), which this turns into exactly
 * the visible area; whatever it holds is placed in it as on an unzoomed
 * screen. A callback ref: returns its own cleanup.
 *
 * iPad Safari stops reporting the zoom and pan (the viewport's resize and
 * scroll events) before a pinch and its glide have finished, so placing it
 * only on those events left it where the gesture was a moment before. It's
 * re-placed every frame for as long as the page is zoomed in (and while a
 * finger is down, and briefly after any event, to catch a zoom starting),
 * which costs a few reads a frame and stops at 100%.
 */
export function holdWhileZoomed(el: HTMLElement | null): (() => void) | undefined {
  const vv = window.visualViewport
  if (!el || !vv) return
  let last = ''
  const place = () => {
    const zoomed = vv.scale > ZOOMED
    const next = zoomed
      ? `translate(${vv.offsetLeft}px, ${vv.offsetTop}px) scale(${1 / vv.scale})`
      : 'hidden'
    if (next === last) return
    last = next
    el.style.visibility = zoomed ? 'visible' : 'hidden'
    el.style.transformOrigin = '0 0'
    el.style.transform = zoomed ? next : ''
  }
  let frame = 0
  let until = 0
  let touching = false
  const loop = () => {
    place()
    const keepGoing = touching || vv.scale > ZOOMED || performance.now() < until
    frame = keepGoing ? requestAnimationFrame(loop) : 0
  }
  const follow = () => {
    until = performance.now() + FOLLOW_MS
    if (!frame) frame = requestAnimationFrame(loop)
  }
  const onTouch = (event: TouchEvent) => {
    touching = event.touches.length > 0
    follow()
  }
  follow()
  vv.addEventListener('resize', follow)
  vv.addEventListener('scroll', follow)
  window.addEventListener('touchstart', onTouch, { passive: true })
  window.addEventListener('touchend', onTouch, { passive: true })
  window.addEventListener('touchcancel', onTouch, { passive: true })
  return () => {
    cancelAnimationFrame(frame)
    vv.removeEventListener('resize', follow)
    vv.removeEventListener('scroll', follow)
    window.removeEventListener('touchstart', onTouch)
    window.removeEventListener('touchend', onTouch)
    window.removeEventListener('touchcancel', onTouch)
  }
}
