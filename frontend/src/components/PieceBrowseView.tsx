import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { IconSearch, IconLayoutGridFilled, IconLayoutListFilled } from '@tabler/icons-react'
import { searchPieces, type SearchPiecesParams } from '../api/pieces'
import { ApiError } from '../api/client'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { PieceGridCard } from './PieceGridCard'
import { PieceListCard } from './PieceListCard'

// Matches the backend's own default (internal/handlers/search.go) — passed
// explicitly here rather than relying on that default, since this is also
// the page size `getNextPageParam` below uses to detect the last page.
const PAGE_SIZE = 50

type ViewMode = 'grid' | 'list'

interface PieceBrowseViewProps {
  /** The fixed filter for this view (e.g. `{ favorite: true }`) — combined
   * with the live search box query on every request. Omit for the
   * unfiltered library. */
  filters?: Omit<SearchPiecesParams, 'query'>
  searchPlaceholder?: string
  /** Shown when the view has no results and the search box is empty. */
  emptyMessage: string
  /** Shown when the view has no results but the search box has a query —
   * defaults to the same wording every filtered/unfiltered view already
   * used before this component existed. */
  noMatchMessage?: string
  /** Grid-view card size — 'compact' for the main Library (slightly
   * smaller, filtered views unchanged) vs. the original size everywhere
   * else. A literal class per size rather
   * than an interpolated width: Tailwind's build-time scanner only picks
   * up arbitrary-value classes that appear as literal strings in source,
   * so a runtime-computed `minmax(${n}px,1fr)` wouldn't actually generate
   * the CSS. */
  gridCardSize?: 'default' | 'compact'
  /** This view's own nav label (e.g. "Library", "Favorites") — forwarded
   * to every card so Piece Details' Back control can say "Back to X"
   * once navigated to from here. */
  backLabel: string
}

const GRID_COLS_CLASS: Record<'default' | 'compact', string> = {
  default: 'grid-cols-[repeat(auto-fill,minmax(200px,1fr))]',
  compact: 'grid-cols-[repeat(auto-fill,minmax(176px,1fr))]',
}

// Shared by LibraryPage (no filters — the whole collection), FavoritesPage
// (favorite: true), and PracticingPage (practiceStatus: Learning,Stalled):
// the same search box + grid/list toggle + loading/error/empty states +
// card rendering, previously duplicated only in LibraryPage before the
// other two filtered views existed. One implementation now rather than
// three hand-synced copies of this exact structure.
export function PieceBrowseView({
  filters,
  searchPlaceholder = 'Search your library…',
  emptyMessage,
  noMatchMessage = 'No pieces match your search.',
  gridCardSize = 'default',
  backLabel,
}: PieceBrowseViewProps) {
  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const debouncedQuery = useDebouncedValue(query)

  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['pieces', { query: debouncedQuery, ...filters }],
    queryFn: ({ pageParam }) =>
      searchPieces({ query: debouncedQuery || undefined, ...filters, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    // The backend returns a bare array, no total count — a page shorter
    // than PAGE_SIZE is the only signal that it was the last one.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined,
  })
  const pieces = data?.pages.flat()

  // Fires fetchNextPage once the sentinel below the results scrolls near
  // into view — rootMargin gives it a head start so the next page is
  // already loading before the user hits the literal bottom, not a
  // visible pause once they do. Default root (the browser viewport, not
  // AppShell's own scroll container) still works here: the sentinel's
  // position relative to the viewport changes as AppShell's container
  // scrolls its content past it, same as it would for window-level scroll.
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasNextPage) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isFetchingNextPage) fetchNextPage()
      },
      { rootMargin: '400px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <div className="flex flex-1 flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-paper p-4">
        <div className="relative max-w-md flex-1">
          <IconSearch
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft"
          />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-md border border-border bg-paper-raised py-2 pr-3 pl-9 text-sm text-ink"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-md border border-border p-0.5">
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            aria-label="Grid view"
            aria-pressed={viewMode === 'grid'}
            className={`flex size-8 cursor-pointer items-center justify-center rounded ${
              viewMode === 'grid' ? 'bg-accent-soft text-accent' : 'text-ink-soft'
            }`}
          >
            <IconLayoutGridFilled size={16} />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            aria-label="List view"
            aria-pressed={viewMode === 'list'}
            className={`flex size-8 cursor-pointer items-center justify-center rounded ${
              viewMode === 'list' ? 'bg-accent-soft text-accent' : 'text-ink-soft'
            }`}
          >
            <IconLayoutListFilled size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 p-4">
        {isLoading && <p className="p-8 text-center text-ink-soft">Loading…</p>}

        {isError && (
          <p className="p-8 text-center text-ink-soft">
            {error instanceof ApiError ? error.message : 'Could not load these pieces.'}
          </p>
        )}

        {pieces && pieces.length === 0 && (
          <p className="p-8 text-center text-ink-soft">{query ? noMatchMessage : emptyMessage}</p>
        )}

        {pieces && pieces.length > 0 && viewMode === 'grid' && (
          <div className={`grid gap-4 ${GRID_COLS_CLASS[gridCardSize]}`}>
            {pieces.map((piece) => (
              <PieceGridCard key={piece.id} piece={piece} backLabel={backLabel} />
            ))}
          </div>
        )}

        {pieces && pieces.length > 0 && viewMode === 'list' && (
          <div className="flex flex-col gap-3">
            {pieces.map((piece) => (
              <PieceListCard key={piece.id} piece={piece} backLabel={backLabel} />
            ))}
          </div>
        )}

        {pieces && pieces.length > 0 && (
          <div ref={sentinelRef} className="p-4 text-center text-sm text-ink-soft">
            {isFetchingNextPage && 'Loading more…'}
          </div>
        )}
      </div>
    </div>
  )
}
