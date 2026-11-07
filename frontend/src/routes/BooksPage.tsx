import { useEffect, useRef, useState } from 'react'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { IconX } from '@tabler/icons-react'
import { countBooks, getBookFacets, listBooks } from '../api/books'
import { ApiError } from '../api/client'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { BookGridCard } from '../components/BookGridCard'
import { BookListCard } from '../components/BookListCard'
import { NewBookModal } from '../components/NewBookModal'
import { BookFilterDrawer } from '../components/BookFilterDrawer'
import { type SortDirection, type SortFieldOption } from '../components/SortControl'
import { LibraryToolbar } from '../components/LibraryToolbar'
import { MatchCount } from '../components/MatchCount'
import {
  EMPTY_BOOK_FILTERS,
  activeBookFilterCount,
  bookFilterApiParams,
  setDimensionState,
  type BookFilterState,
  type TriState,
} from '../lib/bookFilterState'
import { hasPermission, useAuth } from '../lib/AuthContext'
import { WIDE_CONTENT_MAX_W } from '../lib/layout'
import { usePageTitle } from '../lib/usePageTitle'
import { useViewPreference } from '../lib/useViewPreference'
import { EmptyState } from '../components/EmptyState'
import { noMatchMessage } from '../lib/emptyMessages'
import { filterChipClass, filterChipRemoveClass } from '../lib/filterChips'

type BookSortField = 'dateAdded' | 'title' | 'composer' | 'yearPublished'

// Books per request (the server's own default).
const PAGE_SIZE = 50

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
// BooksLibrarySample.tsx's mockup (Option B Filter Drawer, same system as
// PieceBrowseView.tsx) — Filters/Sort/drawer added on top of the
// pre-existing search+grid/list toolbar.
export function BooksPage() {
  usePageTitle('Books')
  const canEdit = hasPermission(useAuth(), 'edit')
  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useViewPreference('books')
  const [newBookOpen, setNewBookOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerFilters, setDrawerFilters] = useState<BookFilterState>(EMPTY_BOOK_FILTERS)
  const [sortField, setSortField] = useState<BookSortField>('dateAdded')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const debouncedQuery = useDebouncedValue(query)
  const debouncedDrawerFilters = useDebouncedValue(drawerFilters)

  // Live/faceted (see internal/handlers/facets.go's own doc comment):
  // each option's count reflects every OTHER active
  // filter and the current search box text, never self-narrowing against
  // its own selection. Keyed/fetched with the same debounced query+
  // filters the books list itself uses, same reasoning as
  // PieceBrowseView.tsx's own facets query.
  const { data: facets } = useQuery({
    queryKey: ['bookFacets', { query: debouncedQuery, ...debouncedDrawerFilters }],
    queryFn: () =>
      getBookFacets({
        query: debouncedQuery || undefined,
        ...bookFilterApiParams(debouncedDrawerFilters),
      }),
  })

  // A page at a time, the next one fetched as the end of the list nears
  // (the Piece library's pattern, PieceBrowseView.tsx).
  const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: [
        'books',
        { query: debouncedQuery, ...debouncedDrawerFilters, sortField, sortDirection },
      ],
      queryFn: ({ pageParam }) =>
        listBooks({
          query: debouncedQuery || undefined,
          ...bookFilterApiParams(debouncedDrawerFilters),
          sort: sortField,
          dir: sortDirection,
          limit: PAGE_SIZE,
          offset: pageParam,
        }),
      initialPageParam: 0,
      // A bare array, no total: a short page is the last one.
      getNextPageParam: (lastPage, allPages) =>
        lastPage.length === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined,
    })
  const books = data?.pages.flat()

  // Loads the next page once the marker under the list comes within 400px
  // of the screen, so it's usually there before the end is reached.
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

  const activeCount = activeBookFilterCount(drawerFilters)

  function clearDrawerFilter(field: keyof BookFilterState, value: string) {
    setDrawerFilters((f) => ({ ...f, [field]: setDimensionState(f[field], value, 'neutral') }))
  }

  const pillEntries: {
    field: keyof BookFilterState
    value: string
    label: string
    state: TriState
  }[] = [
    ...Object.entries(drawerFilters.sheetTypeId).map(([id, state]) => ({
      field: 'sheetTypeId' as const,
      value: id,
      label: facets?.sheetTypes.find((v) => v.id === Number(id))?.name ?? id,
      state,
    })),
    ...Object.entries(drawerFilters.instrumentId).map(([id, state]) => ({
      field: 'instrumentId' as const,
      value: id,
      label: facets?.instruments.find((v) => v.id === Number(id))?.name ?? id,
      state,
    })),
  ]

  // The filter row shows while any filter or a search is active, opening
  // with how many books match (every match: GET /api/books/count runs the
  // list's own query). Under 'books', so a save that refreshes the list
  // refreshes the count; the last number stays up while a new one loads.
  const showFilterRow = pillEntries.length > 0 || debouncedQuery.trim() !== ''
  const { data: matchCount } = useQuery({
    queryKey: ['books', 'count', { query: debouncedQuery, ...debouncedDrawerFilters }],
    queryFn: () =>
      countBooks({
        query: debouncedQuery || undefined,
        ...bookFilterApiParams(debouncedDrawerFilters),
      }),
    enabled: showFilterRow,
    placeholderData: keepPreviousData,
  })

  return (
    <div className="flex flex-1 flex-col">
      <LibraryToolbar
        shortcutTitle="Books"
        query={query}
        onQueryChange={setQuery}
        searchPlaceholder="Search your books…"
        activeFilterCount={activeCount}
        onOpenFilters={() => setDrawerOpen(true)}
        sortFields={SORT_FIELDS}
        sortField={sortField}
        sortDirection={sortDirection}
        onSortFieldChange={setSortField}
        onSortDirectionToggle={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
        sortDirectionLabel={DIRECTION_LABEL[sortField][sortDirection]}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        newButton={canEdit ? { label: 'New Book', onClick: () => setNewBookOpen(true) } : undefined}
      >
        {showFilterRow && (
          <div className="flex flex-wrap items-center gap-1.5">
            {matchCount !== undefined && (
              <MatchCount count={matchCount} singular="book" plural="books" />
            )}
            {pillEntries.map((entry) => {
              const excluded = entry.state === 'exclude'
              return (
                <span
                  key={entry.field + entry.value}
                  className={`flex items-center gap-1.5 rounded-full border py-1 pr-1.5 pl-3 text-xs font-medium ${filterChipClass('catalog', excluded)}`}
                >
                  {excluded ? `Not ${entry.label}` : entry.label}
                  <button
                    type="button"
                    onClick={() => clearDrawerFilter(entry.field, entry.value)}
                    aria-label={`Remove ${excluded ? 'not ' : ''}${entry.label} filter`}
                    className={`flex size-4 cursor-pointer items-center justify-center rounded-full opacity-75 hover:opacity-100 ${filterChipRemoveClass('catalog', excluded)}`}
                  >
                    <IconX size={11} />
                  </button>
                </span>
              )
            })}
            {pillEntries.length > 0 && (
              <button
                type="button"
                onClick={() => setDrawerFilters(EMPTY_BOOK_FILTERS)}
                className="cursor-pointer text-xs text-ink-soft underline decoration-dotted underline-offset-2 hover:text-ink"
              >
                Clear all
              </button>
            )}
          </div>
        )}
      </LibraryToolbar>

      <div className={`${WIDE_CONTENT_MAX_W} flex-1 p-4`}>
        {isLoading && <p className="p-8 text-center text-ink-soft">Loading…</p>}

        {isError && (
          <p className="p-8 text-center text-ink-soft">
            {error instanceof ApiError ? error.message : 'Could not load your books.'}
          </p>
        )}

        {books && books.length === 0 && (debouncedQuery || activeCount > 0) && (
          <EmptyState {...noMatchMessage('books', debouncedQuery, activeCount > 0)} />
        )}

        {books && books.length === 0 && !debouncedQuery && activeCount === 0 && (
          <EmptyState
            title="Your shelf is empty"
            detail="Upload a book, or use New Book to add one without a file."
          />
        )}

        {books && books.length > 0 && viewMode === 'grid' && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-4 gap-y-6">
            {books.map((book) => (
              <BookGridCard key={book.id} book={book} />
            ))}
          </div>
        )}

        {books && books.length > 0 && viewMode === 'list' && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(576px,100%),768px))] justify-center gap-x-6">
            {/* Capped like the Piece library's list (PieceBrowseView.tsx):
                columns 576–768px, a second once there's room, centered. */}
            {books.map((book) => (
              <div key={book.id} className="border-b border-border last:border-b-0">
                <BookListCard book={book} />
              </div>
            ))}
          </div>
        )}

        {books && books.length > 0 && (
          <div ref={sentinelRef} className="p-4 text-center text-sm text-ink-soft">
            {isFetchingNextPage && 'Loading more…'}
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
