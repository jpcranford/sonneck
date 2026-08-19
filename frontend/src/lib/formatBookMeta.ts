import type { Book } from '../api/types'

// Composer is optional on Book (design doc §3) — publisher is the agreed
// fallback display value when it's blank (design review, 2026-08-18), not
// a book-inheritance "InheritedNote" badge — this is a book falling back
// to its own other field, not a piece falling back to its book.
export function effectiveBookComposer(book: Book): string | null {
  return book.composer || book.publisher
}

// Same "•"-joined, blank-fields-omitted convention as formatPieceMeta.ts.
export function formatBookMeta(book: Book): string {
  return [effectiveBookComposer(book), book.yearWritten]
    .filter((part): part is string => !!part)
    .join(' • ')
}
