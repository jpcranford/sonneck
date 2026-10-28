import { useLayoutEffect, type RefObject } from 'react'

const MARGIN = 8

/**
 * Keeps an open dropdown that's positioned beside its trigger (absolute,
 * in the page) on screen: when it would reach past either side of the
 * window — a trigger that wrapped to a narrow phone row — it slides back
 * sideways until it's 8px inside, before the frame paints. Re-checked on
 * resize. `open` is whether it's open, or which of several sharing the ref
 * is (re-checked when that changes). For a panel portaled to <body>,
 * useAnchoredPanel's panelWidth does the same.
 */
export function useKeepInView(ref: RefObject<HTMLElement | null>, open: boolean | string | null) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!open || !el) return
    function place() {
      if (!el) return
      el.style.translate = ''
      const box = el.getBoundingClientRect()
      const width = document.documentElement.clientWidth
      let dx = 0
      if (box.right > width - MARGIN) dx = width - MARGIN - box.right
      if (box.left + dx < MARGIN) dx = MARGIN - box.left
      if (dx) el.style.translate = `${dx}px 0`
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [ref, open])
}
