import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { IconSearch, IconLayoutGridFilled, IconLayoutListFilled } from '@tabler/icons-react'
import { searchPieces } from '../api/pieces'
import { ApiError } from '../api/client'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { PieceGridCard } from '../components/PieceGridCard'
import { PieceListCard } from '../components/PieceListCard'

type ViewMode = 'grid' | 'list'

export function LibraryPage() {
  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const debouncedQuery = useDebouncedValue(query)

  const {
    data: pieces,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['pieces', { query: debouncedQuery }],
    queryFn: () => searchPieces({ query: debouncedQuery || undefined }),
  })

  return (
    <div className="flex flex-1 flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-paper p-4">
        <div className="relative flex-1 max-w-md">
          <IconSearch
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft"
          />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your library…"
            className="w-full rounded-md border border-border bg-paper-raised py-2 pr-3 pl-9 text-sm text-ink"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-md border border-border p-0.5">
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            aria-label="Grid view"
            aria-pressed={viewMode === 'grid'}
            className={`flex size-8 items-center justify-center rounded ${
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
            className={`flex size-8 items-center justify-center rounded ${
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
            {error instanceof ApiError ? error.message : 'Could not load your library.'}
          </p>
        )}

        {pieces && pieces.length === 0 && (
          <p className="p-8 text-center text-ink-soft">
            {query
              ? 'No pieces match your search.'
              : 'Your library is empty — upload a piece to get started.'}
          </p>
        )}

        {pieces && pieces.length > 0 && viewMode === 'grid' && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
            {pieces.map((piece) => (
              <PieceGridCard key={piece.id} piece={piece} />
            ))}
          </div>
        )}

        {pieces && pieces.length > 0 && viewMode === 'list' && (
          <div className="flex flex-col gap-3">
            {pieces.map((piece) => (
              <PieceListCard key={piece.id} piece={piece} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
