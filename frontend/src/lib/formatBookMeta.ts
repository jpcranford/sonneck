import type { Book } from '../api/types'

// Composer-or-arranger (2026-08-20): a Book can now have an arranger with
// no composer at all (ValidateBook requires one of the two, not composer
// specifically), fused onto composer (", arr. Arranger") when both are
// set — same three-way fallback as PieceViewSample.tsx's bookComposerPart
// and the backend's buildCitation. Falls back further to publisher only
// when the book has neither composer nor arranger (the pre-existing
// composer→publisher fallback, unchanged).
export function bookComposerPart(book: Book): string | null {
  if (book.composer && book.arranger) return `${book.composer}, arr. ${book.arranger}`
  if (book.composer) return book.composer
  if (book.arranger) return `arr. ${book.arranger}`
  return book.publisher
}

// Composer is optional on Book (design doc §3) — publisher is the agreed
// fallback display value when it's blank (design review, 2026-08-18), not
// a book-inheritance "InheritedNote" badge — this is a book falling back
// to its own other field, not a piece falling back to its book. Kept
// separate from bookComposerPart above (which also folds in arranger) for
// any caller that only ever wants the bare composer-or-publisher value.
export function effectiveBookComposer(book: Book): string | null {
  return book.composer || book.publisher
}

// Same "•"-joined, blank-fields-omitted convention as formatPieceMeta.ts.
export function formatBookMeta(book: Book): string {
  return [bookComposerPart(book), book.yearWritten].filter((part): part is string => !!part).join(' • ')
}
