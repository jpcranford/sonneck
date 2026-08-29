import { PieceBrowseView } from '../components/PieceBrowseView'

export function WantToLearnPage() {
  return (
    <PieceBrowseView
      filters={{ practiceStatus: 'Want to Learn' }}
      searchPlaceholder="Search pieces you want to learn…"
      emptyMessage="No pieces marked Want to Learn yet."
      noMatchMessage="No matching pieces in Want to Learn."
      backLabel="Want to Learn"
    />
  )
}
