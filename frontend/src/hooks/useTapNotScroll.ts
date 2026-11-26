import { useRef, type MouseEvent, type PointerEvent } from 'react'

/** How far a press may wander, in CSS px, and still count as a tap. */
const TAP_SLOP = 6

/** Handlers for a card that opens on a tap but sits in something that
 * scrolls: its click is cancelled (`preventDefault`, which a router Link
 * honors) when the press wasn't a tap — the pointer moved more than
 * TAP_SLOP, the browser took the touch over for a scroll (`pointercancel`),
 * or anything on the page scrolled while it was down.
 *
 * The Practice Dashboard's shelf cards, in sideways-scrolling rows inside
 * the scrolling page: on iPhone even a very short scroll that started on a
 * card also opened it. A handler of the card's own that acts on a click
 * should check `event.defaultPrevented` first. */
export function useTapNotScroll() {
  const press = useRef<{ x: number; y: number; moved: boolean; stop: () => void } | null>(null)

  const end = () => {
    press.current?.stop()
  }

  return {
    onPointerDown: (e: PointerEvent) => {
      end()
      const state = { x: e.clientX, y: e.clientY, moved: false, stop: () => {} }
      // Scroll events don't bubble, so listen in the capture phase for any
      // scroller on the page (the shelf row, the page itself).
      const onScroll = () => {
        state.moved = true
      }
      document.addEventListener('scroll', onScroll, { capture: true, passive: true })
      // The click follows the release at once; stop listening shortly after.
      let timer = 0
      state.stop = () => {
        document.removeEventListener('scroll', onScroll, { capture: true })
        window.clearTimeout(timer)
      }
      timer = window.setTimeout(state.stop, 5000)
      press.current = state
    },
    onPointerMove: (e: PointerEvent) => {
      const p = press.current
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_SLOP) p.moved = true
    },
    onPointerCancel: () => {
      if (press.current) press.current.moved = true
    },
    onClickCapture: (e: MouseEvent) => {
      const p = press.current
      // A click without a press first (the keyboard's Enter) always counts.
      if (p?.moved) e.preventDefault()
      end()
      press.current = null
    },
  }
}
