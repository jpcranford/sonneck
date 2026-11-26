import { useEffect, type RefObject } from 'react'

/** While `locked`, nothing under a drawer can scroll or bounce: neither the
 * app's page (`#app-scroll-container`, AppShell) nor the document itself
 * (`<html>`, `<body>`), and a swipe that starts on `touchArea` does nothing.
 *
 * For a drawer fixed to the screen at a `sticky` bar inside the page (the
 * Practice Dashboard's Practice List). A swipe on the bar scrolled the page,
 * and a swipe on the dimmed page or past the end of the drawer's list was
 * handed on to the document, which iOS scrolled or bounced: either way the
 * bar (and the whole page, top bar included) moved while the drawer stayed,
 * leaving it hanging apart from the bar. `overscroll-behavior: none` and
 * `overflow: hidden` on <html> and <body> are what keep the Sheet Viewer
 * still (`useNoPageScroll`). Pointer events still arrive, so taps and drags
 * handled in code work. Everything is put back when it unlocks. */
export function useLockAppScroll(locked: boolean, touchArea?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!locked) return
    const scroller = document.getElementById('app-scroll-container')
    const targets = [document.documentElement, document.body, scroller].filter(
      (el): el is HTMLElement => el !== null,
    )
    const saved = targets.map((el) => [el.style.overflow, el.style.overscrollBehavior] as const)
    for (const el of targets) {
      el.style.overflow = 'hidden'
      el.style.overscrollBehavior = 'none'
    }
    const area = touchArea?.current
    const block = (e: TouchEvent) => e.preventDefault()
    area?.addEventListener('touchmove', block, { passive: false })
    return () => {
      targets.forEach((el, i) => {
        el.style.overflow = saved[i][0]
        el.style.overscrollBehavior = saved[i][1]
      })
      area?.removeEventListener('touchmove', block)
    }
  }, [locked, touchArea])
}
