import type { Piece } from '../api/types'
import { personCreditPart } from './joinNames'

// The citation-style metadata line (design system: "composer • opus/catalog
// number • source book • year") — blank fields omitted entirely rather than
// shown as empty punctuation, same principle as the backend's citation
// format (design doc §6). Bullet (•), not a thin interpunct (·) — the
// latter reads too faint as a separator; applied consistently everywhere
// this pattern appears.
//
// Composer/Arranger are now ordered Person lists (composer/arranger
// overhaul, migration 00020) — personCreditPart (lib/joinNames.ts) joins
// each list and fuses them ("Composer, arr. Arranger"), same three-way
// composer-or-arranger fallback this file always had.
export function formatPieceMeta(piece: Piece): string {
  const composerPart = personCreditPart(
    piece.composer.values.map((p) => p.name),
    piece.arranger.values.map((p) => p.name),
  )
  return [
    composerPart,
    piece.workOpusNumber.value,
    piece.sourceBookTitle,
    piece.yearWritten.value,
  ]
    .filter((part): part is string => !!part)
    .join(' • ')
}
