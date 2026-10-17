import { useEffect, useRef, useState } from 'react'

/**
 * The rendered width of an element, kept current as it changes (late font
 * loads included) — for sizing something else to it, like a column that
 * should fit its widest entry when each row is laid out on its own. Null
 * until first measured.
 */
export function useMeasuredWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState<number | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.ceil(entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}
