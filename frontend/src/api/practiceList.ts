import { apiDelete, apiGet, apiPost, apiPut } from './client'
import type { SetlistPieceSummary } from './types'

// The Sheet Viewer's Practice List and practiced days (internal/handlers/
// practicelist.go). Every call needs the `practice` permission. A "day" is
// the viewer's own local calendar day ('YYYY-MM-DD', lib/dateOnly.ts's
// todayDateOnly), never the server's.

export interface PracticeListEntry {
  piece: SetlistPieceSummary
  /** The piece's mark for the requested day: true practiced, false
   * explicitly unmarked (stays unmarked that day), null neither. */
  practiced: boolean | null
}

/** Your Practice List in order, with each piece's mark for `day`. */
export function getPracticeList(day: string): Promise<PracticeListEntry[]> {
  return apiGet<PracticeListEntry[]>(`/api/practice-list?day=${day}`)
}

/** Appends pieces to the end, in order, skipping any already on the list. */
export function addToPracticeList(pieceIds: number[]): Promise<{ added: number }> {
  return apiPost<{ added: number }>('/api/practice-list', { pieceIds })
}

export function removeFromPracticeList(pieceId: number): Promise<{ removed: boolean }> {
  return apiDelete(`/api/practice-list/${pieceId}`)
}

/** The complete new order — every piece on the list, once. */
export function reorderPracticeList(pieceIds: number[]): Promise<{ reordered: boolean }> {
  return apiPut('/api/practice-list/order', { pieceIds })
}

export interface PracticedState {
  practiced: boolean | null
  /** The latest day the piece was marked practiced, or null. */
  lastPracticed: string | null
}

export function getPracticed(pieceId: number, day: string): Promise<PracticedState> {
  return apiGet<PracticedState>(`/api/pieces/${pieceId}/practiced?day=${day}`)
}

/** Marks a piece practiced on `day`, or (false) unmarks it for that day. */
export function setPracticed(pieceId: number, day: string, practiced: boolean): Promise<unknown> {
  return apiPut(`/api/pieces/${pieceId}/practiced/${day}`, { practiced })
}
