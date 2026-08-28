import { apiDelete, apiGet, apiPatch, apiPost, apiUpload } from './client'
import type {
  Book,
  BookCreateRequest,
  BookWriteRequest,
  ConfirmImportRequest,
  ConfirmImportResult,
  UploadBookResult,
} from './types'
// FacetCount's shape (id/name/count) is identical for both resources —
// reused rather than redefined, same reasoning as any other shared type.
import type { FacetCount } from './pieces'

export function uploadBook(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<UploadBookResult> {
  return apiUpload<UploadBookResult>('/api/books', file, onProgress)
}

interface ListBooksParams {
  query?: string
  /** Comma-separated on the wire, same multi-select convention as
   * SearchPiecesParams's own keyId/instrumentId/sheetTypeId/userTagId —
   * see that file's comment for why an array param is enough here. */
  sheetTypeId?: number[]
  instrumentId?: number[]
  sort?: 'dateAdded' | 'title' | 'composer' | 'yearWritten'
  dir?: 'asc' | 'desc'
}

// Books library view's browse/search — mirrors searchPieces's
// query-param shape in pieces.ts.
export function listBooks(params: ListBooksParams = {}): Promise<Book[]> {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const qs = search.toString()
  return apiGet<Book[]>(`/api/books${qs ? `?${qs}` : ''}`)
}

export interface BookFacets {
  sheetTypes: FacetCount[]
  instruments: FacetCount[]
}

export function getBookFacets(): Promise<BookFacets> {
  return apiGet<BookFacets>('/api/books/facets')
}

// Books library view's "New Book" button — creates a Book with no
// underlying file, distinct from uploadBook above (which always requires
// a real PDF).
export function createBookManual(req: BookCreateRequest): Promise<Book> {
  return apiPost<Book>('/api/books/manual', req)
}

export function getBook(id: number): Promise<Book> {
  return apiGet<Book>(`/api/books/${id}`)
}

export function updateBook(id: number, req: BookWriteRequest): Promise<Book> {
  return apiPatch<Book>(`/api/books/${id}`, req)
}

// Book Library context menu's "Delete Book" — a cascade delete: removes
// the Book *and* every Piece referencing it in one action, unlike
// deletePiece's own orphan-cleanup
// side effect (which only ever removes a Book once its last piece is
// already gone, one piece at a time).
export function deleteBook(id: number): Promise<{ deleted: boolean; id: number }> {
  return apiDelete(`/api/books/${id}`)
}

export function getBookPageThumbnailUrl(bookId: number, page: number): string {
  return `/api/books/${bookId}/pages/${page}/thumbnail`
}

// The one URL every part of the frontend should use to render "this book's
// cover" (Book Details header, Books library cards) — the backend resolves
// the fallback chain itself (custom cover, then the derived first-page
// thumbnail, then 404), so no call site needs its own conditional between
// getBookPageThumbnailUrl(id, 1) and a separate custom-cover URL. Callers
// still gate whether to render an <img> at all on `book.hasCustomCover ||
// book.fileHash` (this URL 404s when neither is true — the "No-File Cover"
// placeholder case).
//
// `version` should be `book.coverImageHash ?? book.fileHash` — this URL is
// otherwise the exact same string before and after a cover upload/replace/
// removal, and nothing else forces a re-fetch: React doesn't reload an
// <img> whose src prop didn't change, and the browser has no other signal
// the underlying image is different now. Found live: a cover upload's own
// success screen kept showing the *old* image until a hard refresh, with
// the backend already correctly serving the new one (confirmed via curl)
// — a version-less URL, not a caching-headers issue.
export function getBookCoverUrl(bookId: number, version?: string | null): string {
  return version ? `/api/books/${bookId}/cover?v=${version}` : `/api/books/${bookId}/cover`
}

// Manual cover image upload — independent of whether the book already has
// a real PDF file. Applies regardless:
// overrides the derived thumbnail either way.
export function uploadBookCover(bookId: number, file: File): Promise<Book> {
  return apiUpload<Book>(`/api/books/${bookId}/cover`, file)
}

export function removeBookCover(bookId: number): Promise<Book> {
  return apiDelete<Book>(`/api/books/${bookId}/cover`)
}

// Book Details page's "Open Book PDF" button — inline Content-Disposition
// (handleDownloadBookFile), so opened with target="_blank" this renders in
// a new tab instead of forcing a download, same convention as the piece
// file route (getPieceFileUrl).
export function getBookFileUrl(bookId: number): string {
  return `/api/books/${bookId}/file`
}

export function confirmImport(
  bookId: number,
  req: ConfirmImportRequest,
): Promise<ConfirmImportResult> {
  return apiPost<ConfirmImportResult>(`/api/books/${bookId}/confirm-import`, req)
}
