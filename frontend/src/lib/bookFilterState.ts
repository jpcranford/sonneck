// Split out of BookFilterDrawer.tsx (react-refresh/only-export-components —
// see lib/navItems.ts for the established precedent, CLAUDE.md > Frontend's
// "React lint gotchas" note).

// Three-way segmented control (direct request, 2026-09-05, real build of
// BooksLibrarySample.tsx's own approved mockup — see pieceFilterState.ts's
// own TriState comment for the full reasoning, unchanged here). Ids are
// stored as string keys purely so both dimensions can share the same
// dimensionState/setDimensionState helpers every other filter drawer uses;
// convert back with Number(k) wherever a real numeric id is needed.
export type TriState = 'exclude' | 'neutral' | 'include'

export interface BookFilterState {
  sheetTypeId: Record<string, TriState>
  instrumentId: Record<string, TriState>
}

export const EMPTY_BOOK_FILTERS: BookFilterState = { sheetTypeId: {}, instrumentId: {} }

export function dimensionState(map: Record<string, TriState>, value: string): TriState {
  return map[value] ?? 'neutral'
}

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

export function activeBookFilterCount(f: BookFilterState): number {
  return Object.keys(f.sheetTypeId).length + Object.keys(f.instrumentId).length
}

function idDimensionParams(map: Record<string, TriState>): { include?: number[]; exclude?: number[] } {
  const entries = Object.entries(map)
  const include = entries.filter(([, s]) => s === 'include').map(([k]) => Number(k))
  const exclude = entries.filter(([, s]) => s === 'exclude').map(([k]) => Number(k))
  return { include: include.length ? include : undefined, exclude: exclude.length ? exclude : undefined }
}

/** Converts a BookFilterState into the query-param shape both listBooks
 * and getBookFacets expect (api/books.ts's own ListBooksParams/
 * BookFacetsParams) — spread this directly into either call's params
 * object, same pattern as pieces.ts's own pieceFilterApiParams. */
export function bookFilterApiParams(f: BookFilterState) {
  const sheetType = idDimensionParams(f.sheetTypeId)
  const instrument = idDimensionParams(f.instrumentId)
  return {
    sheetTypeId: sheetType.include,
    excludeSheetTypeId: sheetType.exclude,
    instrumentId: instrument.include,
    excludeInstrumentId: instrument.exclude,
  }
}
