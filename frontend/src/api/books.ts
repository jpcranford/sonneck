import { apiGet, apiPatch, apiPost, apiUpload } from './client'
import type {
  Book,
  BookCreateRequest,
  BookWriteRequest,
  ConfirmImportRequest,
  ConfirmImportResult,
  UploadBookResult,
} from './types'

export function uploadBook(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<UploadBookResult> {
  return apiUpload<UploadBookResult>('/api/books', file, onProgress)
}

interface ListBooksParams {
  query?: string
}

// Books library view's browse/search (design mockup locked in
// 2026-08-18) — mirrors searchPieces's query-param shape in pieces.ts.
export function listBooks(params: ListBooksParams = {}): Promise<Book[]> {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const qs = search.toString()
  return apiGet<Book[]>(`/api/books${qs ? `?${qs}` : ''}`)
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

export function getBookPageThumbnailUrl(bookId: number, page: number): string {
  return `/api/books/${bookId}/pages/${page}/thumbnail`
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
