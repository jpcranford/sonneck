// Shared name-joining helpers for the composer/arranger overhaul's ordered
// Person lists — the real, non-mockup counterpart to PersonDetailsSample.tsx's
// own local `joinNames` (that file stays a self-contained mockup per this
// codebase's usual convention; this is the version real components import).
// Locked join convention (migration plan / CLAUDE.md): 2 -> "X and Y"; 3+ ->
// Oxford-comma "X, Y, and Z" — matches the backend's own joinPersonNames
// (internal/handlers/citation.go).
export function joinNames(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

// Piece-level composer/arranger fusion ("Composer, arr. Arranger"), the
// comma convention shared by formatPieceMeta.ts/PieceGridCard.tsx/
// PiecePage.tsx/BookDetailsPage.tsx's pieceMetaLine — mirrors the backend's
// own citation fusion. Composer-or-arranger: a piece can legitimately carry
// only an arranger (own or book-inherited) and no composer at all, so this
// falls back to "arr. Arranger" rather than dropping that case's arranger
// entirely.
export function personCreditPart(composerNames: string[], arrangerNames: string[]): string | null {
  const composer = joinNames(composerNames)
  const arranger = joinNames(arrangerNames)
  if (composer && arranger) return `${composer}, arr. ${arranger}`
  if (composer) return composer
  if (arranger) return `arr. ${arranger}`
  return null
}

// Bridges an ordered Person-name list to/from a single plain-text input —
// this is what lets such a field round-trip a multi-person credit as a
// comma-separated list, rather than silently truncating to one name.
// EditPieceModal.tsx/EditBookModal.tsx's own composer/arranger fields used
// this as a Stage B stopgap and have since moved to a real multi-person
// TagComboBox (Stage C); BookUploadAboutStep.tsx and UploadPage.tsx still
// use this bridge for their own composer fields, which stayed out of
// Stage C's scope.
export function namesToText(names: string[]): string {
  return names.join(', ')
}
export function textToNames(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}
