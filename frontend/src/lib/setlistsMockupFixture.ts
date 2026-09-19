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
  // Nullable, matching the real data model (`setlists.gig_date` is a
  // nullable ISO date column) — a setlist can exist with nothing scheduled
  // yet. Only setlist '9' below actually exercises this; every other
  // mockup that reads this fixture (Sidebar, AddToSetlistPicker) already
  // treats a non-comparable date as "not upcoming" for free, since
  // `new Date(undefined).getTime()` is `NaN` and every comparison against
  // `NaN` is false.
  gigDate?: string
  // The Setlists Library page's own card fields (decision 12/Frontend
  // surfaces item 1) — entry/duration/page summary, and the explicit
  // manual-archive flag (decision 3). Unused by Sidebar/AddToSetlistPicker,
  // present on every entry anyway so this stays the one honest "my
  // setlists" universe rather than forking a second, Archive-only list.
  entryCount: number
  totalDurationSeconds?: number
  totalPages: number
  // The *explicit* archived pick only — decision 3's other half (a passed
  // gigDate) is computed, not stored; see isEffectivelyArchived below.
  archived?: boolean
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
// fixture exactly (kept stable across mockups). Beyond that: two further-out
// upcoming setlists (past the sidebar's own 5-item cap — reachable only via
// the Add to Setlist popover's search, never shown in its quick list), one
// *manually* archived while still genuinely upcoming ('7' — decision 3's
// other archive path, distinct from a passed date), one past-dated one
// (already "effectively archived" purely by its date having passed), and
// one with no gigDate at all (a setlist that exists but has nothing
// scheduled yet — a real, nullable case, not an edge case to special-case
// away).
//
// entryCount/totalDurationSeconds/totalPages for '1' ("Sunday Morning
// Service") are the exact real totals `SetlistDetailsMockup.tsx`'s own
// 7-entry fixture sums to (2+3+4+1 pages, 150+180+225+255+180+120+300
// seconds = 23:30) — kept in sync deliberately, not coincidental, so a
// setlist's own card and its detail page never disagree about its totals.
// Every other entry's numbers are just plausible, not derived from a real
// program anywhere.
export const ALL_MOCK_SETLISTS: MockSetlist[] = [
  { id: '1', name: 'Sunday Morning Service', gigDate: daysFromNow(22), entryCount: 7, totalDurationSeconds: 1410, totalPages: 10 },
  { id: '2', name: 'Wednesday Vespers', gigDate: daysFromNow(25), entryCount: 4, totalDurationSeconds: 780, totalPages: 6 },
  { id: '3', name: "All Saints' Day", gigDate: daysFromNow(50), entryCount: 9, totalDurationSeconds: 1920, totalPages: 14 },
  { id: '4', name: 'Lessons & Carols', gigDate: daysFromNow(78), entryCount: 12, totalDurationSeconds: 2640, totalPages: 22 },
  { id: '5', name: 'Christmas Eve', gigDate: daysFromNow(103), entryCount: 10, totalDurationSeconds: 2100, totalPages: 17 },
  { id: '6', name: "New Year's Eve Concert", gigDate: daysFromNow(130), entryCount: 6, totalDurationSeconds: 1560, totalPages: 11 },
  { id: '7', name: 'Winter Recital', gigDate: daysFromNow(160), entryCount: 8, totalDurationSeconds: 1740, totalPages: 13, archived: true },
  { id: '8', name: 'Fall Kickoff Rehearsal', gigDate: daysFromNow(-10), entryCount: 5, totalDurationSeconds: 960, totalPages: 8 },
  { id: '9', name: 'Spring Showcase (planning)', entryCount: 2, totalPages: 3 },
]

// The sidebar's own rule (decision 10): genuinely upcoming only (a
// past-dated setlist is already effectively archived, decision 3 — it must
// never displace a real upcoming one, not just sort to the end), soonest
// gig date first, capped at `limit`. A setlist with no gigDate at all is
// never "upcoming" (nothing to sort by) — the type predicate below both
// drops it and, for every caller downstream, narrows `gigDate` from
// `string | undefined` to a guaranteed `string`, so nothing reading this
// function's own result needs a fallback/assertion of its own.
export function getUpcomingSetlists(
  setlists: MockSetlist[],
  limit = 5,
): (MockSetlist & { gigDate: string })[] {
  return [...setlists]
    .filter((s): s is MockSetlist & { gigDate: string } => s.gigDate != null && new Date(s.gigDate).getTime() >= Date.now())
    .sort((a, b) => new Date(a.gigDate).getTime() - new Date(b.gigDate).getTime())
    .slice(0, limit)
}

// Decision 3: "Archive is both manual and automatic" — one stored explicit
// flag, plus a passed gigDate, computed at read time and never written
// back (same asymmetric-resolution posture as the Public Domain Badge's
// own effective-status computation). A setlist with no gigDate at all is
// never auto-archived by this rule — nothing to compare, so only an
// explicit `archived` pick can put it in the Archived section.
export function isEffectivelyArchived(setlist: MockSetlist): boolean {
  if (setlist.archived) return true
  if (!setlist.gigDate) return false
  return new Date(setlist.gigDate).getTime() < Date.now()
}
