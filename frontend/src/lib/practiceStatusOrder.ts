import type { PracticeStatusItem } from '../api/types'

// Practice order, not GET /api/practice-statuses' alphabetical one: the
// way a piece goes — wanting to learn it, learning it, stalled on it,
// learned — then dropped. Keyed by the durable iconKey (migration 00026), so a renamed status
// keeps its place; statuses without one (created later) follow, in the
// order given. Shared by the piece menu's status strip and the Edit Piece
// modal's status dropdown.
const ICON_KEY_ORDER = ['want_to_learn', 'learning', 'stalled', 'learned', 'dropped']

function rank(status: PracticeStatusItem): number {
  const i = status.iconKey ? ICON_KEY_ORDER.indexOf(status.iconKey) : -1
  return i === -1 ? ICON_KEY_ORDER.length : i
}

export function sortPracticeStatuses(statuses: PracticeStatusItem[]): PracticeStatusItem[] {
  return [...statuses].sort((a, b) => rank(a) - rank(b))
}
