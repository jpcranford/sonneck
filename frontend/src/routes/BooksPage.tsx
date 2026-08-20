import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { IconLayoutGridFilled, IconLayoutListFilled, IconPlus, IconSearch } from '@tabler/icons-react'
import { listBooks } from '../api/books'
import { ApiError } from '../api/client'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { BookGridCard } from '../components/BookGridCard'
import { BookListCard } from '../components/BookListCard'
import { NewBookModal } from '../components/NewBookModal'

type ViewMode = 'grid' | 'list'

// Books library view (design doc §3's Book data model gets its own
// browsing surface, separate from the piece-level Library view) — same
// shell/search/grid-list-toggle chrome as LibraryPage.tsx, on purpose
// (design review, 2026-08-18: "recognizably a library view"), with a
// deliberately different card design in the content area itself. See the
// "Books Library — Design Options" artifact for the full design
// rationale — this combines Option B (cover grid) and Option C (catalog
// list) behind the toggle.
export function BooksPage() {
  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [newBookOpen, setNewBookOpen] = useState(false)
  const debouncedQuery = useDebouncedValue(query)

  const {
    data: books,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['books', { query: debouncedQuery }],
    queryFn: () => listBooks({ query: debouncedQuery || undefined }),
  })

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
            placeholder="Search your books…"
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
        {/* Bordered/neutral treatment, matching the grid/list toggle right
            next to it (border-border, bg-paper-raised, text-ink) — was
            solid bg-accent, a deliberate earlier choice (design-system
            memory: settled on after a round-trip through bg-ink and a
            5-option comparison gallery) revisited and replaced here per
            direct instruction, design-review/books-new-book-button-bordered.png. */}
        <button
          type="button"
          onClick={() => setNewBookOpen(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-paper-raised px-3 py-2 font-display text-sm text-ink hover:border-accent"
        >
          <IconPlus size={16} />
          New Book
        </button>
      </div>

      <div className="flex-1 p-4">
        {isLoading && <p className="p-8 text-center text-ink-soft">Loading…</p>}

        {isError && (
          <p className="p-8 text-center text-ink-soft">
            {error instanceof ApiError ? error.message : 'Could not load your books.'}
          </p>
        )}

        {books && books.length === 0 && (
          <p className="p-8 text-center text-ink-soft">
            {query
              ? 'No books match your search.'
              : 'No books yet — books are created via the import wizard or the New Book button above.'}
          </p>
        )}

        {books && books.length > 0 && viewMode === 'grid' && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-4 gap-y-6">
            {books.map((book) => (
              <BookGridCard key={book.id} book={book} />
            ))}
          </div>
        )}

        {books && books.length > 0 && viewMode === 'list' && (
          <div className="flex flex-col">
            {books.map((book) => (
              <BookListCard key={book.id} book={book} />
            ))}
          </div>
        )}
      </div>

      <NewBookModal open={newBookOpen} onClose={() => setNewBookOpen(false)} />
    </div>
  )
}
