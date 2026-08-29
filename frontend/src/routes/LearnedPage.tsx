import { PieceBrowseView } from '../components/PieceBrowseView'

export function LearnedPage() {
  return (
    <PieceBrowseView
      filters={{ practiceStatus: 'Learned' }}
      searchPlaceholder="Search pieces you've learned…"
      emptyMessage="No pieces marked Learned yet."
      noMatchMessage="No matching pieces in Learned."
      backLabel="Learned"
    />
  )
}
