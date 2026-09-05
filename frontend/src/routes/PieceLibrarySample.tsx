import { useState, type KeyboardEvent } from 'react'
import {
  IconAdjustmentsHorizontal,
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRightFilled,
  IconHeartFilled,
  IconLayoutGridFilled,
  IconLayoutListFilled,
  IconMinus,
  IconMusic,
  IconPlus,
  IconSearch,
  IconSlash,
  IconX,
} from '@tabler/icons-react'
import { useMockupTitle } from '../lib/useMockupTitle'
import { PracticeStatusIcon } from '../components/PracticeStatusIcon'
import { WIDE_CONTENT_MAX_W } from '../lib/layout'

// ---------------------------------------------------------------------
// DESIGN MOCKUP — Piece Library sort/filter (Option B, "Filter Drawer",
// picked 2026-08-27 from a 4-option comparison artifact — see that
// artifact for the other three and why this one won: it's the option
// that ages best once more facets show up later, e.g. a future custom-
// fields feature, design doc §13, without ever crowding the toolbar).
// Not wired to the API — the piece list below is a fixed local fixture,
// and cards aren't real links (same convention as BooksLibrarySample.tsx).
//
// The Piece Library's real toolbar today (PieceBrowseView.tsx) is just
// Search + grid/list toggle — no sort or filter UI exists yet at all,
// even though the backend already accepts keyId/instrumentId/
// sheetTypeId/userTagId/favorite/practiceStatus as search params. This
// mockup is that real toolbar plus the new Filters button + drawer + Sort
// control, so the diff against the real page is exactly the new
// functionality, not a reimagined toolbar.
//
// Facet counts are live/faceted (changed 2026-08-31, matching a real
// backend switch — internal/handlers/facets.go), not the whole-library
// static counts this mockup originally shipped with: matchesFiltersExcept
// below is the mockup's own client-side port of the real backend's
// combineClauses "every OTHER active filter, never your own selection"
// rule, kept behaviorally in sync per this app's standing mockup-parity
// convention even though this fixture has no real backend to call.
// ---------------------------------------------------------------------

interface MockPiece {
  id: number
  title: string
  composer: string
  key: string
  instrument: string
  sheetType: string
  userTags: string[]
  favorite: boolean
  // sourceBookId is optional on a real Piece (design doc §3/§5 — a piece
  // with no book at all is a normal, first-class case, not an edge case
  // to special-case around, e.g. a single downloaded score). true here
  // stands in for that "no sourceBookId" case, mirroring the real field's
  // absence rather than naming a book.
  bookless: boolean
  hasImslpNumber: boolean
  practiceStatus: 'Want to Learn' | 'Learning' | 'Learned' | 'Stalled'
  // Drives PageCycleControl in the list view — that control renders
  // nothing at all for a pageCount of 1 (the common single-page-upload
  // case), so most fixture pieces stay at 1 and a couple get a real
  // multi-page count instead, to actually demonstrate the control rather
  // than have it silently never appear anywhere in this mockup.
  pageCount: number
  // Real composition years for the real pieces this fixture names — one
  // piece (Autumn Leaves) deliberately left blank to demonstrate the "Year
  // Written" sort's own blanks-always-trail rule, mirroring the real
  // backend's pieceSortColumns (internal/handlers/search.go).
  yearWritten: string
}

// Deliberately mixed, same "stress the edges" habit as this app's other
// mockup fixtures: spans every facet type, includes a couple of pieces
// sharing values (so filter counts are meaningfully > 1 somewhere) and a
// couple of loners (so a filter can meaningfully narrow to 1).
//
// Key spelling matches this app's real convention exactly, not just the
// symbol: Unicode ♯/♭ (never a hyphenated word or ASCII '#'/'b'), and the
// simpler-accidental-count enharmonic spelling for the five black-key
// pitches — see migration 00010_key_naming_and_order.sql. That's why the
// Moonlight Sonata (piece 6) shows as "D♭ Minor," not the far more
// familiar "C♯ minor": the migration renamed C♯ Minor into D♭ Minor
// project-wide (fewer accidentals), with no separate C♯ Minor row left to
// pick instead — this fixture reflects what the real key list actually
// contains, not the spelling every musician would reach for by habit.
const PIECES: MockPiece[] = [
  { id: 1, title: 'Album für die Jugend', composer: 'Schumann', key: 'A Minor', instrument: 'Piano', sheetType: 'Solo Piece', userTags: [], favorite: true, bookless: false, hasImslpNumber: true, practiceStatus: 'Learning', pageCount: 3, yearWritten: '1848' },
  { id: 2, title: 'Prelude in C', composer: 'Bach, J.S.', key: 'C Major', instrument: 'Piano', sheetType: 'Solo Piece', userTags: [], favorite: true, bookless: false, hasImslpNumber: true, practiceStatus: 'Learned', pageCount: 1, yearWritten: '1722' },
  { id: 3, title: 'Nocturne in E♭', composer: 'Chopin', key: 'D Major', instrument: 'Piano', sheetType: 'Solo Piece', userTags: ['Recital'], favorite: false, bookless: false, hasImslpNumber: true, practiceStatus: 'Learning', pageCount: 4, yearWritten: '1831' },
  { id: 4, title: 'Clair de lune', composer: 'Debussy', key: 'D Major', instrument: 'Piano', sheetType: 'Solo Piece', userTags: [], favorite: false, bookless: true, hasImslpNumber: false, practiceStatus: 'Want to Learn', pageCount: 5, yearWritten: '1905' },
  { id: 5, title: 'Waltz for Debby', composer: 'Evans', key: 'C Major', instrument: 'Piano', sheetType: 'Lead Sheet', userTags: ['Jazz'], favorite: false, bookless: false, hasImslpNumber: false, practiceStatus: 'Learned', pageCount: 1, yearWritten: '1956' },
  { id: 6, title: 'Moonlight, I.', composer: 'Beethoven', key: 'D♭ Minor', instrument: 'Piano', sheetType: 'Solo Piece', userTags: ['Recital'], favorite: false, bookless: false, hasImslpNumber: true, practiceStatus: 'Learning', pageCount: 2, yearWritten: '1801' },
  { id: 7, title: 'Air on the G String', composer: 'Bach, J.S.', key: 'D Major', instrument: 'Violin', sheetType: 'Duet', userTags: [], favorite: false, bookless: true, hasImslpNumber: false, practiceStatus: 'Want to Learn', pageCount: 1, yearWritten: '1731' },
  { id: 8, title: 'Gymnopédie No. 1', composer: 'Satie', key: 'A Minor', instrument: 'Piano', sheetType: 'Solo Piece', userTags: [], favorite: true, bookless: true, hasImslpNumber: false, practiceStatus: 'Learned', pageCount: 1, yearWritten: '1888' },
  { id: 9, title: 'Autumn Leaves', composer: 'Kosma', key: 'G Minor', instrument: 'Piano', sheetType: 'Lead Sheet', userTags: ['Jazz'], favorite: false, bookless: false, hasImslpNumber: false, practiceStatus: 'Want to Learn', pageCount: 1, yearWritten: '' },
  { id: 10, title: 'Sonata No. 8 "Pathétique," II.', composer: 'Beethoven', key: 'A♭ Major', instrument: 'Piano', sheetType: 'Solo Piece', userTags: ['Recital'], favorite: true, bookless: false, hasImslpNumber: true, practiceStatus: 'Stalled', pageCount: 3, yearWritten: '1798' },
]

// Distinct option lists, derived from PIECES rather than hand-listed a
// second time — the real backend's own filter option lists (Key/
// Instrument/SheetType/UserTags) come from the lookup tables, but this
// fixture has no separate lookup table to read from, so deriving from the
// fixture itself is the closest equivalent without inventing a second
// source of truth that could drift from the first.
function distinct<K extends keyof MockPiece>(field: K): string[] {
  const values = new Set<string>()
  PIECES.forEach((p) => {
    const v = p[field]
    if (Array.isArray(v)) v.forEach((x) => values.add(x))
    else values.add(String(v))
  })
  return [...values].sort()
}

const KEY_OPTIONS = distinct('key')
const INSTRUMENT_OPTIONS = distinct('instrument')
const SHEET_TYPE_OPTIONS = distinct('sheetType')
const USER_TAG_OPTIONS = distinct('userTags')
const STATUS_OPTIONS: MockPiece['practiceStatus'][] = ['Want to Learn', 'Learning', 'Learned', 'Stalled']

// Live/faceted (changed 2026-08-31, matching the real backend's own
// switch — internal/handlers/facets.go): a facet's own displayed count
// reflects every OTHER currently active filter plus the search box, but
// never self-narrows against its own selection — the standard multi-
// select faceted-search rule. `exclude` names the FilterState key this
// particular facet's own count must skip when checking f, mirroring
// combineClauses's `exclude` param on the real backend exactly.
// matchesDimension/matchesTagDimension: 'include' entries OR together
// exactly like the old array did (any one included value is enough);
// 'exclude' entries are checked first and unconditionally reject a match
// regardless of the include list — a value can't be both, since
// setDimensionState only ever stores one state per key.
function matchesDimension(map: Record<string, TriState>, pieceValue: string): boolean {
  const entries = Object.entries(map)
  if (entries.some(([v, s]) => s === 'exclude' && v === pieceValue)) return false
  const included = entries.filter(([, s]) => s === 'include').map(([v]) => v)
  return included.length === 0 || included.includes(pieceValue)
}

function matchesTagDimension(map: Record<string, TriState>, pieceTags: string[]): boolean {
  const entries = Object.entries(map)
  if (entries.some(([v, s]) => s === 'exclude' && pieceTags.includes(v))) return false
  const included = entries.filter(([, s]) => s === 'include').map(([v]) => v)
  return included.length === 0 || included.some((t) => pieceTags.includes(t))
}

function matchesBoolean(state: TriState, pieceValue: boolean): boolean {
  if (state === 'include') return pieceValue
  if (state === 'exclude') return !pieceValue
  return true
}

function matchesFiltersExcept(p: MockPiece, f: FilterState, exclude: keyof FilterState | null, query: string): boolean {
  if (exclude !== 'key' && !matchesDimension(f.key, p.key)) return false
  if (exclude !== 'instrument' && !matchesDimension(f.instrument, p.instrument)) return false
  if (exclude !== 'sheetType' && !matchesDimension(f.sheetType, p.sheetType)) return false
  if (exclude !== 'userTags' && !matchesTagDimension(f.userTags, p.userTags)) return false
  if (exclude !== 'status' && !matchesDimension(f.status, p.practiceStatus)) return false
  if (exclude !== 'favorite' && !matchesBoolean(f.favorite, p.favorite)) return false
  if (exclude !== 'bookless' && !matchesBoolean(f.bookless, p.bookless)) return false
  if (exclude !== 'hasImslpNumber' && !matchesBoolean(f.hasImslpNumber, p.hasImslpNumber)) return false
  if (query.trim() && !p.title.toLowerCase().includes(query.trim().toLowerCase())) return false
  return true
}

function countMatching(field: 'key' | 'instrument' | 'sheetType', value: string, f: FilterState, query: string): number {
  return PIECES.filter((p) => p[field] === value && matchesFiltersExcept(p, f, field, query)).length
}
function countTag(tag: string, f: FilterState, query: string): number {
  return PIECES.filter((p) => p.userTags.includes(tag) && matchesFiltersExcept(p, f, 'userTags', query)).length
}
function countStatus(status: string, f: FilterState, query: string): number {
  return PIECES.filter((p) => p.practiceStatus === status && matchesFiltersExcept(p, f, 'status', query)).length
}
function countFavorite(f: FilterState, query: string): number {
  return PIECES.filter((p) => p.favorite && matchesFiltersExcept(p, f, 'favorite', query)).length
}
function countBookless(f: FilterState, query: string): number {
  return PIECES.filter((p) => p.bookless && matchesFiltersExcept(p, f, 'bookless', query)).length
}
function countHasImslp(f: FilterState, query: string): number {
  return PIECES.filter((p) => p.hasImslpNumber && matchesFiltersExcept(p, f, 'hasImslpNumber', query)).length
}

// Stands in for a real page thumbnail (getPieceThumbnailUrl) — same
// landscape 180:132 staff-line placeholder convention as
// BookDetailsSample.tsx's SheetThumb, just proportioned to match
// PieceGridCard's own aspect-[180/132] instead of a book cover's 2:3.
function PieceThumb({ seed }: { seed: number }) {
  const staffYs = [22, 40, 58, 76]
  const hue = (seed * 47) % 360
  return (
    <svg viewBox="0 0 180 132" preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
      <rect width="180" height="132" fill={`hsl(${hue} 22% 94%)`} />
      {staffYs.map((y) => (
        <g key={y}>
          {Array.from({ length: 5 }, (_, i) => (
            <line key={i} x1="14" y1={y + i * 3.4} x2="166" y2={y + i * 3.4} stroke="#3a342c" strokeWidth="0.8" opacity="0.55" />
          ))}
        </g>
      ))}
    </svg>
  )
}

// Three-way segmented control (direct request, 2026-09-05) — replaces the
// old plain checkbox (include-or-not) on every facet row with a real
// exclude/neutral/include choice, so "any key but D Major" or "must not be
// a Favorite" is expressible, not just "must be." 'neutral' is the
// no-constraint default (the old unchecked state); 'include'/'exclude' are
// new. A dimension's own map (see FilterState below) only ever stores its
// non-neutral entries — 'neutral' is represented by the key's *absence*,
// not a stored 'neutral' value, so activeFilterCount/pillEntries below can
// stay a plain Object.keys().length / Object.entries() read, same shape
// the old plain string[] arrays already had.
type TriState = 'exclude' | 'neutral' | 'include'

function dimensionState(map: Record<string, TriState>, value: string): TriState {
  return map[value] ?? 'neutral'
}

// Returns a new map with `value` set to `next` — or removed entirely when
// `next` is 'neutral', keeping the map's own invariant (only non-neutral
// entries stored) intact rather than accumulating dead 'neutral' keys.
function setDimensionState(map: Record<string, TriState>, value: string, next: TriState): Record<string, TriState> {
  if (next === 'neutral') {
    return Object.fromEntries(Object.entries(map).filter(([k]) => k !== value))
  }
  return { ...map, [value]: next }
}

interface FilterState {
  key: Record<string, TriState>
  instrument: Record<string, TriState>
  sheetType: Record<string, TriState>
  userTags: Record<string, TriState>
  status: Record<string, TriState>
  favorite: TriState
  bookless: TriState
  hasImslpNumber: TriState
}

const EMPTY_FILTERS: FilterState = {
  key: {},
  instrument: {},
  sheetType: {},
  userTags: {},
  status: {},
  favorite: 'neutral',
  bookless: 'neutral',
  hasImslpNumber: 'neutral',
}

function activeFilterCount(f: FilterState): number {
  return (
    Object.keys(f.key).length +
    Object.keys(f.instrument).length +
    Object.keys(f.sheetType).length +
    Object.keys(f.userTags).length +
    Object.keys(f.status).length +
    (f.favorite !== 'neutral' ? 1 : 0) +
    (f.bookless !== 'neutral' ? 1 : 0) +
    (f.hasImslpNumber !== 'neutral' ? 1 : 0)
  )
}

// Field and direction as two separate controls (chosen 2026-08-27 from a
// 4-option comparison — this one over two adjacent dropdowns or one
// combined "Title A–Z"/"Title Z–A" list: most compact, and a single
// icon toggle for a binary choice fits this app's device-aware "buttons
// over menus" convention better than a second dropdown would).
const SORT_FIELDS = ['Date Added', 'Title', 'Composer', 'Year Written'] as const
type SortField = (typeof SORT_FIELDS)[number]
type SortDirection = 'asc' | 'desc'

// What each direction actually means depends on the field — "ascending"
// on a title is A→Z, but on Date Added it's oldest-first. Centralized
// here so the toggle button's label/aria-text and the sort comparator
// below can't drift apart on what "ascending" is supposed to mean for a
// given field. Year Written uses "Earliest/Latest first" rather than
// "Oldest/Newest first" — that pair is reserved for Date Added, which is
// about when the piece was added to the library, not when it was
// composed — matching the real page's own DIRECTION_LABEL
// (PieceBrowseView.tsx) and BooksPage.tsx's existing yearWritten wording.
const DIRECTION_LABEL: Record<SortField, Record<SortDirection, string>> = {
  'Date Added': { asc: 'Oldest first', desc: 'Newest first' },
  Title: { asc: 'A to Z', desc: 'Z to A' },
  Composer: { asc: 'A to Z', desc: 'Z to A' },
  'Year Written': { asc: 'Earliest first', desc: 'Latest first' },
}

// One fused, segmented button (changed 2026-08-27) — same shared-pill
// structure as Piece Details' own Download PDF split button
// (PiecePage.tsx: a div.flex.overflow-hidden.rounded-md wrapping two
// segments joined by a border-l divider, with the dropdown panel
// positioned off a separate outer `relative` wrapper so overflow-hidden
// on the inner pill can't clip it — see that file's own comment on why
// the positioning context has to live one level up). Roles are the
// reverse of Download PDF's, per direct instruction: there, the text
// segment is the primary action (a real download link) and the icon
// segment opens a menu of alternatives. Here, the text segment (the
// field name) is what opens the menu — field is the choice with more
// than two options, the one that actually needs a listbox — while the
// icon segment is a plain, no-menu toggle button, since direction is
// only ever two states.
function SortControl({
  field,
  direction,
  onFieldChange,
  onDirectionToggle,
}: {
  field: SortField
  direction: SortDirection
  onFieldChange: (v: SortField) => void
  onDirectionToggle: () => void
}) {
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const directionLabel = DIRECTION_LABEL[field][direction]

  function openMenu() {
    const i = SORT_FIELDS.indexOf(field)
    setHighlightedIndex(i >= 0 ? i : 0)
    setOpen(true)
  }
  function select(opt: SortField) {
    onFieldChange(opt)
    setOpen(false)
  }
  // Field segment's own keyboard nav — same pattern as SingleSelect.tsx
  // (ArrowUp/Down opens seeded at the current value or cycles the
  // highlighted row with wrap, Enter/Space picks it), per this app's
  // standing dropdown-keyboard-nav rule (CLAUDE.md > Frontend). The
  // direction segment doesn't need an equivalent — it's a plain <button>,
  // which already gets Space/Enter activation for free, the same reason
  // a real listbox needs this handling and a binary toggle doesn't.
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) openMenu()
      else setHighlightedIndex((i) => (i + 1) % SORT_FIELDS.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) openMenu()
      else setHighlightedIndex((i) => (i - 1 + SORT_FIELDS.length) % SORT_FIELDS.length)
    } else if ((event.key === 'Enter' && !event.shiftKey) || event.key === ' ') {
      if (open) {
        event.preventDefault()
        select(SORT_FIELDS[highlightedIndex])
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
        <div className="absolute right-0 z-10 mt-1 w-full min-w-[150px] overflow-hidden rounded-md border border-border bg-paper-raised py-1 shadow-lg">
          {SORT_FIELDS.map((opt, index) => (
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

function FilterDrawer({
  open,
  filters,
  query,
  onChange,
  onClose,
  onClear,
}: {
  open: boolean
  filters: FilterState
  query: string
  onChange: (next: FilterState) => void
  onClose: () => void
  onClear: () => void
}) {
  return (
    <>
      {/* Same backdrop/slide mechanics as MobileNavDrawer (components/
          MobileNav.tsx), mirrored to the right edge instead of the left —
          fixed inset-0 backdrop with an opacity transition, fixed aside
          with a translate-x transition, so this reads as the same drawer
          language the app already has for its mobile nav, not a new one. */}
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

        <p className="shrink-0 border-b border-border px-4 py-2.5 text-xs leading-snug text-ink-soft">
          Included options within a section combine with <span className="font-medium text-ink">or</span> — checking
          two keys, for example, matches pieces in either. Different sections, and any excluded option, must all
          match.
        </p>

        <div className="flex-1 overflow-y-auto px-4 py-2">
          {/* Moved to the top (2026-08-27) — these two are whole-library
              toggles, not a facet you narrow down within, so they read
              better as the first thing you see rather than buried after
              five scrollable option lists. Rendered as FacetRows (with
              live counts) rather than the plain checkbox+label Favorites
              used before, for the same reason every other option in this
              drawer shows a count — "Bookless pieces (3)" tells you
              whether it's worth checking before you check it. */}
          <FacetSection title="Show only">
            <FacetRow
              label="Favorites"
              count={countFavorite(filters, query)}
              state={filters.favorite}
              onChange={(next) => onChange({ ...filters, favorite: next })}
            />
            <FacetRow
              label="Bookless pieces"
              count={countBookless(filters, query)}
              state={filters.bookless}
              onChange={(next) => onChange({ ...filters, bookless: next })}
            />
            <FacetRow
              label="Has IMSLP number"
              count={countHasImslp(filters, query)}
              state={filters.hasImslpNumber}
              onChange={(next) => onChange({ ...filters, hasImslpNumber: next })}
            />
          </FacetSection>

          <FacetSection title="Your Tags">
            {USER_TAG_OPTIONS.map((v) => (
              <FacetRow
                key={v}
                label={v}
                count={countTag(v, filters, query)}
                state={dimensionState(filters.userTags, v)}
                onChange={(next) => onChange({ ...filters, userTags: setDimensionState(filters.userTags, v, next) })}
              />
            ))}
          </FacetSection>

          <FacetSection title="Practice Status">
            {STATUS_OPTIONS.map((v) => (
              <FacetRow
                key={v}
                label={v}
                count={countStatus(v, filters, query)}
                state={dimensionState(filters.status, v)}
                onChange={(next) => onChange({ ...filters, status: setDimensionState(filters.status, v, next) })}
              />
            ))}
          </FacetSection>

          <FacetSection title="Sheet Type">
            {SHEET_TYPE_OPTIONS.map((v) => (
              <FacetRow
                key={v}
                label={v}
                count={countMatching('sheetType', v, filters, query)}
                state={dimensionState(filters.sheetType, v)}
                onChange={(next) => onChange({ ...filters, sheetType: setDimensionState(filters.sheetType, v, next) })}
              />
            ))}
          </FacetSection>

          <FacetSection title="Instrument">
            {INSTRUMENT_OPTIONS.map((v) => (
              <FacetRow
                key={v}
                label={v}
                count={countMatching('instrument', v, filters, query)}
                state={dimensionState(filters.instrument, v)}
                onChange={(next) => onChange({ ...filters, instrument: setDimensionState(filters.instrument, v, next) })}
              />
            ))}
          </FacetSection>

          <FacetSection title="Key">
            {KEY_OPTIONS.map((k) => (
              <FacetRow
                key={k}
                label={k}
                count={countMatching('key', k, filters, query)}
                state={dimensionState(filters.key, k)}
                onChange={(next) => onChange({ ...filters, key: setDimensionState(filters.key, k, next) })}
              />
            ))}
          </FacetSection>
        </div>

        {/* Just Clear now (2026-08-27) — live update means there's no
            "commit" step left for an Apply/Show-results button to do;
            results already reflect every checkbox the instant it's
            clicked. Clear stays because it's still a real time-saver over
            unchecking everything one at a time. */}
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

function FacetSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border py-3 last:border-b-0">
      {title && <p className="mb-1.5 text-xs font-semibold tracking-wide text-ink-soft uppercase">{title}</p>}
      <div className="flex flex-col">{children}</div>
    </div>
  )
}

function FacetRow({
  label,
  count,
  state,
  onChange,
}: {
  label: string
  count: number
  state: TriState
  onChange: (next: TriState) => void
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-md px-1 py-1.5 text-sm text-ink">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-xs text-ink-soft tabular-nums">{count}</span>
      <TriStateControl state={state} onChange={onChange} label={label} />
    </div>
  )
}

// Three real buttons, not one cycling toggle — a segmented control always
// shows all its own options at once (unlike the grid/list view toggle,
// which only ever needs 2), so a state is always one click away regardless
// of which of the other two is currently active, not buried behind however
// many clicks a cycle puts between them. Same bordered-pill shell the
// grid/list view toggle and SortControl.tsx already use (rounded-md border
// p-0.5, each segment its own rounded button), sized down (size-6/14px
// icons vs. their size-8/16px) to stay compact repeated down a long facet
// list. Exclude's red is the same text-red-700 this app already uses for
// every other destructive/negative affordance (delete buttons, validation
// errors) — extended here to "removes results" rather than "removes data,"
// which reads as the same family of action (this option makes something
// go away) even though nothing is actually deleted.
function TriStateControl({ state, onChange, label }: { state: TriState; onChange: (next: TriState) => void; label: string }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border p-0.5">
      <button
        type="button"
        onClick={() => onChange('exclude')}
        aria-label={`Exclude ${label}`}
        aria-pressed={state === 'exclude'}
        className={`flex size-6 cursor-pointer items-center justify-center rounded ${
          state === 'exclude' ? 'bg-red-50 text-red-700' : 'text-ink-soft hover:bg-paper-sunken hover:text-ink'
        }`}
      >
        <IconMinus size={14} />
      </button>
      <button
        type="button"
        onClick={() => onChange('neutral')}
        aria-label={`Clear ${label} filter`}
        aria-pressed={state === 'neutral'}
        className={`flex size-6 cursor-pointer items-center justify-center rounded ${
          state === 'neutral' ? 'bg-paper-sunken text-ink' : 'text-ink-soft hover:bg-paper-sunken hover:text-ink'
        }`}
      >
        <IconSlash size={14} />
      </button>
      <button
        type="button"
        onClick={() => onChange('include')}
        aria-label={`Include ${label}`}
        aria-pressed={state === 'include'}
        className={`flex size-6 cursor-pointer items-center justify-center rounded ${
          state === 'include' ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-paper-sunken hover:text-ink'
        }`}
      >
        <IconPlus size={14} />
      </button>
    </div>
  )
}

function pieceMatches(p: MockPiece, f: FilterState): boolean {
  return matchesFiltersExcept(p, f, null, '')
}

// id doubles as a stand-in for "date added" — this fixture has no real
// timestamp field, and PIECES is already in insertion order, so a higher
// id is a later addition, same as a real piece's own id would be.
function sortPieces(pieces: MockPiece[], field: SortField, direction: SortDirection): MockPiece[] {
  const sorted = [...pieces]
  if (field === 'Title') sorted.sort((a, b) => a.title.localeCompare(b.title))
  else if (field === 'Composer') sorted.sort((a, b) => a.composer.localeCompare(b.composer))
  else if (field === 'Year Written') {
    // Blank years always trail, regardless of direction — the real
    // backend's own pieceSortColumns (internal/handlers/search.go) applies
    // this same direction-invariant rule so a year-less piece doesn't jump
    // to the front of an ascending sort.
    const withYear = sorted.filter((p) => p.yearWritten !== '')
    const withoutYear = sorted.filter((p) => p.yearWritten === '')
    withYear.sort((a, b) => Number(a.yearWritten) - Number(b.yearWritten))
    if (direction === 'desc') withYear.reverse()
    return [...withYear, ...withoutYear]
  } else sorted.sort((a, b) => a.id - b.id)
  if (direction === 'desc') sorted.reverse()
  return sorted
}

// Real TagPills.tsx order/content, ported by hand (no shared import —
// every mockup route in this codebase is deliberately self-contained,
// same convention BookDetailsSample.tsx's own port of this component
// follows). Adapted for this fixture's singular key/instrument fields
// (MockPiece has one key and one instrument, not the real Piece's
// many-to-many arrays) — still renders through the same merged-pill-with-
// music-icon treatment a real single-key piece would get.
function MockTagPills({ piece }: { piece: MockPiece }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <span className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
        <PracticeStatusIcon status={piece.practiceStatus} size={11} className="shrink-0" />
        {piece.practiceStatus}
      </span>
      {piece.userTags.map((tag) => (
        <span key={tag} className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
          {tag}
        </span>
      ))}
      <span className="flex min-w-0 max-w-full items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium whitespace-nowrap text-ink-soft">
        <IconMusic size={11} className="shrink-0" />
        <span className="truncate">{piece.key}</span>
      </span>
      <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-ink-soft">
        {piece.sheetType}
      </span>
      <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-ink-soft">
        {piece.instrument}
      </span>
    </div>
  )
}

// Real PageCycleControl.tsx, ported by hand — same "renders nothing at
// pageCount <= 1" rule (the common single-page-upload case), same
// disabled-not-wrapping behavior at the first/last page.
function MockPageCycleControl({
  page,
  pageCount,
  onChange,
}: {
  page: number
  pageCount: number
  onChange: (page: number) => void
}) {
  if (pageCount <= 1) return null
  return (
    <div className="flex items-center gap-1 text-ink-soft">
      <button
        type="button"
        onClick={() => page > 1 && onChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
        className="flex size-6 cursor-pointer items-center justify-center rounded hover:bg-accent-soft hover:text-accent disabled:pointer-events-none disabled:opacity-30"
      >
        <IconChevronLeft size={16} />
      </button>
      <span className="text-xs tabular-nums">
        {page} / {pageCount}
      </span>
      <button
        type="button"
        onClick={() => page < pageCount && onChange(page + 1)}
        disabled={page >= pageCount}
        aria-label="Next page"
        className="flex size-6 cursor-pointer items-center justify-center rounded hover:bg-accent-soft hover:text-accent disabled:pointer-events-none disabled:opacity-30"
      >
        <IconChevronRightFilled size={16} />
      </button>
    </div>
  )
}

// One row = one piece of local state (the currently-shown page), same
// reason PieceListCard.tsx is its own component and not inlined in a
// .map() — a hook can't live inside a loop callback.
function PieceListRow({ piece }: { piece: MockPiece }) {
  const [page, setPage] = useState(1)
  return (
    <div className="flex w-full cursor-pointer flex-col overflow-hidden rounded-lg border border-border bg-paper-raised p-3 text-left transition-colors hover:border-accent">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex min-w-0 items-center gap-1.5 font-display text-lg font-medium text-ink">
            <span className="truncate">{piece.title}</span>
            {piece.favorite && (
              <span className="shrink-0 text-accent">
                <IconHeartFilled size={13} />
              </span>
            )}
          </p>
          <p className="text-sm text-ink-soft">{piece.composer}</p>
        </div>
        {/* 134×84 box, matching PieceListCard's real <img> sizing exactly
            (h-[84px] w-auto, object-contain — no forced crop) — the
            placeholder SVG's own 180:132 ratio at 84px tall computes to
            ~114.5px wide, so the box is sized to that rather than the
            full 134px column, same as a real narrower-than-180:132 scan
            wouldn't fill the column either. */}
        <div className="flex w-[134px] shrink-0 justify-center">
          <div className="h-[84px] w-[114.5px] overflow-hidden rounded-md border border-border">
            <PieceThumb seed={piece.id} />
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center border-t border-border pt-2">
        <MockTagPills piece={piece} />
        <div className="ml-auto flex w-[134px] shrink-0 justify-center">
          <MockPageCycleControl page={page} pageCount={piece.pageCount} onChange={setPage} />
        </div>
      </div>
    </div>
  )
}

type ViewMode = 'grid' | 'list'

export function PieceLibrarySample() {
  useMockupTitle('Piece Library')

  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [sortField, setSortField] = useState<SortField>('Date Added')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Live update (changed 2026-08-27, was draft-then-"Show results" —
  // see the Filter Studies comparison artifact's own Option B writeup for
  // the original reasoning). Every checkbox writes straight to
  // appliedFilters, no separate draft state — results, the pill row, and
  // the Filters badge count all update the instant a box is checked,
  // matching the app's existing "no Apply button" search-as-you-type
  // convention. One real cost worth remembering once this is wired to
  // the real backend: search-as-you-type debounces its query (design doc
  // §11), and this should too — toggling several boxes in quick
  // succession would otherwise fire a real request per click.
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(EMPTY_FILTERS)

  const filtered = PIECES.filter(
    (p) => pieceMatches(p, appliedFilters) && (!query.trim() || p.title.toLowerCase().includes(query.trim().toLowerCase())),
  )
  const pieces = sortPieces(filtered, sortField, sortDirection)
  const activeCount = activeFilterCount(appliedFilters)

  function clearAppliedFilter(field: keyof FilterState, value?: string) {
    if (field === 'favorite' || field === 'bookless' || field === 'hasImslpNumber') {
      setAppliedFilters((f) => ({ ...f, [field]: 'neutral' }))
      return
    }
    setAppliedFilters((f) => ({ ...f, [field]: setDimensionState(f[field] as Record<string, TriState>, value!, 'neutral') }))
  }

  const pillEntries: { field: keyof FilterState; value?: string; label: string; state: TriState }[] = [
    ...(appliedFilters.favorite !== 'neutral'
      ? [{ field: 'favorite' as const, label: 'Favorites', state: appliedFilters.favorite }]
      : []),
    ...(appliedFilters.bookless !== 'neutral'
      ? [{ field: 'bookless' as const, label: 'Bookless pieces', state: appliedFilters.bookless }]
      : []),
    ...(appliedFilters.hasImslpNumber !== 'neutral'
      ? [{ field: 'hasImslpNumber' as const, label: 'Has IMSLP number', state: appliedFilters.hasImslpNumber }]
      : []),
    ...Object.entries(appliedFilters.key).map(([v, state]) => ({ field: 'key' as const, value: v, label: v, state })),
    ...Object.entries(appliedFilters.instrument).map(([v, state]) => ({
      field: 'instrument' as const,
      value: v,
      label: v,
      state,
    })),
    ...Object.entries(appliedFilters.sheetType).map(([v, state]) => ({
      field: 'sheetType' as const,
      value: v,
      label: v,
      state,
    })),
    ...Object.entries(appliedFilters.userTags).map(([v, state]) => ({
      field: 'userTags' as const,
      value: v,
      label: v,
      state,
    })),
    ...Object.entries(appliedFilters.status).map(([v, state]) => ({
      field: 'status' as const,
      value: v,
      label: v,
      state,
    })),
  ]

  return (
    <div className="flex flex-1 flex-col">
      <div className="p-4 pb-0">
        <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
          Design mockup — <span className="font-medium text-ink">Piece Library sort/filter</span>. Option B
          (Filter Drawer) from the sort/filter comparison. Search, Filters, Sort, and the grid/list toggle
          are all genuinely interactive against the 10 fixture pieces below; cards aren't real links.
        </div>
      </div>

      {/* z-20, matching the real PieceBrowseView.tsx fix (2026-08-28) — the
          grid's practice-status badge is z-10 with no positioned ancestor
          of its own, so it ties with (and DOM-order-wins over) a z-10
          toolbar during scroll. */}
      <div className="sticky top-0 z-20 border-b border-border bg-paper">
        {/* Capped to the same width as the content grid below, not
            full-bleed — view toggle / search / Filters+Sort would
            otherwise spread across the full remaining width, drifting
            away from the (already-capped) card grid underneath.
            Left–center–right via a real grid, not flex: the left and
            right groups are different widths (toggle vs. Filters+Sort),
            so flex's justify-between would leave Search off-center.

            Column sizing, current state: toggle is `auto` (simple
            icon-pair content, sizes accurately) and Filters+Sort is an
            exact directly-measured px value per label-visibility tier
            (`211px`/`255px`, "Filters" being icon-only vs. full-text) —
            both non-flexible, deliberately. Only Search's own column is
            `1fr`, absorbing 100% of any leftover row width; its wrapper's
            own `max-w-xl` caps how wide it actually renders, and
            `justify-self-center` centers it within its (possibly much
            wider) track once leftover space exceeds that cap. This
            specific split (one real `1fr` column, two rigid ones) is
            deliberate, not incidental — an earlier version gave
            Filters+Sort its own `minmax(Npx,1fr)` too, which let it claim
            leftover space independently of the toggle's own `1fr` share
            rather than the two splitting it evenly, silently drifting
            Filters rightward as the viewport widened (confirmed via
            direct measurement: the gap before Filters grew from 22px to
            367px while the gap after the toggle stayed a flat 12px the
            whole time — a real bug, not intended). The two fixed floor
            values are the *exact* measured content width (plus ~1px),
            not a padded guess — an earlier ~10px safety margin was
            itself the source of a small constant (not growing) gap in
            front of Filters even below Search's cap, where the row's
            uniform gap-3 should be the only spacing.

            Confirmed this design's growing-but-symmetric gap around
            Search (once it's at its 576px cap and the bar has more room
            than the toolbar's content needs) is the intended behavior —
            asked directly rather than assumed, since it's a real design
            choice, not a bug: the toolbar stays capped+centered as a
            whole (matching the content grid), Search likewise centers
            within it, and toggle/Filters+Sort stay pinned to their own
            sides. `searchWidth` grows continuously as the viewport
            widens (reaching 576 by ~1200px and holding), never jumping
            at a breakpoint — confirmed via a full 640–1920px sweep.

            The icon-only Filters button carries an explicit `h-[38px]`
            rather than padding-driven auto-height — that's the real
            shared height every neighbor in this row renders at (toggle
            and Sort control both wrap their inner buttons in their own
            bordered shell, adding 2px beyond the 36px those inner buttons
            report on their own), confirmed via direct measurement rather
            than assumed from the padding recipe alone.

            Below `sm:`, 2 explicit grid rows instead of a plain
            single-column stack (direct request) — toggle and Filters+Sort
            share the first row (still left/right-aligned), Search alone
            spans both columns below. "Filters" shows its full text label
            here too (this row has no Search competing for its space, and
            a real sweep down to 350px confirmed the full label fits at
            every real target width down to the 375px phone minimum) —
            hidden again only in the squeezed `sm:`–`2xl:` band where
            Search *does* share the row, and back once `2xl:` gives
            everything room again. `2xl:` (1536px) stands in for this
            app's actual measured ~1400px problem threshold — a custom
            `min-[1400px]:` arbitrary breakpoint was tried first, but
            doesn't reliably sort against a *named* one (`sm:`) in this
            project's Tailwind build (confirmed directly in the compiled
            stylesheet: the arbitrary rule landed *before* `sm:`'s in
            source order, so `sm:` silently won past both thresholds).
            Two real named breakpoints don't have that problem.

            Full narrative for all of the above (every dead end, every
            wrong first guess) is in memory `project_responsive_device_
            plan.md`, not here — this comment states current behavior. */}
        <div className={`${WIDE_CONTENT_MAX_W} flex flex-col gap-3 p-4`}>
          <div className="grid grid-cols-[auto_1fr] items-center gap-3 sm:grid-cols-[auto_1fr_215px] 2xl:grid-cols-[auto_1fr_259px]">
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

            <div className="col-span-2 row-start-2 relative w-full justify-self-center sm:col-span-1 sm:row-start-auto sm:max-w-xl">
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

              <SortControl
                field={sortField}
                direction={sortDirection}
                onFieldChange={setSortField}
                onDirectionToggle={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
              />
            </div>
          </div>

          {pillEntries.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {pillEntries.map((entry) => {
                const excluded = entry.state === 'exclude'
                return (
                  <span
                    key={entry.field + (entry.value ?? '')}
                    className={`flex items-center gap-1.5 rounded-full py-1 pr-1.5 pl-3 text-xs font-medium ${
                      excluded ? 'bg-red-50 text-red-700' : 'bg-accent-soft text-accent'
                    }`}
                  >
                    {excluded ? `Not ${entry.label}` : entry.label}
                    <button
                      type="button"
                      onClick={() => clearAppliedFilter(entry.field, entry.value)}
                      aria-label={`Remove ${excluded ? 'not ' : ''}${entry.label} filter`}
                      className={`flex size-4 cursor-pointer items-center justify-center rounded-full opacity-75 hover:opacity-100 ${
                        excluded ? 'text-red-700' : 'text-accent'
                      }`}
                    >
                      <IconX size={11} />
                    </button>
                  </span>
                )
              })}
              <button
                type="button"
                onClick={() => setAppliedFilters(EMPTY_FILTERS)}
                className="cursor-pointer text-xs text-ink-soft underline decoration-dotted underline-offset-2 hover:text-ink"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      </div>

      <div className={`${WIDE_CONTENT_MAX_W} flex-1 p-4`}>
        <p className="mb-3 text-xs text-ink-soft tabular-nums">
          {pieces.length} {pieces.length === 1 ? 'piece' : 'pieces'}
        </p>

        {pieces.length === 0 && (
          <p className="p-8 text-center text-ink-soft">No pieces match these filters.</p>
        )}

        {pieces.length > 0 && viewMode === 'grid' && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4 sm:grid-cols-[repeat(auto-fill,minmax(176px,1fr))]">
            {pieces.map((piece) => (
              <div
                key={piece.id}
                className="flex cursor-pointer flex-col overflow-hidden rounded-lg border border-border bg-paper-raised text-left transition-colors hover:border-accent"
              >
                <div className="relative aspect-[180/132] w-full overflow-hidden border-b border-border bg-border">
                  <PieceThumb seed={piece.id} />
                  {/* Was missing here (found 2026-08-28 double-checking
                      this view against the real PieceGridCard.tsx) — the
                      soft white scrim behind the badge, so it stays
                      legible against real, varied scan/cover artwork
                      rather than just this mockup's own light placeholder
                      thumbnails, which happened to not need it. */}
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 bg-[linear-gradient(to_top,rgba(255,255,255,0.55)_0%,rgba(255,255,255,0.1925)_32%,rgba(255,255,255,0)_62%)]"
                  />
                  <span className="absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-3rem)] items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent shadow-sm">
                    <PracticeStatusIcon status={piece.practiceStatus} size={13} className="shrink-0" />
                    <span className="truncate">{piece.practiceStatus}</span>
                  </span>
                </div>
                <div className="flex flex-col gap-1 p-3">
                  <p className="flex min-w-0 items-center gap-1.5 font-display text-sm font-medium text-ink">
                    <span className="truncate">{piece.title}</span>
                    {piece.favorite && (
                      <span className="shrink-0 text-accent">
                        <IconHeartFilled size={13} />
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-ink-soft">{piece.composer}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {pieces.length > 0 && viewMode === 'list' && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(576px,100%),768px))] justify-center gap-3">
            {pieces.map((piece) => (
              <PieceListRow key={piece.id} piece={piece} />
            ))}
          </div>
        )}

        {/* Spacing-only match for PieceBrowseView.tsx's own infinite-scroll
            sentinel (found missing here 2026-08-27 — this mockup's
            fixture has no pagination to actually intersection-observe,
            but the real page's p-4 sentinel div still occupies this much
            space below the grid even at rest/empty, and skipping it left
            this mockup sitting noticeably tighter against the footer than
            the real page does). */}
        {pieces.length > 0 && <div className="p-4" />}
      </div>

      <FilterDrawer
        open={drawerOpen}
        filters={appliedFilters}
        query={query}
        onChange={setAppliedFilters}
        onClose={() => setDrawerOpen(false)}
        onClear={() => setAppliedFilters(EMPTY_FILTERS)}
      />
    </div>
  )
}
