import { useEffect, useState } from 'react'

// Mirrors DeviceInfoMockup.tsx's own matchMedia pattern — 'change' is the
// reliable event for a query's match state flipping (covers both resize
// and orientation change), unlike 'resize' alone.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const update = () => setMatches(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [query])

  return matches
}
