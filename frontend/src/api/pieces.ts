import { apiDelete, apiGet, apiPatch, apiUpload, apiUploadWithStatus } from './client'
import type { Piece, PieceWriteRequest } from './types'

/**
 * Backend dedupes on SHA-256 match (CLAUDE.md > File handling): uploading a
 * file identical to one already in the library returns the existing Piece
 * (200) instead of creating a duplicate (201). `alreadyExists` lets the
 * upload flow skip straight to that piece instead of the fill-in-details
 * step meant for a brand new, still-blank piece.
 */
export function uploadPiece(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<{ piece: Piece; alreadyExists: boolean }> {
  return apiUploadWithStatus<Piece>('/api/pieces', file, onProgress).then(({ data, status }) => ({
    piece: data,
    alreadyExists: status === 200,
  }))
}

export function getPiece(id: number): Promise<Piece> {
  return apiGet<Piece>(`/api/pieces/${id}`)
}

// Piece Details page's dice button. Backend registers this as a literal
// "GET /api/pieces/random" route ahead of "GET /api/pieces/{id}" — see
// handleGetRandomPiece's own comment for why the wildcard route doesn't
// swallow it. 404s (NOT_FOUND) when the library is empty, same as any
// other missing-piece lookup.
export function getRandomPiece(): Promise<Piece> {
  return apiGet<Piece>('/api/pieces/random')
}

export function updatePiece(id: number, req: PieceWriteRequest): Promise<Piece> {
  return apiPatch<Piece>(`/api/pieces/${id}`, req)
}

export function deletePiece(id: number): Promise<{ deleted: boolean; id: number }> {
  return apiDelete(`/api/pieces/${id}`)
}

export function getPieceFileUrl(id: number): string {
  return `/api/pieces/${id}/file`
}

export function getPieceThumbnailUrl(id: number, page: number = 1): string {
  return `/api/pieces/${id}/pages/${page}/thumbnail`
}

export function replacePieceFile(
  id: number,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<Piece> {
  return apiUpload<Piece>(`/api/pieces/${id}/replace-file`, file, onProgress)
}

export function setPieceThumbnailPage(id: number, page: number): Promise<Piece> {
  return apiPatch<Piece>(`/api/pieces/${id}/thumbnail-page`, { page })
}

export function getCitation(id: number): Promise<{ citation: string }> {
  return apiGet(`/api/pieces/${id}/citation`)
}

export interface SearchPiecesParams {
  query?: string
  /** Comma-separated on the wire — the Filter Drawer's Key/Instrument/
   * SheetType/UserTags sections are real multi-select checkbox lists
   * (OR-matched), not single-choice. Passing an array here is enough:
   * URLSearchParams.set(key, String(array)) already comma-joins it, same
   * mechanism practiceStatus already relied on before these gained
   * multi-select too. */
  keyId?: number[]
  sheetTypeId?: number[]
  instrumentId?: number[]
  userTagId?: number[]
  favorite?: boolean
  practiceStatus?: string
  /** Pieces with no sourceBookId at all (design doc §3/§5 — a normal,
   * first-class case, e.g. a single downloaded score). Asymmetric with
   * `favorite`: the backend treats `bookless=false` as a no-op, not a
   * hard "exclude bookless" filter — there's no drawer affordance for
   * "book-having pieces only" to send it. */
  bookless?: boolean
  /** Book Details page: every piece belonging to this book, sorted by
   * start page ascending (server-side tie-break: a same-start-page 1-page
   * piece sorts before a longer one) instead of the default newest-first
   * order — and with no limit/offset cap, since the page renders every
   * piece in the book at once rather than paginating. sort/dir below are
   * ignored server-side whenever this is set — the page-order sort is a
   * structural property of the book, not a user preference. */
  sourceBookId?: number
  sort?: 'dateAdded' | 'title' | 'composer'
  dir?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export function searchPieces(params: SearchPiecesParams = {}): Promise<Piece[]> {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const qs = search.toString()
  return apiGet<Piece[]>(`/api/pieces${qs ? `?${qs}` : ''}`)
}

/** One filter-drawer facet option (e.g. one Key) paired with how many
 * pieces currently match it — see internal/handlers/facets.go's own doc
 * comment for why these counts are deliberately static (computed once
 * against the whole library, not re-narrowed by other active filters or
 * the search box). */
export interface FacetCount {
  id: number
  name: string
  count: number
}

/** practiceStatus has no separate lookup table/ID (a CHECK constraint on
 * a plain column, unlike Key/Instrument/SheetType/UserTag) and the
 * practiceStatus filter param already takes the status string directly,
 * so this facet has no id field. */
export interface StatusCount {
  status: string
  count: number
}

export interface PieceFacets {
  keys: FacetCount[]
  instruments: FacetCount[]
  sheetTypes: FacetCount[]
  userTags: FacetCount[]
  practiceStatuses: StatusCount[]
  favorite: number
  bookless: number
}

export function getPieceFacets(): Promise<PieceFacets> {
  return apiGet<PieceFacets>('/api/pieces/facets')
}
