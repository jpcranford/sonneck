import { useEffect } from 'react'

// The Sheet Viewer has no right-click menu: a right-click (or a long press
// that the browser would turn into one) over the pages or the toolbar does
// nothing, so the browser's own menu (Save Image, Inspect…) never covers
// the music. Text fields keep theirs, for copy, paste and spelling.
// Listens on the document, so panels portaled to <body> are covered too.
export function useNoContextMenu() {
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target
      if (
        target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
      )
        return
      event.preventDefault()
    }
    document.addEventListener('contextmenu', onContextMenu)
    return () => document.removeEventListener('contextmenu', onContextMenu)
  }, [])
}
