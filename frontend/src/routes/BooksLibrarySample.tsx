import { useRef, useState, type KeyboardEvent } from 'react'
import { useForm } from 'react-hook-form'
import {
  IconAdjustmentsHorizontal,
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronRight,
  IconClefStaff,
  IconLayoutGridFilled,
  IconLayoutListFilled,
  IconPlus,
  IconSearch,
  IconX,
  IconXFilled,
} from '@tabler/icons-react'
import { Modal } from '../components/Modal'
import { useMockupTitle } from '../lib/useMockupTitle'
import { WIDE_CONTENT_MAX_W } from '../lib/layout'

// ---------------------------------------------------------------------
// DESIGN MOCKUP for the Books Library page. Originally a side-by-side
// comparison of two competing layouts (Option B cover grid vs. Option C
// catalog list) — that decision is long since made and built for real
// (BooksPage.tsx uses BookGridCard/BookListCard, both grid and list kept
// in sync with this mockup by hand since), so this file's job now is the
// same one PieceLibrarySample.tsx serves for the Piece Library: an
// accurate reference for the real grid/list design, plus whatever's being
// designed next on top of it. That's currently the same Filter Drawer
// (Option B, picked 2026-08-27) added to the Piece Library — same system,
// adjusted for Books' own (much lighter) filter facets: Sheet Type and
// Instrument only, no Key/tags/Favorite/Practice Status, since those are
// piece-only fields (design doc §3's Naming/architecture note). Not wired
// to the API; cards aren't real links.
//
// Facet counts are live/faceted (changed 2026-08-31, matching a real
// backend switch — internal/handlers/facets.go), same mockup-parity
// treatment as PieceLibrarySample.tsx's own matchesFiltersExcept.
// ---------------------------------------------------------------------

interface MockBook {
  id: number
  bookTitle: string
  composer: string | null
  publisher: string | null
  yearWritten: string | null
  pieceCount: number
  sheetType: string
  instruments: string[]
  // [width, height] ratio units — omitted defaults to a portrait 2:3
  // "real cover art" shape. A couple of entries below get a landscape
  // ratio instead, standing in for the common real-app case of a book
  // with no custom cover uploaded, where the cover shown is just the
  // book's own rendered first PDF page (almost never 2:3) — see
  // BookGridCard.tsx's own comment on the same aspect-ratio fix this
  // mockup is kept in sync with.
  coverAspect?: [number, number]
}

// Composer is optional on Book (design doc §3) — publisher is the agreed
// fallback display value when it's blank, not a special "inherited"-style
// badge (that convention is for Piece fields falling back to their book;
// this is a book falling back to its own other field). Silent substitution,
// same "blank fields omitted, not shown as empty punctuation" principle as
// formatPieceMeta.ts — and when *neither* is set, the field is just
// omitted rather than showing a placeholder dash.
function effectiveComposer(book: MockBook): string | null {
  return book.composer || book.publisher
}

function metaLine(book: MockBook): string {
  return [effectiveComposer(book), book.yearWritten].filter((part): part is string => !!part).join(' • ')
}

// Deliberately mixed: #2 has no composer but a publisher (exercises the
// fallback), #6 has neither (exercises the fully-empty case), piece counts
// span 4-400, titles span short to long — same "stress the edges, not just
// the happy path" habit as the rest of this app's mockups/fixtures.
const MOCK_BOOKS: MockBook[] = [
  { id: 1, bookTitle: 'Album für die Jugend, Op. 68', composer: 'Robert Schumann', publisher: 'G. Schirmer', yearWritten: '1848', pieceCount: 43, sheetType: 'Solo Piece', instruments: ['Piano'] },
  { id: 2, bookTitle: 'The Real Book — Sixth Edition', composer: null, publisher: 'Hal Leonard', yearWritten: null, pieceCount: 400, sheetType: 'Lead Sheet', instruments: ['Piano', 'Guitar'] },
  { id: 3, bookTitle: '24 Préludes, Op. 28', composer: 'Frédéric Chopin', publisher: 'Breitkopf & Härtel', yearWritten: '1839', pieceCount: 24, coverAspect: [11, 8.5], sheetType: 'Solo Piece', instruments: ['Piano'] },
  { id: 4, bookTitle: 'Sonatas and Partitas for Solo Violin', composer: 'J.S. Bach', publisher: null, yearWritten: '1720', pieceCount: 6, sheetType: 'Solo Piece', instruments: ['Violin'] },
  { id: 5, bookTitle: 'Piano Sonatas, Volume I', composer: 'Ludwig van Beethoven', publisher: 'Henle', yearWritten: '1802', pieceCount: 8, sheetType: 'Solo Piece', instruments: ['Piano'] },
  { id: 6, bookTitle: 'Anthology of American Folk Songs', composer: null, publisher: null, yearWritten: null, pieceCount: 52, sheetType: 'PVG Score', instruments: ['Piano', 'Voice', 'Guitar'] },
  { id: 7, bookTitle: 'Suite bergamasque', composer: 'Claude Debussy', publisher: 'Durand', yearWritten: '1905', pieceCount: 4, coverAspect: [4, 3], sheetType: 'Solo Piece', instruments: ['Piano'] },
  { id: 8, bookTitle: 'The Nutcracker Suite, Op. 71a (Piano Reduction)', composer: 'Pyotr Ilyich Tchaikovsky', publisher: 'G. Schirmer', yearWritten: '1892', pieceCount: 8, sheetType: 'Solo Piece', instruments: ['Piano'] },
]

// A believable spread of book-cover colors — published sheet-music
// collections (fake books, method books, anthologies) often *do* have
// their own printed cover art as the PDF's first page, not a plain music
// page, which is exactly why the piece-count scrim needed testing against
// something other than this mockup's old uniform cream placeholder.
// Deliberately spans light/medium/dark so the white-on-dark-scrim choice
// gets checked against the full brightness range real covers could throw
// at it, not just a favorable middle case.
const COVER_PALETTE: { bg: string; text: string }[] = [
  { bg: '#a8462f', text: '#fbf4ee' }, // terracotta
  { bg: '#1c2b4a', text: '#eef1f6' }, // navy
  { bg: '#e3c2c2', text: '#3a2320' }, // dusty rose (light)
  { bg: '#2f4536', text: '#eef3ea' }, // deep green
  { bg: '#c98a2c', text: '#2b1c08' }, // ochre
  { bg: '#e8ddc7', text: '#4a3f2c' }, // cream/tan (light)
  { bg: '#8a76a3', text: '#f5f1f9' }, // dusty lavender
  { bg: '#5b1f2b', text: '#f4e6e8' }, // burgundy
]

function coverPalette(id: number) {
  return COVER_PALETTE[(id - 1) % COVER_PALETTE.length]
}

// Stands in for "the book's own first page" — there's no book-cover-
// thumbnail concept in the API today (only a per-page render of the
// original PDF). Title + composer lockup on a flat color field, same
// "Diagonal Light" gradient overlay the app icon itself uses (locked
// design system) for a touch of dimension rather than a dead-flat swatch.
function CoverPlaceholder({ book }: { book: MockBook }) {
  const { bg, text } = coverPalette(book.id)
  const composer = effectiveComposer(book)
  const words = book.bookTitle.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if ((current + ' ' + word).trim().length > 14) {
      lines.push(current.trim())
      current = word
    } else {
      current = (current + ' ' + word).trim()
    }
    if (lines.length >= 3) break
  }
  if (current && lines.length < 3) lines.push(current)
  const titleLines = lines.slice(0, 3)
  const titleStartY = 150 - ((titleLines.length - 1) * 20) / 2

  // Height stays fixed at 300 (so the vertical title-centering math above
  // is unaffected) — only width varies per book, via coverAspect (default
  // 2:3, i.e. width 200). centerX follows width so title/composer text
  // stays horizontally centered regardless of aspect ratio.
  const [aspectW, aspectH] = book.coverAspect ?? [2, 3]
  const width = Math.round((300 * aspectW) / aspectH)
  const centerX = width / 2

  return (
    <svg viewBox={`0 0 ${width} 300`} className="h-full w-full" aria-hidden="true">
      <defs>
        <linearGradient id={`diag-${book.id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.2" />
          <stop offset="50%" stopColor="#fff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.14" />
        </linearGradient>
      </defs>
      <rect width={width} height="300" fill={bg} />
      <rect width={width} height="300" fill={`url(#diag-${book.id})`} />
      {titleLines.map((line, i) => (
        <text
          key={i}
          x={centerX}
          y={titleStartY + i * 20}
          textAnchor="middle"
          fontFamily="Georgia, serif"
          fontWeight="700"
          fontSize="15"
          fill={text}
        >
          {line}
        </text>
      ))}
      {composer && (
        <text
          x={centerX}
          y={titleStartY + titleLines.length * 20 + 14}
          textAnchor="middle"
          fontFamily="Georgia, serif"
          fontStyle="italic"
          fontSize="10"
          fill={text}
          opacity="0.85"
        >
          {composer}
        </text>
      )}
    </svg>
  )
}

// ---- Option B: cover grid ----
// Piece count treatment: a dark pill in the bottom-right corner, not a
// full-width gradient scrim across the cover. Went through a scrim-based
// version first (10% black proved too weak against lighter covers like
// dusty rose/cream-tan, bumped to 18%, then to 65% peak trying to hold up
// against real colorful/photographic covers), but at that darkness the
// scrim read as either faint or heavy-handed depending on the cover —
// there was no peak opacity that worked well across all of them. Chosen
// instead from a 5-option comparison (solid pill, rounded-rect, frosted
// glass, opaque brand-ink, and a light counterpoint pill) against the same
// real covers: the pill's own background does the contrast work, so the
// cover art underneath stays untouched regardless of how light, dark, or
// colorful it is.
function BookCoverCard({ book }: { book: MockBook }) {
  const meta = metaLine(book)
  const [aspectW, aspectH] = book.coverAspect ?? [2, 3]
  return (
    // h-full + justify-end: kept in sync with BookGridCard.tsx's own fix
    // (2026-08-27) — the grid container's default align-items: stretch
    // makes every card fill its row's full height, and h-full/justify-end
    // together push the cover+text group to the bottom of that stretched
    // space instead of leaving it top-aligned (which, once covers stopped
    // sharing a uniform aspect ratio, left shorter/landscape covers with a
    // gap underneath and their title floating at an inconsistent height
    // next to taller cards in the same row).
    <div className="flex h-full cursor-pointer flex-col justify-end gap-2">
      {/* aspect-[var] via style, not a Tailwind aspect-[W/H] class — the
          ratio is per-book data here (coverAspect), not a fixed design
          constant, so it can't be a static utility class. */}
      <div
        className="relative overflow-hidden rounded-md border border-border shadow-sm transition-shadow hover:shadow-lg"
        style={{ aspectRatio: `${aspectW} / ${aspectH}` }}
      >
        <CoverPlaceholder book={book} />
        <span className="absolute right-2 bottom-1.5 flex items-center gap-1 rounded-full bg-[rgba(28,24,21,0.82)] px-[7px] py-[2px] text-[0.7rem] font-semibold text-white">
          {book.pieceCount}
          <IconClefStaff size={10} />
        </span>
      </div>
      {/* min-h-[58px]: kept in sync with BookGridCard.tsx's own fix — pins
          this block to a constant height (2-line title + gap + one meta
          line, confirmed via computed styles on the real page) regardless
          of actual title length, so justify-end above bottom-aligns every
          cover in the row to the same line rather than each card's cover
          landing at a height that depends on its own title's wrap length. */}
      <div className="flex min-h-[58px] flex-col gap-0.5">
        <p className="line-clamp-2 font-display text-sm font-medium text-ink">{book.bookTitle}</p>
        {meta && <p className="truncate text-xs text-ink-soft">{meta}</p>}
      </div>
    </div>
  )
}

// ---- Option C: catalog list ----
function BookCatalogRow({ book }: { book: MockBook }) {
  const meta = metaLine(book)
  return (
    // No border-t/first:border-t-0 here (found and fixed 2026-08-28,
    // matching the real BookListCard.tsx's own comment on this exact
    // bug): this card is wrapped in its own per-row container in the
    // real component (BookContextMenu's div, for right-click/long-press)
    // — this mockup doesn't have that wrapper, but keeps the fix anyway
    // for consistency, since border-t + first:border-t-0 is fragile the
    // moment any per-row wrapper exists. The list container below
    // supplies dividers via divide-y divide-border instead.
    <div className="flex cursor-pointer items-center gap-5 rounded-md px-2 py-3 text-left hover:bg-accent-soft">
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-base font-medium text-ink">{book.bookTitle}</p>
        <p className="truncate text-sm text-ink-soft">
          {meta || <span className="text-ink-soft/60 italic">No composer or publisher on file</span>}
        </p>
      </div>
      <div className="flex w-14 shrink-0 flex-col items-center justify-center border-l border-border pl-4">
        <span className="font-display text-xl leading-none text-accent">{book.pieceCount}</span>
        <span className="mt-1 text-[0.6rem] tracking-wide text-ink-soft uppercase">pieces</span>
      </div>
      {/* Solid pre-blend, not opacity — overlapping icon strokes would re-blend unevenly under real translucency. */}
      <IconChevronRight size={18} className="shrink-0 text-[#aca7a1]" />
    </div>
  )
}

// ---------------------------------------------------------------------
// Sort/Filter (Option B, picked 2026-08-27 — see the Filter Studies
// comparison artifact and PieceLibrarySample.tsx's own copy of this
// system, which this is a direct port of). Books only carry two
// relational filter facets today, Sheet Type and Instrument — no Key,
// tags, Favorite, or Practice Status, since those are piece-only fields
// (design doc §3's Naming/architecture note) — so there's no "Show only"
// boolean-toggle section the way Pieces' drawer has one; every section
// here is a real multi-select facet. Sort gets a fourth field Pieces
// doesn't have, Year Written, since Book carries that as a real field.
// ---------------------------------------------------------------------

function distinctBookValues<K extends 'sheetType'>(field: K): string[] {
  return [...new Set(MOCK_BOOKS.map((b) => b[field]))].sort()
}
function distinctInstruments(): string[] {
  const values = new Set<string>()
  MOCK_BOOKS.forEach((b) => b.instruments.forEach((i) => values.add(i)))
  return [...values].sort()
}

const SHEET_TYPE_OPTIONS = distinctBookValues('sheetType')
const INSTRUMENT_OPTIONS = distinctInstruments()

// Live/faceted (changed 2026-08-31, matching the real backend's own
// switch — internal/handlers/facets.go): a facet's own displayed count
// reflects the OTHER active filter plus the search box, never
// self-narrowing against its own selection — the mockup's own port of the
// real backend's combineClauses "exclude" rule, same as
// PieceLibrarySample.tsx's matchesFiltersExcept.
function booksMatchExcept(b: MockBook, f: BookFilterState, exclude: keyof BookFilterState | null, query: string): boolean {
  if (exclude !== 'sheetType' && f.sheetType.length && !f.sheetType.includes(b.sheetType)) return false
  if (exclude !== 'instruments' && f.instruments.length && !f.instruments.some((i) => b.instruments.includes(i))) return false
  if (query.trim() && !b.bookTitle.toLowerCase().includes(query.trim().toLowerCase())) return false
  return true
}
function countSheetType(value: string, f: BookFilterState, query: string): number {
  return MOCK_BOOKS.filter((b) => b.sheetType === value && booksMatchExcept(b, f, 'sheetType', query)).length
}
function countInstrument(value: string, f: BookFilterState, query: string): number {
  return MOCK_BOOKS.filter((b) => b.instruments.includes(value) && booksMatchExcept(b, f, 'instruments', query)).length
}

interface BookFilterState {
  sheetType: string[]
  instruments: string[]
}
const EMPTY_BOOK_FILTERS: BookFilterState = { sheetType: [], instruments: [] }

function toggleInArray(arr: string[], value: string): string[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]
}
function activeBookFilterCount(f: BookFilterState): number {
  return f.sheetType.length + f.instruments.length
}
function bookMatches(b: MockBook, f: BookFilterState): boolean {
  if (f.sheetType.length && !f.sheetType.includes(b.sheetType)) return false
  if (f.instruments.length && !f.instruments.some((i) => b.instruments.includes(i))) return false
  return true
}

function BookFacetRow({
  label,
  count,
  checked,
  onChange,
}: {
  label: string
  count: number
  checked: boolean
  onChange: () => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1.5 text-sm text-ink hover:bg-paper-sunken">
      <input type="checkbox" checked={checked} onChange={onChange} className="accent-accent" />
      <span className="flex-1">{label}</span>
      <span className="text-xs text-ink-soft tabular-nums">{count}</span>
    </label>
  )
}

function BookFacetSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border py-3 last:border-b-0">
      <p className="mb-1.5 text-xs font-semibold tracking-wide text-ink-soft uppercase">{title}</p>
      <div className="flex flex-col">{children}</div>
    </div>
  )
}

// Live update (no draft/"Show results" step — same as PieceLibrarySample's
// own drawer, changed there 2026-08-27 from an original draft-then-apply
// design): every checkbox writes straight to the applied filter state, so
// results/pills/badge count all update the instant a box is checked.
function BookFilterDrawer({
  open,
  filters,
  query,
  onChange,
  onClose,
  onClear,
}: {
  open: boolean
  filters: BookFilterState
  query: string
  onChange: (next: BookFilterState) => void
  onClose: () => void
  onClear: () => void
}) {
  return (
    <>
      <div
        aria-hidden={!open}
        className={`fixed inset-0 z-40 bg-ink/40 backdrop-blur-[1px] transition-opacity duration-200 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-label="Filters"
        className={`fixed inset-y-0 right-0 z-50 flex w-80 max-w-[88vw] flex-col border-l border-border bg-paper-raised shadow-xl transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3.5">
          <h2 className="font-display text-base font-medium text-ink">Filters</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="flex size-8 cursor-pointer items-center justify-center rounded-md text-ink-soft hover:bg-paper-sunken hover:text-ink"
          >
            <IconX size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2">
          <BookFacetSection title="Sheet Type">
            {SHEET_TYPE_OPTIONS.map((v) => (
              <BookFacetRow
                key={v}
                label={v}
                count={countSheetType(v, filters, query)}
                checked={filters.sheetType.includes(v)}
                onChange={() => onChange({ ...filters, sheetType: toggleInArray(filters.sheetType, v) })}
              />
            ))}
          </BookFacetSection>

          <BookFacetSection title="Instrument">
            {INSTRUMENT_OPTIONS.map((v) => (
              <BookFacetRow
                key={v}
                label={v}
                count={countInstrument(v, filters, query)}
                checked={filters.instruments.includes(v)}
                onChange={() => onChange({ ...filters, instruments: toggleInArray(filters.instruments, v) })}
              />
            ))}
          </BookFacetSection>
        </div>

        <div className="flex shrink-0 items-center border-t border-border px-4 py-3.5">
          <button
            type="button"
            onClick={onClear}
            className="w-full cursor-pointer rounded-md border border-border bg-paper-raised px-3 py-2 text-sm font-medium text-ink hover:border-accent"
          >
            Clear all filters
          </button>
        </div>
      </aside>
    </>
  )
}

const BOOK_SORT_FIELDS = ['Date Added', 'Title', 'Composer', 'Year Published'] as const
type BookSortField = (typeof BOOK_SORT_FIELDS)[number]
type SortDirection = 'asc' | 'desc'

const BOOK_DIRECTION_LABEL: Record<BookSortField, Record<SortDirection, string>> = {
  'Date Added': { asc: 'Oldest first', desc: 'Newest first' },
  Title: { asc: 'A to Z', desc: 'Z to A' },
  Composer: { asc: 'A to Z', desc: 'Z to A' },
  'Year Published': { asc: 'Earliest first', desc: 'Latest first' },
}

// One fused, segmented button — same as PieceLibrarySample.tsx's own
// SortControl (ported directly, field names swapped): the text segment
// opens the field dropdown (the choice with more than two options, the
// one that actually needs a listbox — per this app's standing dropdown-
// keyboard-nav rule), the icon segment is a plain toggle button for
// direction (only ever two states). Same shared-pill structure as Piece
// Details' own Download PDF split button (PiecePage.tsx).
function BookSortControl({
  field,
  direction,
  onFieldChange,
  onDirectionToggle,
}: {
  field: BookSortField
  direction: SortDirection
  onFieldChange: (v: BookSortField) => void
  onDirectionToggle: () => void
}) {
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const directionLabel = BOOK_DIRECTION_LABEL[field][direction]

  function openMenu() {
    const i = BOOK_SORT_FIELDS.indexOf(field)
    setHighlightedIndex(i >= 0 ? i : 0)
    setOpen(true)
  }
  function select(opt: BookSortField) {
    onFieldChange(opt)
    setOpen(false)
  }
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) openMenu()
      else setHighlightedIndex((i) => (i + 1) % BOOK_SORT_FIELDS.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) openMenu()
      else setHighlightedIndex((i) => (i - 1 + BOOK_SORT_FIELDS.length) % BOOK_SORT_FIELDS.length)
    } else if ((event.key === 'Enter' && !event.shiftKey) || event.key === ' ') {
      if (open) {
        event.preventDefault()
        select(BOOK_SORT_FIELDS[highlightedIndex])
      }
    } else if (event.key === 'Escape' && open) {
      setOpen(false)
    }
  }

  return (
    <div className="relative shrink-0">
      <div className="flex overflow-hidden rounded-md border border-border bg-paper-raised">
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : openMenu())}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-sm text-ink hover:bg-paper-sunken"
        >
          {field}
          <IconChevronDown size={14} className="text-[#9d9892]" />
        </button>
        <button
          type="button"
          onClick={onDirectionToggle}
          aria-label={`Sort direction: ${directionLabel}. Click to reverse.`}
          title={directionLabel}
          className="flex cursor-pointer items-center justify-center border-l border-border px-2.5 py-2 text-ink hover:bg-paper-sunken"
        >
          {direction === 'asc' ? <IconArrowUp size={16} /> : <IconArrowDown size={16} />}
        </button>
      </div>
      {open && (
        <div className="absolute z-10 mt-1 w-full min-w-[150px] overflow-hidden rounded-md border border-border bg-paper-raised py-1 shadow-lg">
          {BOOK_SORT_FIELDS.map((opt, index) => (
            <button
              key={opt}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(opt)}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-accent-soft ${
                opt === field ? 'text-accent' : 'text-ink'
              } ${index === highlightedIndex ? 'bg-accent-soft' : ''}`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// id doubles as "date added" (no real timestamp field on this fixture,
// same convention as PieceLibrarySample.tsx's own sortPieces). yearWritten
// is nullable on a real Book — null sorts last regardless of direction,
// same principle as a blank field being omitted rather than treated as
// "earliest"/"latest" by accident.
function sortBooks(books: MockBook[], field: BookSortField, direction: SortDirection): MockBook[] {
  const sorted = [...books]
  if (field === 'Title') sorted.sort((a, b) => a.bookTitle.localeCompare(b.bookTitle))
  else if (field === 'Composer') sorted.sort((a, b) => (effectiveComposer(a) ?? '').localeCompare(effectiveComposer(b) ?? ''))
  else if (field === 'Year Published') {
    sorted.sort((a, b) => {
      if (!a.yearWritten && !b.yearWritten) return 0
      if (!a.yearWritten) return 1
      if (!b.yearWritten) return -1
      return a.yearWritten.localeCompare(b.yearWritten)
    })
  } else sorted.sort((a, b) => a.id - b.id)
  if (direction === 'desc') sorted.reverse()
  return sorted
}

interface NewBookFormValues {
  bookTitle: string
  composer: string
  publisher: string
  yearWritten: string
}

// Manual book creation (design doc §5 note: a Book can legitimately exist
// with zero linked Pieces — this is that case, not a resume-import flow).
// Deliberately minimal: only the four fields a book can meaningfully have
// before any pieces are attached to it — no sheet type/instruments/opus/
// IMSLP/description here, those only make sense once there's real content
// to classify. Title is the only required field, same reasoning as
// ValidateBook's real bookTitle requirement (CLAUDE.md > Book-level soft
// inheritance) — an untitled book is a confusing empty state anywhere it's
// shown, everywhere else is genuinely optional.
function NewBookModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (values: NewBookFormValues) => void
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<NewBookFormValues>({
    defaultValues: { bookTitle: '', composer: '', publisher: '', yearWritten: '' },
  })

  function handleClose() {
    reset()
    onClose()
  }

  function onSubmit(data: NewBookFormValues) {
    onCreate(data)
    reset()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      labelledBy="new-book-title"
      header={
        <div className="flex items-start justify-between gap-4">
          <h2 id="new-book-title" className="font-display text-2xl font-medium text-ink">
            New book
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="mt-1 shrink-0 text-ink-soft hover:text-accent"
          >
            <IconXFilled size={22} />
          </button>
        </div>
      }
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="new-book-form"
            className="rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90"
          >
            Create
          </button>
        </div>
      }
    >
      <form id="new-book-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="nb-title" className="text-sm text-ink-soft">
            Title <span className="italic text-ink-soft/60">(Required)</span>
          </label>
          <input
            id="nb-title"
            autoFocus
            className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
            {...register('bookTitle', { required: 'Title is required.', maxLength: 255 })}
          />
          {errors.bookTitle && <p className="text-sm text-red-700">{errors.bookTitle.message}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="nb-composer" className="text-sm text-ink-soft">
            Composer
          </label>
          <input
            id="nb-composer"
            className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
            {...register('composer', { maxLength: 255 })}
          />
        </div>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="nb-publisher" className="text-sm text-ink-soft">
              Publisher
            </label>
            <input
              id="nb-publisher"
              className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('publisher', { maxLength: 255 })}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="nb-year" className="text-sm text-ink-soft">
              Year first published
            </label>
            <input
              id="nb-year"
              className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('yearWritten', { maxLength: 255 })}
            />
          </div>
        </div>
      </form>
    </Modal>
  )
}

type ViewMode = 'grid' | 'list'

export function BooksLibrarySample() {
  useMockupTitle('Books Library')

  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [books, setBooks] = useState<MockBook[]>(MOCK_BOOKS)
  const [newBookOpen, setNewBookOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [appliedFilters, setAppliedFilters] = useState<BookFilterState>(EMPTY_BOOK_FILTERS)
  const [sortField, setSortField] = useState<BookSortField>('Date Added')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  // Stable, incrementing placeholder ids for mockup-created books, well
  // clear of the seeded 1-8 range — a real create would get its id back
  // from the API response instead.
  const nextBookId = useRef(1000)

  function handleCreateBook(values: NewBookFormValues) {
    setBooks((prev) => [
      {
        id: nextBookId.current++,
        bookTitle: values.bookTitle.trim(),
        composer: values.composer.trim() || null,
        publisher: values.publisher.trim() || null,
        yearWritten: values.yearWritten.trim() || null,
        // A freshly created book has no pieces linked yet — real pieces
        // only get attached via the import wizard's confirm step. Same
        // reasoning for sheetType/instruments: nothing to classify yet.
        pieceCount: 0,
        sheetType: '',
        instruments: [],
      },
      ...prev,
    ])
    setNewBookOpen(false)
  }

  const filtered = books.filter(
    (b) => bookMatches(b, appliedFilters) && (!query.trim() || b.bookTitle.toLowerCase().includes(query.trim().toLowerCase())),
  )
  const sortedBooks = sortBooks(filtered, sortField, sortDirection)
  const activeCount = activeBookFilterCount(appliedFilters)

  function clearAppliedFilter(field: keyof BookFilterState, value: string) {
    setAppliedFilters((f) => ({ ...f, [field]: f[field].filter((v) => v !== value) }))
  }
  const pillEntries: { field: keyof BookFilterState; value: string }[] = [
    ...appliedFilters.sheetType.map((v) => ({ field: 'sheetType' as const, value: v })),
    ...appliedFilters.instruments.map((v) => ({ field: 'instruments' as const, value: v })),
  ]

  return (
    <div className="flex flex-1 flex-col">
      {/* Ported from PieceLibrarySample.tsx's own toolbar (full reasoning
          there, and in memory project_responsive_device_plan.md) — same
          left(toggle)/center(search)/right(Filters→Sort) grid, same
          `sm:`/`2xl:` breakpoints (an `lg:`-based attempt to smooth out
          the real-but-narrow dip in Search's width right at `md:768`,
          where the sidebar first appears, was tried and reverted — direct
          instruction to keep Piece's exact proven breakpoints rather than
          layer in more fixes; that dip is accepted here, same as it's
          accepted on Piece itself), same icon-only-Filters squeezed band,
          same h-[38px]/exact-px-floor fixes (right column's floor values
          are identical to Piece's — Filters+Sort alone, nothing New-Book-
          specific baked in).

          "New Book" pairs with Search specifically, not with Filters+Sort
          — same row as Search at narrow widths, immediately to Search's
          right at wide ones (direct request, after an earlier attempt put
          it in the Filters+Sort cluster instead and needed correcting).
          Folded into the *same* grid cell Search already owns, as a small
          flex row (`Search flex-1` + `New Book shrink-0`) rather than a
          fourth top-level grid column — this cell already collapses to
          one full-width mobile row and centers as one desktop column, so
          nesting the pair inside it gets both "shares Search's row" and
          "rides its right edge" for free, no separate mobile-only markup
          needed. `justify-center` (not `justify-self-center`, which has
          nothing to act on once the wrapper is `w-full`) is what actually
          centers the pair as a unit once Search hits its cap — without
          it, leftover track space collects as trailing whitespace after
          New Book instead of splitting evenly around the pair, which
          looked plainly wrong on a real screenshot (Search+New Book
          shoved left, matching neither Piece's own centered-Search
          precedent nor the direct instruction to keep them floating
          center like it). Never icon-only, unlike Filters — direct
          instruction, applies here and on People's equivalent button. */}
      <div className="sticky top-0 z-10 border-b border-border bg-paper">
        <div className={`${WIDE_CONTENT_MAX_W} flex flex-col gap-3 p-4`}>
          <div className="grid grid-cols-[auto_1fr] items-center gap-3 sm:grid-cols-[auto_1fr_211px] 2xl:grid-cols-[auto_1fr_255px]">
            <div className="col-start-1 row-start-1 flex shrink-0 items-center justify-self-start gap-1 rounded-md border border-border p-0.5 sm:col-start-auto sm:row-start-auto">
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

            <div className="col-span-2 row-start-2 flex w-full min-w-0 items-center justify-center gap-3 sm:col-span-1 sm:row-start-auto">
              <div className="relative min-w-0 max-w-xl flex-1">
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
                onClick={() => setNewBookOpen(true)}
                className="flex h-[38px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-paper-raised px-3 text-sm text-ink hover:border-accent hover:text-accent active:border-accent active:text-accent"
              >
                <IconPlus size={16} />
                New Book
              </button>
            </div>

            <div className="col-start-2 row-start-1 flex items-center justify-self-end gap-3 sm:col-start-auto sm:row-start-auto">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-label="Filters"
                className={`flex h-[38px] cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm active:border-accent active:text-accent ${
                  activeCount > 0
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border bg-paper-raised text-ink hover:border-accent hover:text-accent'
                }`}
              >
                <IconAdjustmentsHorizontal size={16} />
                <span className="inline sm:hidden 2xl:inline">Filters</span>
                {activeCount > 0 && (
                  <span className="flex size-4 items-center justify-center rounded-full bg-accent text-[0.65rem] font-semibold text-white">
                    {activeCount}
                  </span>
                )}
              </button>

              <BookSortControl
                field={sortField}
                direction={sortDirection}
                onFieldChange={setSortField}
                onDirectionToggle={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
              />
            </div>
          </div>

          {pillEntries.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {pillEntries.map((entry) => (
                <span
                  key={entry.field + entry.value}
                  className="flex items-center gap-1.5 rounded-full bg-accent-soft py-1 pr-1.5 pl-3 text-xs font-medium text-accent"
                >
                  {entry.value}
                  <button
                    type="button"
                    onClick={() => clearAppliedFilter(entry.field, entry.value)}
                    aria-label={`Remove ${entry.value} filter`}
                    className="flex size-4 cursor-pointer items-center justify-center rounded-full text-accent opacity-75 hover:opacity-100"
                  >
                    <IconX size={11} />
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => setAppliedFilters(EMPTY_BOOK_FILTERS)}
                className="cursor-pointer text-xs text-ink-soft underline decoration-dotted underline-offset-2 hover:text-ink"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="p-4 pb-0">
        <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
          Design mockup — <span className="font-medium text-ink">Books library sort/filter</span>. Grid
          and list match the real BookGridCard/BookListCard exactly; Search, Filters, Sort, and the
          grid/list toggle are all genuinely interactive against the 8 fixture books below. Cards aren't
          real links.
        </div>
      </div>

      <div className={`${WIDE_CONTENT_MAX_W} flex-1 p-4`}>
        <p className="mb-3 text-xs text-ink-soft tabular-nums">
          {sortedBooks.length} {sortedBooks.length === 1 ? 'book' : 'books'}
        </p>

        {sortedBooks.length === 0 && <p className="p-8 text-center text-ink-soft">No books match these filters.</p>}

        {sortedBooks.length > 0 && viewMode === 'grid' && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-4 gap-y-6">
            {sortedBooks.map((book) => (
              <BookCoverCard key={book.id} book={book} />
            ))}
          </div>
        )}

        {sortedBooks.length > 0 && viewMode === 'list' && (
          <div className="flex flex-col divide-y divide-border">
            {sortedBooks.map((book) => (
              <BookCatalogRow key={book.id} book={book} />
            ))}
          </div>
        )}
      </div>

      <NewBookModal open={newBookOpen} onClose={() => setNewBookOpen(false)} onCreate={handleCreateBook} />

      <BookFilterDrawer
        open={drawerOpen}
        filters={appliedFilters}
        query={query}
        onChange={setAppliedFilters}
        onClose={() => setDrawerOpen(false)}
        onClear={() => setAppliedFilters(EMPTY_BOOK_FILTERS)}
      />
    </div>
  )
}
