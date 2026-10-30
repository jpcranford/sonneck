import { useCallback, useState } from 'react'

/**
 * The rendered height of an element, kept current as it changes (a row of
 * buttons wrapping onto a second line, late font loads) — for sizing
 * something else around it. A callback ref, so it also measures an element
 * that only appears after the first render (once data loads). Null until
 * first measured.
 */
export function useMeasuredHeight<T extends HTMLElement>() {
  const [height, setHeight] = useState<number | null>(null)
  const ref = useCallback((el: T | null) => {
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setHeight(Math.ceil(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, height] as const
}
