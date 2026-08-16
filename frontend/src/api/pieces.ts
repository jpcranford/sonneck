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

export function getCitation(id: number): Promise<{ citation: string }> {
  return apiGet(`/api/pieces/${id}/citation`)
}

export interface SearchPiecesParams {
  query?: string
  keyId?: number
  sheetTypeId?: number
  instrumentId?: number
  userTagId?: number
  favorite?: boolean
  practiceStatus?: string
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
