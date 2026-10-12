import { PieceBrowseView } from '../components/PieceBrowseView'

export function WantToLearnPage() {
  return (
    <PieceBrowseView
      filters={{ practiceStatusSlot: 'want_to_learn' }}
      searchPlaceholder="Search pieces you want to learn…"
      empty={{
        title: 'Nothing to learn yet',
        detail: 'Pieces you mark Want to Learn will appear here.',
      }}
      backLabel="Want to Learn"
    />
  )
}
