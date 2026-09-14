// Setlists design pass — the one shared "my setlists" fixture universe for
// every mockup that needs it (SidebarSetlistsMockup.tsx, AddToSetlistMockup.tsx,
// PieceDetailsSample.tsx), rather than each hand-copying its own similarly-
// shaped-but-different list. Centralized specifically so the Add to
// Setlist popover's own "quick list" (the setlists it shows without
// searching) can be computed by the exact same rule the real sidebar uses
// — same data, same function, so the demo is honest about "these are the
// same sets you'd see in the sidebar," not just visually similar.

export interface MockSetlist {
  id: string
  name: string
  gigDate: string // ISO date
}

// Gig dates set relative to "now" (days out), not fixed calendar dates —
// keeps every relative-date label correct regardless of when a mockup is
// actually opened.
export function daysFromNow(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

// The first five ids/names/offsets match this feature's original sidebar
// fixture exactly (kept stable across mockups). Three more are added beyond
// that: two further-out upcoming setlists (past the sidebar's own 5-item
// cap — reachable only via the Add to Setlist popover's search, never shown
// in its quick list) and one past-dated one (already "effectively
// archived," decision 3 — also only reachable via search, demonstrating
// that search isn't limited to upcoming sets the way the quick list is).
export const ALL_MOCK_SETLISTS: MockSetlist[] = [
  { id: '1', name: 'Sunday Morning Service', gigDate: daysFromNow(22) },
  { id: '2', name: 'Wednesday Vespers', gigDate: daysFromNow(25) },
  { id: '3', name: "All Saints' Day", gigDate: daysFromNow(50) },
  { id: '4', name: 'Lessons & Carols', gigDate: daysFromNow(78) },
  { id: '5', name: 'Christmas Eve', gigDate: daysFromNow(103) },
  { id: '6', name: "New Year's Eve Concert", gigDate: daysFromNow(130) },
  { id: '7', name: 'Winter Recital', gigDate: daysFromNow(160) },
  { id: '8', name: 'Fall Kickoff Rehearsal', gigDate: daysFromNow(-10) },
]

// The sidebar's own rule (decision 10): genuinely upcoming only (a
// past-dated setlist is already effectively archived, decision 3 — it must
// never displace a real upcoming one, not just sort to the end), soonest
// gig date first, capped at `limit`.
export function getUpcomingSetlists(setlists: MockSetlist[], limit = 5): MockSetlist[] {
  return [...setlists]
    .filter((s) => new Date(s.gigDate).getTime() >= Date.now())
    .sort((a, b) => new Date(a.gigDate).getTime() - new Date(b.gigDate).getTime())
    .slice(0, limit)
}
