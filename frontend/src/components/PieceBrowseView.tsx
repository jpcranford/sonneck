import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { IconX } from '@tabler/icons-react'
import { getPieceFacets, searchPieces, type SearchPiecesParams } from '../api/pieces'
import { ApiError } from '../api/client'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { PieceGridCard } from './PieceGridCard'
import { PieceListCard } from './PieceListCard'
import { type SortDirection, type SortFieldOption } from './SortControl'
import { LibraryToolbar } from './LibraryToolbar'
import { PieceFilterDrawer } from './PieceFilterDrawer'
import { EMPTY_PIECE_FILTERS, activePieceFilterCount, type PieceFilterState } from '../lib/pieceFilterState'
import { WIDE_CONTENT_MAX_W } from '../lib/layout'
import { usePageTitle } from '../lib/usePageTitle'

// Matches the backend's own default (internal/handlers/search.go) — passed
// explicitly here rather than relying on that default, since this is also
// the page size `getNextPageParam` below uses to detect the last page.
const PAGE_SIZE = 50

type ViewMode = 'grid' | 'list'
type SortField = 'dateAdded' | 'title' | 'composer' | 'yearWritten'

const SORT_FIELDS: SortFieldOption<SortField>[] = [
  { value: 'dateAdded', label: 'Date Added' },
  { value: 'title', label: 'Title' },
  { value: 'composer', label: 'Composer' },
  { value: 'yearWritten', label: 'Year Written' },
]

// What each direction actually means depends on the field — "ascending" on
// a title is A→Z, but on Date Added it's oldest-first. Same convention as
// PieceLibrarySample.tsx's own DIRECTION_LABEL and BooksPage.tsx's own
// yearWritten wording ("Earliest/Latest first" rather than "Oldest/Newest
// first" — that pair is reserved for Date Added, which is about when the
// piece was added to the library, not when it was composed).
const DIRECTION_LABEL: Record<SortField, Record<SortDirection, string>> = {
  dateAdded: { asc: 'Oldest first', desc: 'Newest first' },
  title: { asc: 'A to Z', desc: 'Z to A' },
  composer: { asc: 'A to Z', desc: 'Z to A' },
  yearWritten: { asc: 'Earliest first', desc: 'Latest first' },
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

// Mobile-first: the bare (unprefixed) value applies below sm:, the sm:
// value overrides it at 640px and up (project_responsive_device_plan,
// Phase 3) — the plain
// 200px/176px minimums only ever fit 1 column at iPhone-13-mini width
// (375px, minus this component's own p-4 padding and the gap between
// cards), so phone-width screens got a single, oversized-looking card
// where a real Library naturally has more than one thing to browse. 150px
// was tuned empirically (live Playwright screenshot at 375px) to comfortably
// fit 2 columns without the cards feeling cramped; left alone at sm: and up,
// where the plain default already works well.
const GRID_COLS_CLASS: Record<'default' | 'compact', string> = {
  default: 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]',
  compact: 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(176px,1fr))]',
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
  // backLabel already carries this view's own display name ("Library",
  // "Favorites", "Want to Learn", "Currently Practicing", "Learned") for
  // its "back to X" purpose elsewhere — reused as-is for the tab title
  // rather than adding a second, redundant prop every call site would
  // need to keep in sync with it.
  usePageTitle(backLabel)
  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [sortField, setSortField] = useState<SortField>('dateAdded')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  // Seeded from the URL on first render only (a lazy useState initializer
  // — never re-read after mount) — Piece Details' user-tag/practice-status
  // pills link here this way (e.g. `/?userTagId=5`, `/?practiceStatus=
  // Learning`), so a click on one arrives with that filter already
  // applied, same as if the user had opened the drawer and checked the
  // box themselves. Every other filter field starts empty regardless —
  // this is specifically for "arrived via a pill link," not a general
  // bookmarkable-filter-state feature.
  const [drawerFilters, setDrawerFilters] = useState<PieceFilterState>(() => {
    const userTagId = searchParams.get('userTagId')
    const practiceStatus = searchParams.get('practiceStatus')
    return {
      ...EMPTY_PIECE_FILTERS,
      userTagId: userTagId ? [Number(userTagId)] : [],
      practiceStatus: practiceStatus ? [practiceStatus] : [],
    }
  })
  // Clears the seed params right after the initial read above, so the URL
  // doesn't keep showing `?userTagId=5` once the filter's been applied —
  // matches this app's general "don't leave stale-looking URL/UI state
  // around" polish level. Deliberately an empty dependency array: this
  // must run only once, using whatever was in the URL at mount time, not
  // re-fire in response to its own setSearchParams call below.
  useEffect(() => {
    if (searchParams.has('userTagId') || searchParams.has('practiceStatus')) {
      setSearchParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const debouncedQuery = useDebouncedValue(query)
  // Toggling several drawer checkboxes in quick succession would otherwise
  // fire one request per click (design doc §11's debounce reasoning,
  // applied here the same way the search box already debounces its own
  // query) — this is a plain object, but useDebouncedValue's effect resets
  // on every new object identity regardless of shape, which is exactly the
  // "settle after N ms of no further changes" behavior wanted here.
  const debouncedDrawerFilters = useDebouncedValue(drawerFilters)

  // Facets are live/faceted (changed 2026-08-31 — see internal/handlers/
  // facets.go's own doc comment for the full design): each option's count
  // reflects every OTHER active filter and the current search box text,
  // never self-narrowing against its own selection. Keyed/fetched with the
  // exact same debounced query+filters+page-fixed-filters the pieces list
  // itself uses (queryFn below spreads `filters` last, same "a page's own
  // fixed filter always wins" rule as the pieces query), so a facet count
  // only ever reflects filters actually reachable from this view. Fetching
  // unconditionally on mount (not gated on drawerOpen) keeps the Filters
  // button's own active-count badge and the drawer's first paint both
  // correct without a loading flash — this part is unchanged from before.
  const { data: facets } = useQuery({
    queryKey: ['pieceFacets', { query: debouncedQuery, ...filters, ...debouncedDrawerFilters }],
    queryFn: () =>
      getPieceFacets({
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
        ...filters,
      }),
  })

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
      <LibraryToolbar
        query={query}
        onQueryChange={setQuery}
        searchPlaceholder={searchPlaceholder}
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
        rightColumnGridColsClassName="sm:grid-cols-[auto_1fr_215px] 2xl:grid-cols-[auto_1fr_259px]"
      >
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
      </LibraryToolbar>

      <div className={`${WIDE_CONTENT_MAX_W} flex-1 p-4`}>
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
              <PieceGridCard
                key={piece.id}
                piece={piece}
                backLabel={backLabel}
                siblingPieces={pieces}
              />
            ))}
          </div>
        )}

        {pieces && pieces.length > 0 && viewMode === 'list' && (
          // Capped-width, multi-column-when-there's-room, centered-when-
          // there-isn't (project_responsive_device_plan, Phase 3, direct
          // request) — replaces the old flex-col full-width-row stack,
          // which stretched a single row edge-to-edge on an ultrawide
          // monitor. 768px cap matches max-w-3xl (revised down from an
          // initial 896px/max-w-4xl, still a ballpark not a firm number —
          // reuses an existing Tailwind scale value rather than an
          // arbitrary one-off).
          //
          // minmax(min(576px,100%), 768px), not minmax(0, 768px): a plain
          // 0 floor meant a column had to shrink all the way down to a
          // single ~1552px-wide container before a second one would even
          // appear — direct follow-up asked for the 2-up shift to kick in
          // much earlier, around 550-800px. 576px (matches max-w-xl) is
          // the real per-column minimum auto-fit now sizes against, so 2
          // columns appear once the container's roughly 2×576px+gap or
          // wider; the `min(576px,100%)` wrapper (not a bare 576px) is what
          // keeps a *single* column safely shrinking to fit a narrow
          // (phone-width) container instead of overflowing it, since 100%
          // there resolves smaller than 576px and wins. justify-center
          // turns any leftover container width into centering margin
          // rather than leaving it flush to one side.
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(576px,100%),768px))] justify-center gap-3">
            {pieces.map((piece) => (
              <PieceListCard
                key={piece.id}
                piece={piece}
                backLabel={backLabel}
                siblingPieces={pieces}
              />
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
