import { useEffect } from 'react'

// Real counterpart to useMockupTitle.ts (mockup routes' own "Sonneck -
// MOCKUP - X" version) — sets the browser tab title for a real page.
// `pageName` may be undefined/empty while its data is still loading (a
// piece/book/person title isn't known yet on first render); in that case
// this leaves the previous title alone rather than flashing a bare
// "Sonneck -" for a moment, and still restores it on unmount either way.
export function usePageTitle(pageName: string | undefined) {
  useEffect(() => {
    if (!pageName) return
    const previous = document.title
    document.title = `Sonneck - ${pageName}`
    return () => {
      document.title = previous
    }
  }, [pageName])
}
