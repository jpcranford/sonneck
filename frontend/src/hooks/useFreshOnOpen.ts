import { useEffect, useRef, useState } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'

/**
 * An edit window always starts from the record as the server has it now,
 * not the copy the opening page holds (which can be a minute old, or older
 * than another device's edit). Each time `open` turns true, the record is
 * refetched — into the same cache entry the page reads, so the page catches
 * up too — and handed to `onFresh` to reset the form. Returns whether that
 * fetch is still running; the window keeps its fields disabled meanwhile
 * (a few milliseconds on a local server) so nothing typed is overwritten.
 * If the fetch fails, the copy already showing stays editable. A response
 * that a later open has superseded is dropped. Edit Piece does the same
 * itself (EditPieceModal's loadFresh), since it also refetches on every
 * previous/next switch.
 */
export function useFreshOnOpen<T>(
  open: boolean,
  queryKey: QueryKey | null,
  queryFn: () => Promise<T>,
  onFresh: (data: T) => void,
): boolean {
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(false)
  const latest = useRef({ queryFn, onFresh })
  useEffect(() => {
    latest.current = { queryFn, onFresh }
  })
  const seq = useRef(0)
  const keyHash = JSON.stringify(queryKey)

  useEffect(() => {
    if (!open || queryKey === null) return
    const mine = ++seq.current
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: the window's fields lock the moment it opens, until the fresh copy lands.
    setLoading(true)
    queryClient
      .fetchQuery({ queryKey, queryFn: () => latest.current.queryFn(), staleTime: 0 })
      .then((data) => {
        if (mine === seq.current) latest.current.onFresh(data)
      })
      .catch(() => {})
      .finally(() => {
        if (mine === seq.current) setLoading(false)
      })
    // Keyed on the key's contents, not the array's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, keyHash, queryClient])

  return open && loading
}
