import { PieceBrowseView } from '../components/PieceBrowseView'

// "Currently Practicing" (design doc §13's sidebar nav item) — pieces
// with practiceStatus Learning OR Stalled specifically (not Want to
// Learn/Learned/Dropped): these two are the ones actually mid-progress
// right now, unlike "queued up" or "finished/abandoned" statuses. The
// comma joins into one practiceStatus query param — the backend's
// handleSearchPieces OR-matches a comma-separated list (see
// internal/handlers/search.go).
const PRACTICING_STATUSES = 'Learning,Stalled'

export function PracticingPage() {
  return (
    <PieceBrowseView
      filters={{ practiceStatus: PRACTICING_STATUSES }}
      searchPlaceholder="Search pieces you're practicing…"
      emptyMessage="No pieces marked Learning or Stalled yet."
      noMatchMessage="No matching pieces in Currently Practicing."
      backLabel="Currently Practicing"
    />
  )
}
