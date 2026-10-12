import { PieceBrowseView } from '../components/PieceBrowseView'

export function FavoritesPage() {
  return (
    <PieceBrowseView
      filters={{ favorite: true }}
      searchPlaceholder="Search your favorites…"
      empty={{
        title: 'Nothing favorited',
        detail: 'Use the heart on a piece, or Add to Favorites in its menu.',
      }}
      noMatchNoun="favorites"
      backLabel="Favorites"
    />
  )
}
