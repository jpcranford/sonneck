import { PieceBrowseView } from '../components/PieceBrowseView'

export function LearnedPage() {
  return (
    <PieceBrowseView
      filters={{ practiceStatusSlot: 'learned' }}
      searchPlaceholder="Search pieces you've learned…"
      empty={{ title: 'Your repertoire is empty', detail: 'Pieces you mark Learned collect here.' }}
      backLabel="Learned"
    />
  )
}
