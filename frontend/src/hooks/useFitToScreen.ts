import { useLayoutEffect, type RefObject } from 'react'

/**
 * Sizes a sticky column to the room it has on screen: from its own top edge
 * to `bottomGap` px above the bottom of the app's scroll area, kept current
 * as the page scrolls and the window resizes. A fixed `100dvh − x` height
 * can't fit both moments — while the page is at its top the column starts
 * lower (under the page's title row) and ran off the bottom; once that row
 * scrolls away it has more room. Only while `query` matches (the wide
 * layout); otherwise the height is left to the stylesheet. The Practice
 * Dashboard's week-and-list column and its mockup's.
 */
export function useFitToScreen(
  ref: RefObject<HTMLElement | null>,
  { query = '(min-width: 64rem)', bottomGap = 24 }: { query?: string; bottomGap?: number } = {},
) {
  // A layout effect, so the first fit lands before the page is painted.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const media = window.matchMedia(query)
    const scroller = document.getElementById('app-scroll-container')
    let frame = 0

    const fit = () => {
      frame = 0
      if (!media.matches) {
        el.style.height = ''
        return
      }
      const bottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight
      const top = el.getBoundingClientRect().top
      el.style.height = `${Math.max(0, bottom - bottomGap - top)}px`
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(fit)
    }

    fit()
    const target = scroller ?? window
    target.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    media.addEventListener('change', schedule)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      target.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      media.removeEventListener('change', schedule)
      el.style.height = ''
    }
  }, [ref, query, bottomGap])
}
