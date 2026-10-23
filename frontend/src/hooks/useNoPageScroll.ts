import { useEffect } from 'react'

/**
 * For a full-screen view that must never move (the Sheet Viewer): while it's
 * mounted, the document can't scroll, bounce or pull to refresh. Browsers
 * (iPad Safari, Chrome on Android) offer their own pull-to-refresh and
 * rubber-band bounce on the page itself even when every element is fixed;
 * `overscroll-behavior: none` on <html> and <body> turns both off, and
 * `overflow: hidden` leaves nothing to scroll. Restored on unmount.
 */
export function useNoPageScroll() {
  useEffect(() => {
    const targets = [document.documentElement, document.body]
    const saved = targets.map((el) => [el.style.overscrollBehavior, el.style.overflow])
    for (const el of targets) {
      el.style.overscrollBehavior = 'none'
      el.style.overflow = 'hidden'
    }
    return () => {
      targets.forEach((el, i) => {
        el.style.overscrollBehavior = saved[i][0]
        el.style.overflow = saved[i][1]
      })
    }
  }, [])
}
