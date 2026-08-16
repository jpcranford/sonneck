import type { Piece } from '../api/types'

// The citation-style metadata line (design system: "composer • opus/catalog
// number • source book • year") — blank fields omitted entirely rather than
// shown as empty punctuation, same principle as the backend's citation
// format (design doc §6). Bullet (•), not a thin interpunct (·) — the
// latter read too faint as a separator (Piece View mockup review,
// 2026-08-16), applied consistently everywhere this pattern appears.
export function formatPieceMeta(piece: Piece): string {
  return [
    piece.composer.value,
    piece.workOpusNumber.value,
    piece.sourceBookTitle,
    piece.yearWritten.value,
  ]
    .filter((part): part is string => !!part)
    .join(' • ')
}
