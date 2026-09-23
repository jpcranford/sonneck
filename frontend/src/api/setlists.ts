import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from './client'
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

// PATCH .../entries/{entryId} is a full replace of every field at once
// (internal/handlers/setlist.go's own setlistEntryUpdateRequest), same
// convention PATCH /api/setlists/{id} itself follows — a caller must pass
// the entry's own current `role` through unchanged if it isn't the field
// being edited, not omit it.
export interface SetlistEntryUpdateRequest {
  role: string | null
  customName?: string | null
  customDurationSeconds?: number | null
  customNotes?: string | null
  customCountsAsMusic: boolean
}

export function updateSetlistEntry(
  setlistId: number,
  entryId: number,
  req: SetlistEntryUpdateRequest,
): Promise<SetlistDetail> {
  return apiPatch<SetlistDetail>(`/api/setlists/${setlistId}/entries/${entryId}`, req)
}

// PUT .../entries/order — the complete new ordering, sent whole on every
// drop (decision 22's real drag-to-any-position reorder), not an
// incremental up/down swap.
export function reorderSetlistEntries(setlistId: number, entryIds: number[]): Promise<SetlistDetail> {
  return apiPut<SetlistDetail>(`/api/setlists/${setlistId}/entries/order`, { entryIds })
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

// getSetlistPdfUrl mirrors api/pieces.ts's own getPieceFileUrl — a plain
// URL string, no fetch wrapper. The response is a binary PDF, not this
// app's usual {data}/{error} JSON envelope, so none of this file's other
// apiGet/apiPost/etc. helpers apply; the real download flow is a plain
// `<a href={getSetlistPdfUrl(id)} download>` (see SetlistPage.tsx), same
// as PiecePage.tsx's own Download PDF button — the browser's native
// navigation handles the binary response once the server sets
// Content-Disposition/Content-Type correctly, no JS-side blob dance
// needed.
export function getSetlistPdfUrl(id: number): string {
  return `/api/setlists/${id}/pdf`
}
