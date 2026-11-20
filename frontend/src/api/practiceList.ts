import { apiDelete, apiGet, apiPost, apiPut } from './client'
import type { Piece, SetlistPieceSummary } from './types'

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

/** GET /api/practice/dashboard (internal/handlers/practicedashboard.go):
 * every shelf of the Practice Dashboard, sorted and capped by the server,
 * and the days practiced in the six weeks to `day`. */
export interface PracticeDashboard {
  /** Learning or Stalled, the most recently changed status first. */
  practicing: Piece[]
  /** Practiced pieces not in Currently Practicing, the latest day first. */
  recentlyPlayed: { piece: Piece; lastPracticed: string }[]
  /** The newest uploads first (10). */
  recentlyAdded: Piece[]
  favorites: Piece[]
  wantToLearn: Piece[]
  learned: Piece[]
  /** Each day ('YYYY-MM-DD') with a piece marked practiced, oldest first. */
  practiceDays: string[]
  /** Each shelf-with-a-page's whole count, for See all: shown only when
   * the shelf doesn't already hold them all. */
  totals: { practicing: number; favorites: number; wantToLearn: number; learned: number }
}

export function getPracticeDashboard(day: string): Promise<PracticeDashboard> {
  return apiGet<PracticeDashboard>(`/api/practice/dashboard?day=${day}`)
}
