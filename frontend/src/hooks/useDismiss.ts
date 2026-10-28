import { useEffect, useRef, type RefObject } from 'react'
import { isAnyModalOpen } from '../components/Modal'
import { useShortcutBlocker } from '../lib/shortcuts'

/**
 * Closes a dropdown the standard way while `open`: a press anywhere outside
 * `ref` (the menu and its own trigger, or a row of several), or Escape —
 * unless a modal opened on top claims Escape for itself. Page shortcuts
 * pause meanwhile, as for the app's other menus (lib/shortcuts.ts).
 */
export function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, onClose: () => void) {
  useShortcutBlocker(open)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onCloseRef.current()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isAnyModalOpen()) onCloseRef.current()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, ref])
}
