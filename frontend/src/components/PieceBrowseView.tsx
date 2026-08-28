import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  IconAdjustmentsHorizontal,
  IconSearch,
  IconLayoutGridFilled,
  IconLayoutListFilled,
  IconX,
} from '@tabler/icons-react'
import { getPieceFacets, searchPieces, type SearchPiecesParams } from '../api/pieces'
import { ApiError } from '../api/client'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { PieceGridCard } from './PieceGridCard'
import { PieceListCard } from './PieceListCard'
import { SortControl, type SortDirection, type SortFieldOption } from './SortControl'
import { PieceFilterDrawer } from './PieceFilterDrawer'
import { EMPTY_PIECE_FILTERS, activePieceFilterCount, type PieceFilterState } from '../lib/pieceFilterState'

// Matches the backend's own default (internal/handlers/search.go) — passed
// explicitly here rather than relying on that default, since this is also
// the page size `getNextPageParam` below uses to detect the last page.
const PAGE_SIZE = 50

type ViewMode = 'grid' | 'list'
type SortField = 'dateAdded' | 'title' | 'composer'

const SORT_FIELDS: SortFieldOption<SortField>[] = [
  { value: 'dateAdded', label: 'Date Added' },
  { value: 'title', label: 'Title' },
  { value: 'composer', label: 'Composer' },
]

// What each direction actually means depends on the field — "ascending" on
// a title is A→Z, but on Date Added it's oldest-first. Same convention as
// PieceLibrarySample.tsx's own DIRECTION_LABEL.
const DIRECTION_LABEL: Record<SortField, Record<SortDirection, string>> = {
  dateAdded: { asc: 'Oldest first', desc: 'Newest first' },
  title: { asc: 'A to Z', desc: 'Z to A' },
  composer: { asc: 'A to Z', desc: 'Z to A' },
}

interface PieceBrowseViewProps {
  /** The fixed filter for this view (e.g. `{ favorite: true }`) — combined
   * with the live search box query on every request. Omit for the
   * unfiltered library. Also used to hide the corresponding Filter Drawer
   * row (see PieceFilterDrawer's hideFavorite/hidePracticeStatus props) —
   * a page that always sends favorite=true has nothing useful for that
   * checkbox to add. */
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
// three hand-synced copies of this exact structure. Real build of
// PieceLibrarySample.tsx's mockup (Option B Filter Drawer, approved
// 2026-08-27) — Filters/Sort/drawer added on top of the pre-existing
// search+grid/list toolbar.
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
  const [sortField, setSortField] = useState<SortField>('dateAdded')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerFilters, setDrawerFilters] = useState<PieceFilterState>(EMPTY_PIECE_FILTERS)
  const debouncedQuery = useDebouncedValue(query)
  // Toggling several drawer checkboxes in quick succession would otherwise
  // fire one request per click (design doc §11's debounce reasoning,
  // applied here the same way the search box already debounces its own
  // query) — this is a plain object, but useDebouncedValue's effect resets
  // on every new object identity regardless of shape, which is exactly the
  // "settle after N ms of no further changes" behavior wanted here.
  const debouncedDrawerFilters = useDebouncedValue(drawerFilters)

  // Facets are static (CLAUDE.md-documented design decision) — fetched
  // once and cached, not re-narrowed by the search box or other active
  // filters. Fetching unconditionally on mount rather than gating on
  // drawerOpen keeps the Filters button's own active-count badge and the
  // drawer's first paint both correct without a loading flash.
  const { data: facets } = useQuery({ queryKey: ['pieceFacets'], queryFn: getPieceFacets })

  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['pieces', { query: debouncedQuery, ...filters, ...debouncedDrawerFilters, sortField, sortDirection }],
    queryFn: ({ pageParam }) =>
      searchPieces({
        query: debouncedQuery || undefined,
        keyId: debouncedDrawerFilters.keyId.length ? debouncedDrawerFilters.keyId : undefined,
        instrumentId: debouncedDrawerFilters.instrumentId.length ? debouncedDrawerFilters.instrumentId : undefined,
        sheetTypeId: debouncedDrawerFilters.sheetTypeId.length ? debouncedDrawerFilters.sheetTypeId : undefined,
        userTagId: debouncedDrawerFilters.userTagId.length ? debouncedDrawerFilters.userTagId : undefined,
        practiceStatus: debouncedDrawerFilters.practiceStatus.length
          ? debouncedDrawerFilters.practiceStatus.join(',')
          : undefined,
        favorite: debouncedDrawerFilters.favorite || undefined,
        bookless: debouncedDrawerFilters.bookless || undefined,
        hasImslpNumber: debouncedDrawerFilters.hasImslpNumber || undefined,
        sort: sortField,
        dir: sortDirection,
        // Spread last: a page's own fixed filter (e.g. Favorites'
        // favorite:true, Practicing's practiceStatus) always wins over
        // whatever the drawer independently has set for that same field.
        ...filters,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
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

  const activeCount = activePieceFilterCount(drawerFilters)

  function clearDrawerFilter(field: keyof PieceFilterState, value?: number | string) {
    if (field === 'favorite' || field === 'bookless' || field === 'hasImslpNumber') {
      setDrawerFilters((f) => ({ ...f, [field]: false }))
      return
    }
    setDrawerFilters((f) => ({ ...f, [field]: (f[field] as (number | string)[]).filter((v) => v !== value) }))
  }

  const pillEntries: { field: keyof PieceFilterState; value?: number | string; label: string }[] = [
    ...(drawerFilters.favorite ? [{ field: 'favorite' as const, label: 'Favorites' }] : []),
    ...(drawerFilters.bookless ? [{ field: 'bookless' as const, label: 'Bookless pieces' }] : []),
    ...(drawerFilters.hasImslpNumber ? [{ field: 'hasImslpNumber' as const, label: 'Has IMSLP number' }] : []),
    ...drawerFilters.keyId.map((id) => ({
      field: 'keyId' as const,
      value: id,
      label: facets?.keys.find((k) => k.id === id)?.name ?? String(id),
    })),
    ...drawerFilters.instrumentId.map((id) => ({
      field: 'instrumentId' as const,
      value: id,
      label: facets?.instruments.find((v) => v.id === id)?.name ?? String(id),
    })),
    ...drawerFilters.sheetTypeId.map((id) => ({
      field: 'sheetTypeId' as const,
      value: id,
      label: facets?.sheetTypes.find((v) => v.id === id)?.name ?? String(id),
    })),
    ...drawerFilters.userTagId.map((id) => ({
      field: 'userTagId' as const,
      value: id,
      label: facets?.userTags.find((v) => v.id === id)?.name ?? String(id),
    })),
    ...drawerFilters.practiceStatus.map((status) => ({ field: 'practiceStatus' as const, value: status, label: status })),
  ]

  return (
    <div className="flex flex-1 flex-col">
      {/* z-20, not z-10: PieceGridCard's practice-status badge is also
          z-10 (absolute, no positioned ancestor with its own z-index in
          between, so it ties in the same root stacking context) — the tie
          breaks on DOM order, and the badge sits later in the DOM than
          this toolbar, so it was painting on top of the toolbar wherever
          a scrolled-up card's badge happened to overlap it. */}
      <div className="sticky top-0 z-20 flex flex-col gap-3 border-b border-border bg-paper p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[180px] max-w-md flex-1">
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

          <div className="ml-auto flex shrink-0 items-center gap-1 rounded-md border border-border p-0.5">
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

        {pillEntries.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {pillEntries.map((entry) => (
              <span
                key={entry.field + String(entry.value ?? '')}
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
              onClick={() => setDrawerFilters(EMPTY_PIECE_FILTERS)}
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
            {error instanceof ApiError ? error.message : 'Could not load these pieces.'}
          </p>
        )}

        {pieces && pieces.length === 0 && (
          <p className="p-8 text-center text-ink-soft">
            {query || activeCount > 0 ? noMatchMessage : emptyMessage}
          </p>
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

      <PieceFilterDrawer
        open={drawerOpen}
        facets={facets}
        filters={drawerFilters}
        onChange={setDrawerFilters}
        onClose={() => setDrawerOpen(false)}
        onClear={() => setDrawerFilters(EMPTY_PIECE_FILTERS)}
        hideFavorite={filters?.favorite !== undefined}
        hideBookless={filters?.bookless !== undefined}
        hideHasImslpNumber={filters?.hasImslpNumber !== undefined}
        hidePracticeStatus={filters?.practiceStatus !== undefined}
      />
    </div>
  )
}
