import { PieceBrowseView } from '../components/PieceBrowseView'

export function LibraryPage() {
  return (
    <PieceBrowseView
      emptyMessage="Your library is empty — upload a piece to get started."
      gridCardSize="compact"
      backLabel="Library"
    />
  )
}
