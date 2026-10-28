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

// Download PDF + Annotations (internal/handlers/annotatedpdf.go): how many
// marks a download would carry, and how many it leaves out for being in a
// color hidden on that piece. A setlist's counts cover its pieces, each once.
export type AnnotationSummary = { shown: number; hidden: number }

export function getPieceAnnotationSummary(pieceId: number) {
  return apiGet<AnnotationSummary>(`/api/pieces/${pieceId}/annotations/summary`)
}

export function getSetlistAnnotationSummary(setlistId: number) {
  return apiGet<AnnotationSummary>(`/api/setlists/${setlistId}/annotations/summary`)
}

// The annotated download's address: the plain one, asked for annotations.
export const withAnnotations = (url: string) => `${url}?annotations=true`

// Why "+ Annotations" is faded (nothing to export), or null when it isn't.
export function annotationExportBlocked(
  summary: AnnotationSummary | undefined,
  scope: 'piece' | 'set',
): string | null {
  if (!summary || summary.shown > 0) return null
  const where = scope === 'piece' ? 'this piece' : "this set's pieces"
  return summary.hidden > 0
    ? `Your annotations on ${where} are all in hidden colors. Show a color in the Sheet Viewer's Layers menu to include it.`
    : `No annotations on ${where} yet. Draw some in the Sheet Viewer first.`
}
