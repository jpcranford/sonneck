// Split out of BookFilterDrawer.tsx (react-refresh/only-export-components —
// see lib/navItems.ts for the established precedent, CLAUDE.md > Frontend's
// "React lint gotchas" note).
export interface BookFilterState {
  sheetTypeId: number[]
  instrumentId: number[]
}

export const EMPTY_BOOK_FILTERS: BookFilterState = { sheetTypeId: [], instrumentId: [] }

export function activeBookFilterCount(f: BookFilterState): number {
  return f.sheetTypeId.length + f.instrumentId.length
}
