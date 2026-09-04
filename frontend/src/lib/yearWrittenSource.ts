import type { Piece } from '../api/types'

// Year Written's own extended fallback chain (repo.resolveYearWritten:
// piece's own Copyright Year is checked before the book's Year Published)
// means piece.yearWritten.inherited alone can't say which source an
// inherited value actually came from — needed wherever an "Inherited from
// ..." label has to name it correctly (EditPieceModal.tsx's InheritedNote,
// PiecePage.tsx's own separate read-only one). Mirrors the backend's own
// check exactly, not an approximation: falls back to Copyright Year only
// when the piece's own raw column is set, i.e. the effective CopyrightYear
// is both present and not itself inherited from the book.
export function yearWrittenSource(piece: Piece): string {
  return piece.copyrightYear.value != null && !piece.copyrightYear.inherited ? 'copyright year' : 'book'
}
