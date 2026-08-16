import { apiGet, apiPatch, apiPost, apiUpload } from './client'
import type {
  Book,
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

export function getBook(id: number): Promise<Book> {
  return apiGet<Book>(`/api/books/${id}`)
}

export function updateBook(id: number, req: BookWriteRequest): Promise<Book> {
  return apiPatch<Book>(`/api/books/${id}`, req)
}

export function getBookPageThumbnailUrl(bookId: number, page: number): string {
  return `/api/books/${bookId}/pages/${page}/thumbnail`
}

export function confirmImport(
  bookId: number,
  req: ConfirmImportRequest,
): Promise<ConfirmImportResult> {
  return apiPost<ConfirmImportResult>(`/api/books/${bookId}/confirm-import`, req)
}
