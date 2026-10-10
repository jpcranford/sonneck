import { useEffect, useRef } from 'react'
import { isAnyModalOpen } from '../components/Modal'

/**
 * Escape calls `onClose` while `open` — for a slide-in panel (the filter
 * drawers) to close the same way its ✕ does. A modal open on top claims
 * Escape for itself (Modal.tsx), so the panel stays put then.
 */
export function useEscapeToClose(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || isAnyModalOpen()) return
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])
}
