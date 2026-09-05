// Split out of PieceFilterDrawer.tsx (react-refresh/only-export-components —
// see lib/navItems.ts for the established precedent this follows, CLAUDE.md
// > Frontend's "React lint gotchas" note).

// Three-way segmented control (direct request, 2026-09-05, real build of
// PieceLibrarySample.tsx's own approved mockup — see that file's
// TriState/dimensionState/setDimensionState comment for the full
// reasoning). Every array-valued facet (keyId/instrumentId/sheetTypeId/
// userTagId/practiceStatus) becomes a `Record<string, TriState>` — only
// non-neutral entries stored, 'neutral' is a key's absence — and every
// plain-boolean facet (favorite/bookless/hasImslpNumber) becomes a bare
// TriState. ID-keyed dimensions store the id as a *string* key (JS object
// keys are always strings anyway) purely so every dimension can share the
// same dimensionState/setDimensionState helpers; convert back with
// Number(k) wherever a real numeric id is needed (pieceFilterApiParams
// below, and PieceBrowseView.tsx's own facet-name lookups).
export type TriState = 'exclude' | 'neutral' | 'include'

export interface PieceFilterState {
  keyId: Record<string, TriState>
  instrumentId: Record<string, TriState>
  sheetTypeId: Record<string, TriState>
  userTagId: Record<string, TriState>
  practiceStatus: Record<string, TriState>
  favorite: TriState
  bookless: TriState
  hasImslpNumber: TriState
}

export const EMPTY_PIECE_FILTERS: PieceFilterState = {
  keyId: {},
  instrumentId: {},
  sheetTypeId: {},
  userTagId: {},
  practiceStatus: {},
  favorite: 'neutral',
  bookless: 'neutral',
  hasImslpNumber: 'neutral',
}

export function dimensionState(map: Record<string, TriState>, value: string): TriState {
  return map[value] ?? 'neutral'
}

// Returns a new map with `value` set to `next` — or removed entirely when
// `next` is 'neutral', keeping the map's own invariant (only non-neutral
// entries stored) intact rather than accumulating dead 'neutral' keys.
export function setDimensionState(
  map: Record<string, TriState>,
  value: string,
  next: TriState,
): Record<string, TriState> {
  if (next === 'neutral') {
    return Object.fromEntries(Object.entries(map).filter(([k]) => k !== value))
  }
  return { ...map, [value]: next }
}

export function activePieceFilterCount(f: PieceFilterState): number {
  return (
    Object.keys(f.keyId).length +
    Object.keys(f.instrumentId).length +
    Object.keys(f.sheetTypeId).length +
    Object.keys(f.userTagId).length +
    Object.keys(f.practiceStatus).length +
    (f.favorite !== 'neutral' ? 1 : 0) +
    (f.bookless !== 'neutral' ? 1 : 0) +
    (f.hasImslpNumber !== 'neutral' ? 1 : 0)
  )
}

function idDimensionParams(map: Record<string, TriState>): { include?: number[]; exclude?: number[] } {
  const entries = Object.entries(map)
  const include = entries.filter(([, s]) => s === 'include').map(([k]) => Number(k))
  const exclude = entries.filter(([, s]) => s === 'exclude').map(([k]) => Number(k))
  return { include: include.length ? include : undefined, exclude: exclude.length ? exclude : undefined }
}

function stringDimensionParams(map: Record<string, TriState>): { include?: string; exclude?: string } {
  const entries = Object.entries(map)
  const include = entries.filter(([, s]) => s === 'include').map(([k]) => k)
  const exclude = entries.filter(([, s]) => s === 'exclude').map(([k]) => k)
  return { include: include.length ? include.join(',') : undefined, exclude: exclude.length ? exclude.join(',') : undefined }
}

function triBool(state: TriState): boolean | undefined {
  return state === 'neutral' ? undefined : state === 'include'
}

/** Converts a PieceFilterState into the query-param shape both
 * searchPieces and getPieceFacets expect (api/pieces.ts's own
 * SearchPiecesParams/PieceFacetsParams, which mirror this 1:1) — spread
 * this directly into either call's params object. A page's own fixed
 * `filters` prop (PieceBrowseView.tsx's Favorites/Practicing-style pages)
 * should still spread *after* this, so it always wins over whatever the
 * drawer independently has set for that same field, same rule as before
 * this helper existed. */
export function pieceFilterApiParams(f: PieceFilterState) {
  const key = idDimensionParams(f.keyId)
  const sheetType = idDimensionParams(f.sheetTypeId)
  const instrument = idDimensionParams(f.instrumentId)
  const userTag = idDimensionParams(f.userTagId)
  const status = stringDimensionParams(f.practiceStatus)
  return {
    keyId: key.include,
    excludeKeyId: key.exclude,
    sheetTypeId: sheetType.include,
    excludeSheetTypeId: sheetType.exclude,
    instrumentId: instrument.include,
    excludeInstrumentId: instrument.exclude,
    userTagId: userTag.include,
    excludeUserTagId: userTag.exclude,
    practiceStatus: status.include,
    excludePracticeStatus: status.exclude,
    favorite: triBool(f.favorite),
    bookless: triBool(f.bookless),
    hasImslpNumber: triBool(f.hasImslpNumber),
  }
}
