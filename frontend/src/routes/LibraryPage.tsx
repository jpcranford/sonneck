import { PieceBrowseView } from '../components/PieceBrowseView'

export function LibraryPage() {
  return (
    <PieceBrowseView
      empty={{
        title: 'Your library is empty',
        detail: 'Drop a PDF anywhere on this page, or choose Upload in the sidebar.',
      }}
      gridCardSize="compact"
      backLabel="Library"
    />
  )
}
