import type { QueryClient } from '@tanstack/react-query'

/**
 * After a save that returned the record it saved: puts that response into
 * its cache entry ([type, id]) and refreshes everything else under the same
 * type — the record's derived data ([type, id, 'citation']) and any other
 * records whose shown values may follow from it — without re-downloading
 * the one record the save just handed back. Re-fetching it was one wasted
 * request per save (a save's response is built the same way as a load).
 */
export function refreshAfterSave(
  queryClient: QueryClient,
  type: 'piece' | 'person' | 'book',
  saved: { id: number },
) {
  queryClient.setQueryData([type, saved.id], saved)
  queryClient.invalidateQueries({
    queryKey: [type],
    predicate: (query) => !(query.queryKey.length === 2 && query.queryKey[1] === saved.id),
  })
}
