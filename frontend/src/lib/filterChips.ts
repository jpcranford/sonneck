// Active-filter chip colors, matching Piece Details' pills: green for the
// viewer's own data (practice status, Your Tags, favorites, annotations),
// neutral outline for shared catalog facts (keys, instruments, sheet types,
// eras…), and red for any filter set to exclude ("Not …").

export type FilterChipTone = 'own' | 'catalog'

// The piece library's filters that are the viewer's own data.
const OWN_PIECE_FILTERS = new Set(['practiceStatus', 'userTagId', 'favorite', 'hasAnnotations'])

export function pieceFilterTone(field: string): FilterChipTone {
  return OWN_PIECE_FILTERS.has(field) ? 'own' : 'catalog'
}

/** The chip's border, fill and text. */
export function filterChipClass(tone: FilterChipTone, excluded: boolean): string {
  if (excluded) return 'border-danger/30 bg-danger-soft text-danger'
  return tone === 'own'
    ? 'border-accent/30 bg-accent-soft text-accent'
    : 'border-border text-ink-soft'
}

/** Its ✕ button's color. */
export function filterChipRemoveClass(tone: FilterChipTone, excluded: boolean): string {
  if (excluded) return 'text-danger'
  return tone === 'own' ? 'text-accent' : 'text-ink-soft'
}
