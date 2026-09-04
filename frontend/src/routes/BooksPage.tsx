import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  IconAdjustmentsHorizontal,
  IconLayoutGridFilled,
  IconLayoutListFilled,
  IconPlus,
  IconSearch,
  IconX,
} from '@tabler/icons-react'
import { getBookFacets, listBooks } from '../api/books'
import { ApiError } from '../api/client'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { BookGridCard } from '../components/BookGridCard'
import { BookListCard } from '../components/BookListCard'
import { NewBookModal } from '../components/NewBookModal'
import { BookFilterDrawer } from '../components/BookFilterDrawer'
import { SortControl, type SortDirection, type SortFieldOption } from '../components/SortControl'
import { EMPTY_BOOK_FILTERS, activeBookFilterCount, type BookFilterState } from '../lib/bookFilterState'
import { usePageTitle } from '../lib/usePageTitle'

type ViewMode = 'grid' | 'list'
type BookSortField = 'dateAdded' | 'title' | 'composer' | 'yearPublished'

const SORT_FIELDS: SortFieldOption<BookSortField>[] = [
  { value: 'dateAdded', label: 'Date Added' },
  { value: 'title', label: 'Title' },
  { value: 'composer', label: 'Composer' },
  { value: 'yearPublished', label: 'Year Published' },
]

const DIRECTION_LABEL: Record<BookSortField, Record<SortDirection, string>> = {
  dateAdded: { asc: 'Oldest first', desc: 'Newest first' },
  title: { asc: 'A to Z', desc: 'Z to A' },
  composer: { asc: 'A to Z', desc: 'Z to A' },
  yearPublished: { asc: 'Earliest first', desc: 'Latest first' },
}

// Books library view (design doc §3's Book data model gets its own
// browsing surface, separate from the piece-level Library view) — same
// shell/search/grid-list-toggle chrome as LibraryPage.tsx on purpose, so
// it reads as recognizably a library view, with a deliberately different
// card design in the content area itself (combines a cover grid and a
// catalog list behind the view toggle). Real build of
// BooksLibrarySample.tsx's mockup (Option B Filter Drawer, approved
// 2026-08-27, same system as PieceBrowseView.tsx) — Filters/Sort/drawer
// added on top of the pre-existing search+grid/list toolbar.
export function BooksPage() {
  usePageTitle('Books')
  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [newBookOpen, setNewBookOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerFilters, setDrawerFilters] = useState<BookFilterState>(EMPTY_BOOK_FILTERS)
  const [sortField, setSortField] = useState<BookSortField>('dateAdded')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const debouncedQuery = useDebouncedValue(query)
  const debouncedDrawerFilters = useDebouncedValue(drawerFilters)

  // Live/faceted (changed 2026-08-31 — see internal/handlers/facets.go's
  // own doc comment): each option's count reflects every OTHER active
  // filter and the current search box text, never self-narrowing against
  // its own selection. Keyed/fetched with the same debounced query+
  // filters the books list itself uses, same reasoning as
  // PieceBrowseView.tsx's own facets query.
  const { data: facets } = useQuery({
    queryKey: ['bookFacets', { query: debouncedQuery, ...debouncedDrawerFilters }],
    queryFn: () =>
      getBookFacets({
        query: debouncedQuery || undefined,
        sheetTypeId: debouncedDrawerFilters.sheetTypeId.length ? debouncedDrawerFilters.sheetTypeId : undefined,
        instrumentId: debouncedDrawerFilters.instrumentId.length ? debouncedDrawerFilters.instrumentId : undefined,
      }),
  })

  const {
    data: books,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['books', { query: debouncedQuery, ...debouncedDrawerFilters, sortField, sortDirection }],
    queryFn: () =>
      listBooks({
        query: debouncedQuery || undefined,
        sheetTypeId: debouncedDrawerFilters.sheetTypeId.length ? debouncedDrawerFilters.sheetTypeId : undefined,
        instrumentId: debouncedDrawerFilters.instrumentId.length ? debouncedDrawerFilters.instrumentId : undefined,
        sort: sortField,
        dir: sortDirection,
      }),
  })

  const activeCount = activeBookFilterCount(drawerFilters)

  function clearDrawerFilter(field: keyof BookFilterState, value: number) {
    setDrawerFilters((f) => ({ ...f, [field]: f[field].filter((v) => v !== value) }))
  }

  const pillEntries: { field: keyof BookFilterState; value: number; label: string }[] = [
    ...drawerFilters.sheetTypeId.map((id) => ({
      field: 'sheetTypeId' as const,
      value: id,
      label: facets?.sheetTypes.find((v) => v.id === id)?.name ?? String(id),
    })),
    ...drawerFilters.instrumentId.map((id) => ({
      field: 'instrumentId' as const,
      value: id,
      label: facets?.instruments.find((v) => v.id === id)?.name ?? String(id),
    })),
  ]

  return (
    <div className="flex flex-1 flex-col">
      {/* z-20, matching PieceBrowseView.tsx's own toolbar (see its comment)
          — no card badge here happens to carry z-10 today, but keeping the
          two toolbars' z-index consistent avoids re-deriving this the next
          time a Books card badge does. */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-border bg-paper p-4">
        <div className="relative min-w-[180px] max-w-md flex-1">
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

        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 text-sm active:border-accent active:text-accent ${
            activeCount > 0
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-border bg-paper-raised text-ink hover:border-accent hover:text-accent'
          }`}
        >
          <IconAdjustmentsHorizontal size={16} />
          Filters
          {activeCount > 0 && (
            <span className="flex size-4 items-center justify-center rounded-full bg-accent text-[0.65rem] font-semibold text-white">
              {activeCount}
            </span>
          )}
        </button>

        <SortControl
          fields={SORT_FIELDS}
          field={sortField}
          direction={sortDirection}
          onFieldChange={setSortField}
          onDirectionToggle={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
          directionLabel={DIRECTION_LABEL[sortField][sortDirection]}
        />

        {/* Bordered/neutral treatment, matching the grid/list toggle right
            next to it (border-border, bg-paper-raised, text-ink), not a
            solid accent fill. hover/active tint the label+icon accent (not
            just the border) — text-accent on the button carries through to
            IconPlus automatically via currentColor. active: alongside
            hover: so a tap gets the same feedback a mouse hover does.
            ml-auto keeps this and the view toggle pinned to the row's end
            regardless of how many controls wrap onto earlier lines. */}
        <button
          type="button"
          onClick={() => setNewBookOpen(true)}
          className="ml-auto flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-paper-raised px-3 py-2 text-sm text-ink hover:border-accent hover:text-accent active:border-accent active:text-accent"
        >
          <IconPlus size={16} />
          New Book
        </button>

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

        {pillEntries.length > 0 && (
          <div className="flex w-full flex-wrap items-center gap-1.5">
            {pillEntries.map((entry) => (
              <span
                key={entry.field + String(entry.value)}
                className="flex items-center gap-1.5 rounded-full bg-accent-soft py-1 pr-1.5 pl-3 text-xs font-medium text-accent"
              >
                {entry.label}
                <button
                  type="button"
                  onClick={() => clearDrawerFilter(entry.field, entry.value)}
                  aria-label={`Remove ${entry.label} filter`}
                  className="flex size-4 cursor-pointer items-center justify-center rounded-full text-accent opacity-75 hover:opacity-100"
                >
                  <IconX size={11} />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => setDrawerFilters(EMPTY_BOOK_FILTERS)}
              className="cursor-pointer text-xs text-ink-soft underline decoration-dotted underline-offset-2 hover:text-ink"
            >
              Clear all
            </button>
          </div>
        )}
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
            {query || activeCount > 0
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
          <div className="flex flex-col divide-y divide-border">
            {books.map((book) => (
              <BookListCard key={book.id} book={book} />
            ))}
          </div>
        )}
      </div>

      <NewBookModal open={newBookOpen} onClose={() => setNewBookOpen(false)} />

      <BookFilterDrawer
        open={drawerOpen}
        facets={facets}
        filters={drawerFilters}
        onChange={setDrawerFilters}
        onClose={() => setDrawerOpen(false)}
        onClear={() => setDrawerFilters(EMPTY_BOOK_FILTERS)}
      />
    </div>
  )
}
