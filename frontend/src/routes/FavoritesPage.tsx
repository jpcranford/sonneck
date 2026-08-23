import { PieceBrowseView } from '../components/PieceBrowseView'

export function FavoritesPage() {
  return (
    <PieceBrowseView
      filters={{ favorite: true }}
      searchPlaceholder="Search your favorites…"
      emptyMessage="You haven't favorited any pieces yet."
      noMatchMessage="No favorites match your search."
      backLabel="Favorites"
    />
  )
}
