import type { Piece } from '../api/types'

// The citation-style metadata line (design system: "composer • opus/catalog
// number • source book • year") — blank fields omitted entirely rather than
// shown as empty punctuation, same principle as the backend's citation
// format (design doc §6). Bullet (•), not a thin interpunct (·) — the
// latter reads too faint as a separator; applied consistently everywhere
// this pattern appears.
//
// Arranger rides on the composer segment itself ("Composer, arr.
// Arranger"), not as its own bullet-separated part — same reasoning as
// PieceGridCard's own composerPart logic (it qualifies the composer, it
// isn't a peer fact like the year).
//
// Three-way fallback (composer-or-arranger): a piece can legitimately
// have only an arranger (own or book-inherited) and no composer at all —
// a naive "composer ? composer+arranger : null" would drop that case's
// arranger entirely instead of falling back to "arr. Arranger", same
// pattern PiecePage.tsx's own composer/arranger row follows.
export function formatPieceMeta(piece: Piece): string {
  const composerPart =
    piece.composer.value && piece.arranger.value
      ? `${piece.composer.value}, arr. ${piece.arranger.value}`
      : piece.composer.value
        ? piece.composer.value
        : piece.arranger.value
          ? `arr. ${piece.arranger.value}`
          : null
  return [
    composerPart,
    piece.workOpusNumber.value,
    piece.sourceBookTitle,
    piece.yearWritten.value,
  ]
    .filter((part): part is string => !!part)
    .join(' • ')
}
