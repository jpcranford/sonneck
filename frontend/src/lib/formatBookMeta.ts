import type { Book } from '../api/types'
import { joinNames } from './joinNames'

// Composer-or-arranger: a Book can have an arranger with no composer at
// all (ValidateBook requires one of the two, not composer
// specifically), fused onto composer ("Composer • arr. Arranger") when
// both are set — bullet-separated, not comma, to mirror how Piece Details
// shows a piece's own composer/arranger row (PiecePage.tsx). Falls back
// further to publisher only when the book has neither composer nor
// arranger (the pre-existing composer→publisher fallback, unchanged). Note
// this is deliberately different from the *piece*-level composer/arranger
// fusion used elsewhere (formatPieceMeta.ts, PieceGridCard.tsx), which
// still uses a comma — that one mirrors the backend's citation format
// instead, not Piece Details' own header.
//
// Composer/Arranger are ordered Person lists (composer/arranger overhaul,
// migration 00020) — joinNames (lib/joinNames.ts) joins each list before
// fusing them.
export function bookComposerPart(book: Book): string | null {
  const composer = joinNames(book.composer.map((p) => p.name))
  const arranger = joinNames(book.arranger.map((p) => p.name))
  if (composer && arranger) return `${composer} • arr. ${arranger}`
  if (composer) return composer
  if (arranger) return `arr. ${arranger}`
  return book.publisher
}

// Composer is optional on Book (design doc §3) — publisher is the agreed
// fallback display value when it's blank, not a book-inheritance
// "InheritedNote" badge — this is a book falling back
// to its own other field, not a piece falling back to its book. Kept
// separate from bookComposerPart above (which also folds in arranger) for
// any caller that only ever wants the bare composer-or-publisher value.
export function effectiveBookComposer(book: Book): string | null {
  return joinNames(book.composer.map((p) => p.name)) || book.publisher
}

// Same "•"-joined, blank-fields-omitted convention as formatPieceMeta.ts.
export function formatBookMeta(book: Book): string {
  return [bookComposerPart(book), book.yearWritten].filter((part): part is string => !!part).join(' • ')
}
