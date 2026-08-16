import { apiDelete, apiGet, apiPatch, apiUpload } from './client'
import type { Piece, PieceWriteRequest } from './types'

export function uploadPiece(file: File, onProgress?: (percent: number) => void): Promise<Piece> {
  return apiUpload<Piece>('/api/pieces', file, onProgress)
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
