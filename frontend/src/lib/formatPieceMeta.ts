import type { Piece } from '../api/types'

// The citation-style metadata line (design system: "composer • opus/catalog
// number • source book • year") — blank fields omitted entirely rather than
// shown as empty punctuation, same principle as the backend's citation
// format (design doc §6). Bullet (•), not a thin interpunct (·) — the
// latter read too faint as a separator (Piece View mockup review,
// 2026-08-16), applied consistently everywhere this pattern appears.
//
// Arranger rides on the composer segment itself ("Composer, arr.
// Arranger"), not as its own bullet-separated part — same reasoning as
// PieceGridCard's own composerPart logic (it qualifies the composer, it
// isn't a peer fact like the year), and this was the one real gap: list
// view cards (the only caller of this helper) were dropping arranger
// entirely, unlike the grid cards and the Piece View itself.
export function formatPieceMeta(piece: Piece): string {
  const composerPart = piece.composer.value
    ? piece.composer.value + (piece.arranger ? `, arr. ${piece.arranger}` : '')
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
