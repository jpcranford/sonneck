import { ComingSoon } from '../components/ComingSoon'
import { usePageTitle } from '../lib/usePageTitle'

// The /setlists index route — real and reachable now (scaffold-and-hide,
// same posture as SetlistPage.tsx's own /setlists/:id stub) specifically
// so the sidebar's "⋯" menu (SidebarSetlists.tsx) has a real destination
// to link to rather than a /mockup/* URL. Full build (the two-section
// Active/Archived layout, decision 12) is Phase 15's own scope — see
// SetlistsLibraryMockup.tsx for the approved design this becomes.
export function SetlistsLibraryPage() {
  usePageTitle('Setlists')
  return <ComingSoon title="Setlists" />
}
