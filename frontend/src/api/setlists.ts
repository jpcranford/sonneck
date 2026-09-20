import { apiDelete, apiGet, apiPatch, apiPost } from './client'
import type {
  PieceSetlistMembership,
  Setlist,
  SetlistCreateRequest,
  SetlistDetail,
  SetlistEntryInput,
  SetlistUpdateRequest,
} from './types'

export function listSetlists(): Promise<Setlist[]> {
  return apiGet<Setlist[]>('/api/setlists')
}

// See PieceSetlistMembership's own doc comment (api/types.ts) for why this
// is one bulk fetch rather than a per-piece/per-card request.
export function listPieceSetlistMemberships(): Promise<PieceSetlistMembership[]> {
  return apiGet<PieceSetlistMembership[]>('/api/setlists/memberships')
}

export function getSetlist(id: number): Promise<SetlistDetail> {
  return apiGet<SetlistDetail>(`/api/setlists/${id}`)
}

export function createSetlist(req: SetlistCreateRequest): Promise<SetlistDetail> {
  return apiPost<SetlistDetail>('/api/setlists', req)
}

export function updateSetlist(id: number, req: SetlistUpdateRequest): Promise<SetlistDetail> {
  return apiPatch<SetlistDetail>(`/api/setlists/${id}`, req)
}

export function deleteSetlist(id: number): Promise<{ deleted: boolean }> {
  return apiDelete(`/api/setlists/${id}`)
}

export function addSetlistEntry(setlistId: number, req: SetlistEntryInput): Promise<SetlistDetail> {
  return apiPost<SetlistDetail>(`/api/setlists/${setlistId}/entries`, req)
}

export function removeSetlistEntry(setlistId: number, entryId: number): Promise<{ deleted: boolean }> {
  return apiDelete(`/api/setlists/${setlistId}/entries/${entryId}`)
}

// getUpcomingSetlists mirrors SidebarSetlistsMockup.tsx's own approved
// function (lib/setlistsMockupFixture.ts) — soonest gig date first, capped
// at `limit` — with one real refinement the mockup's own fixture never
// actually exercised: excluding effectiveArchived here too, not just a
// null/past gigDate, so a manually-archived-but-still-upcoming setlist
// (decision 3's other archive path) can never surface in "Upcoming Sets" —
// consistent with the Setlists Library page's own Active/Archived split,
// which already treats effectiveArchived as the one true membership test.
export function getUpcomingSetlists(setlists: Setlist[], limit = 5): (Setlist & { gigDate: string })[] {
  return [...setlists]
    .filter((s): s is Setlist & { gigDate: string } => !s.effectiveArchived && s.gigDate != null)
    .sort((a, b) => (a.gigDate < b.gigDate ? -1 : a.gigDate > b.gigDate ? 1 : 0))
    .slice(0, limit)
}
