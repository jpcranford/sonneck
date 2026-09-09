import { PieceBrowseView } from '../components/PieceBrowseView'

// "Currently Practicing" (design doc §13's sidebar nav item) — pieces with
// practiceStatus Learning OR Stalled specifically (not Want to Learn/
// Learned/Dropped): these two are the ones actually mid-progress right
// now, unlike "queued up" or "finished/abandoned" statuses. Filters by
// practiceStatusSlot: 'practicing' (migration 00026) rather than by name —
// both Learning and Stalled carry that same sidebar_slot server-side, so
// this still OR-matches both with no comma-joined list needed, and
// renaming either status in User Settings doesn't stop this view from
// finding its pieces (see internal/handlers/search.go's own
// practiceStatusSlotClause).

export function PracticingPage() {
  return (
    <PieceBrowseView
      filters={{ practiceStatusSlot: 'practicing' }}
      searchPlaceholder="Search pieces you're practicing…"
      emptyMessage="No pieces marked Learning or Stalled yet."
      noMatchMessage="No matching pieces in Currently Practicing."
      backLabel="Currently Practicing"
    />
  )
}
