// Split out of PieceFilterDrawer.tsx (react-refresh/only-export-components —
// see lib/navItems.ts for the established precedent this follows, CLAUDE.md
// > Frontend's "React lint gotchas" note).
export interface PieceFilterState {
  keyId: number[]
  instrumentId: number[]
  sheetTypeId: number[]
  userTagId: number[]
  practiceStatus: string[]
  favorite: boolean
  bookless: boolean
}

export const EMPTY_PIECE_FILTERS: PieceFilterState = {
  keyId: [],
  instrumentId: [],
  sheetTypeId: [],
  userTagId: [],
  practiceStatus: [],
  favorite: false,
  bookless: false,
}

export function activePieceFilterCount(f: PieceFilterState): number {
  return (
    f.keyId.length +
    f.instrumentId.length +
    f.sheetTypeId.length +
    f.userTagId.length +
    f.practiceStatus.length +
    (f.favorite ? 1 : 0) +
    (f.bookless ? 1 : 0)
  )
}
