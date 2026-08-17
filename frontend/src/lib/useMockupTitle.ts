import { useEffect } from 'react'

// Mockup routes are unlinked from nav but still reachable by URL — the tab
// title is the one cue that a page is a design reference, not the real
// thing, when it's sitting open next to real app tabs. Restores the plain
// "Sonneck" title on unmount since these are SPA routes (no full page load
// resets it when navigating back to a real page).
export function useMockupTitle(pageName: string) {
  useEffect(() => {
    const previous = document.title
    document.title = `Sonneck - MOCKUP - ${pageName}`
    return () => {
      document.title = previous
    }
  }, [pageName])
}
