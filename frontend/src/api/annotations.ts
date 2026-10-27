import { apiGet, apiPut } from './client'
import type { Mark } from '../lib/sheetViewerMarks'

// The Sheet Viewer's annotations (internal/handlers/annotations.go): the
// signed-in account's own marks on a piece, by page number. A page with no
// marks is left out.
export type AnnotationPages = Record<number, Mark[]>

export async function getAnnotations(pieceId: number): Promise<AnnotationPages> {
  const data = await apiGet<{ pages: Record<string, Mark[]> }>(`/api/pieces/${pieceId}/annotations`)
  return Object.fromEntries(
    Object.entries(data.pages).map(([page, marks]) => [Number(page), marks]),
  )
}

// One page's marks, whole (an empty list clears the page).
export function savePageAnnotations(pieceId: number, page: number, marks: Mark[]) {
  return apiPut(`/api/pieces/${pieceId}/annotations/${page}`, { marks })
}
