import type { QueryClient } from '@tanstack/react-query'
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

export interface PracticedResult {
  practiced: boolean
  /** The piece has now been practiced on three days within the last four
   * weeks, not all in one week (at least one 7 to 27 days before this
   * day), and it had no status or was Want to Learn, so it's now Learning
   * (internal/repo's PromoteToLearning). */
  movedToLearning: boolean
}

/** Marks a piece practiced on `day`, or (false) unmarks it for that day. */
export function setPracticed(
  pieceId: number,
  day: string,
  practiced: boolean,
): Promise<PracticedResult> {
  return apiPut<PracticedResult>(`/api/pieces/${pieceId}/practiced/${day}`, { practiced })
}

/** After a mark moved a piece to Learning: refreshes everything showing its
 * status (the piece, the libraries and dashboard, the filter counts, the
 * Practice List, setlists). */
export function refreshAfterPracticed(
  queryClient: QueryClient,
  pieceId: number,
  result: PracticedResult,
) {
  if (!result.movedToLearning) return
  for (const queryKey of [
    ['piece', pieceId],
    ['pieces'],
    ['pieceFacets'],
    ['practice-list'],
    ['setlist'],
  ])
    queryClient.invalidateQueries({ queryKey })
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

export function getPracticeDashboard(
  day: string,
  /** The shelves in random order, each with its seed (lib/shelfShuffle.ts):
   * the server picks at random from the whole view, then caps. */
  shuffle: Record<string, number> = {},
): Promise<PracticeDashboard> {
  const pairs = Object.entries(shuffle)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([shelf, seed]) => `${shelf}:${seed}`)
  const q = pairs.length ? `&shuffle=${pairs.join(',')}` : ''
  return apiGet<PracticeDashboard>(`/api/practice/dashboard?day=${day}${q}`)
}
