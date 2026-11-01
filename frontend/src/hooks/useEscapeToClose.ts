import { useEffect, useRef } from 'react'
import { isAnyModalOpen } from '../components/Modal'
import { isPlainKeyPress, useShortcutBlocker } from '../lib/shortcuts'

/**
 * Escape calls `onClose` while `open` — for a slide-in panel (the filter
 * drawers) to close the same way its ✕ does. A modal open on top claims
 * Escape for itself (Modal.tsx), so the panel stays put then. `toggleKey`,
 * the key that opened the panel (the drawers' G), closes it too, pressed
 * like a shortcut (lib/shortcuts.ts's isPlainKeyPress: not while typing in
 * one of its fields).
 */
export function useEscapeToClose(open: boolean, onClose: () => void, toggleKey?: string) {
  // Page shortcuts pause while the panel is open (lib/shortcuts.ts).
  useShortcutBlocker(open)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (isAnyModalOpen()) return
      if (event.key === 'Escape') {
        onCloseRef.current()
      } else if (toggleKey && isPlainKeyPress(event, toggleKey)) {
        event.preventDefault()
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, toggleKey])
}
