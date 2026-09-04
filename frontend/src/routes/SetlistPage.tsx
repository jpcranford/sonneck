import { ComingSoon } from '../components/ComingSoon'
import { usePageTitle } from '../lib/usePageTitle'

// Reachable once real setlists exist (design doc §13) — no data source yet.
// Tab title is the generic "Setlist" for now (there's no real setlist name
// to read — this is still the placeholder) — once a real Setlist entity
// exists, this should read its own name instead, same as Book/Person
// Details do.
export function SetlistPage() {
  usePageTitle('Setlist')
  return <ComingSoon title="Setlist" />
}
