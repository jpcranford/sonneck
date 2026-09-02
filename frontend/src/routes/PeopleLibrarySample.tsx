import { useRef, useState, type KeyboardEvent } from 'react'
import { useForm } from 'react-hook-form'
import {
  IconAdjustmentsHorizontal,
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronRight,
  IconLayoutGridFilled,
  IconLayoutListFilled,
  IconPlus,
  IconSearch,
  IconX,
  IconXFilled,
} from '@tabler/icons-react'
import { ContextMenu } from '../components/ContextMenu'
import { InfoTooltip } from '../components/InfoTooltip'
import { Modal } from '../components/Modal'
import { PALETTE } from '../lib/pieceSplitLogic'
import { useMockupTitle } from '../lib/useMockupTitle'

// ---------------------------------------------------------------------
// DESIGN MOCKUP for the People Library page (Phase 3 of the composer/
// arranger overhaul — see the approved Phase 1/2 Artifacts for the shape/
// layout decisions this ports into a real, interactive route: People
// Library https://claude.ai/code/artifact/7ccc402f-c3d3-4e48-9b29-49eeeb717e92
// and Person Details https://claude.ai/code/artifact/ba5e0a91-b177-4f79-b6f6-bf9d1de0bad8).
// Same toolbar/grid/list/Filter-Drawer/Sort shell as
// PieceLibrarySample.tsx/BooksLibrarySample.tsx — the genuinely new part
// is the Person card itself (oval thumbnail, locked in Phase 1) and the
// "Show all composers" default filter. Not wired to the API; cards aren't
// real links (Person Details doesn't exist as a real route yet — that's
// Phase 4).
// ---------------------------------------------------------------------

interface MockPerson {
  id: number
  name: string
  birthYear: number | null
  deathYear: number | null
  pieceCount: number
  avatarKind: 'initials' | 'bust'
  paletteIndex: number
}

// Same 17-person set (same names, piece counts, death years) as the
// approved Phase 1 artifact, for continuity across the whole design/
// mockup arc — birthYear added on top, per direct feedback on Phase 2
// that both years (not just death) belong on a Person. The last four
// (≤2 pieces, no years — standing in for a generic/placeholder arranger
// entry) are what "Show all composers" reveals.
const MOCK_PEOPLE: MockPerson[] = [
  { id: 1, name: 'Johann Sebastian Bach', birthYear: 1685, deathYear: 1750, pieceCount: 47, avatarKind: 'initials', paletteIndex: 0 },
  { id: 2, name: 'Wolfgang Amadeus Mozart', birthYear: 1756, deathYear: 1791, pieceCount: 31, avatarKind: 'bust', paletteIndex: 1 },
  { id: 3, name: 'Frédéric Chopin', birthYear: 1810, deathYear: 1849, pieceCount: 28, avatarKind: 'initials', paletteIndex: 2 },
  { id: 4, name: 'Ludwig van Beethoven', birthYear: 1770, deathYear: 1827, pieceCount: 19, avatarKind: 'bust', paletteIndex: 3 },
  { id: 5, name: 'Johannes Brahms', birthYear: 1833, deathYear: 1897, pieceCount: 12, avatarKind: 'initials', paletteIndex: 4 },
  { id: 6, name: 'Clara Schumann', birthYear: 1819, deathYear: 1896, pieceCount: 9, avatarKind: 'initials', paletteIndex: 5 },
  { id: 7, name: 'Claude Debussy', birthYear: 1862, deathYear: 1918, pieceCount: 8, avatarKind: 'bust', paletteIndex: 6 },
  { id: 8, name: 'J. Burgmüller', birthYear: 1806, deathYear: 1874, pieceCount: 6, avatarKind: 'initials', paletteIndex: 7 },
  { id: 9, name: 'Theodor Kirchner', birthYear: 1823, deathYear: 1903, pieceCount: 5, avatarKind: 'initials', paletteIndex: 8 },
  { id: 10, name: 'Camille Saint-Saëns', birthYear: 1835, deathYear: 1921, pieceCount: 4, avatarKind: 'bust', paletteIndex: 9 },
  { id: 11, name: 'Edvard Grieg', birthYear: 1843, deathYear: 1907, pieceCount: 3, avatarKind: 'initials', paletteIndex: 0 },
  { id: 12, name: 'W. S. Gilbert', birthYear: 1836, deathYear: 1911, pieceCount: 7, avatarKind: 'initials', paletteIndex: 1 },
  { id: 13, name: 'Arthur Sullivan', birthYear: 1842, deathYear: 1900, pieceCount: 7, avatarKind: 'bust', paletteIndex: 2 },
  { id: 14, name: 'M. Alexandrov', birthYear: null, deathYear: null, pieceCount: 2, avatarKind: 'initials', paletteIndex: 3 },
  { id: 15, name: 'S. Reyes', birthYear: null, deathYear: null, pieceCount: 1, avatarKind: 'initials', paletteIndex: 4 },
  { id: 16, name: 'R. Nakamura', birthYear: null, deathYear: null, pieceCount: 2, avatarKind: 'initials', paletteIndex: 5 },
  { id: 17, name: 'K. Alvarez', birthYear: null, deathYear: null, pieceCount: 1, avatarKind: 'initials', paletteIndex: 6 },
  // Demonstrates nameSortKey below (quoted-nickname sort) — sorted by
  // Name, this must land among the "J"s, not before "A" as a naive
  // string comparison against the literal leading quote would put it.
  { id: 18, name: '"Jelly Roll" Morton', birthYear: 1890, deathYear: 1941, pieceCount: 3, avatarKind: 'bust', paletteIndex: 7 },
]

// Same partial-case rule worked out on the Person Details artifact: both
// years known reads as a plain range, only one known falls back to a
// "b."/"d." prefix so it isn't mistaken for the other one, neither known
// omits the fragment entirely (same blank-field convention as everywhere
// else in the app, not a placeholder dash).
function formatLifespan(person: MockPerson): string | null {
  if (person.birthYear && person.deathYear) return `${person.birthYear}–${person.deathYear}`
  if (person.deathYear) return `d. ${person.deathYear}`
  if (person.birthYear) return `b. ${person.birthYear}`
  return null
}

function piecesLabel(person: MockPerson): string {
  return `${person.pieceCount} ${person.pieceCount === 1 ? 'piece' : 'pieces'}`
}

function metaLine(person: MockPerson): string {
  const lifespan = formatLifespan(person)
  return lifespan ? `${lifespan} • ${piecesLabel(person)}` : piecesLabel(person)
}

function initials(name: string): string {
  const letters = name
    .replace(/[^\w\s.À-ɏ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace('.', '')[0])
    .filter(Boolean)
  if (letters.length === 0) return '?'
  if (letters.length === 1) return letters[0].toUpperCase()
  return (letters[0] + letters[letters.length - 1]).toUpperCase()
}

// Hand-authored bust silhouette (no AI-generated art — CLAUDE.md > No AI-
// generated assets), identical formula to both approved Artifacts' own
// placeholder: a circle head + one smooth bezier for the shoulders, in a
// viewBox that scales to fill whatever size container it's dropped into.
function BustSilhouette() {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMax slice" className="h-full w-full">
      <circle cx="50" cy="40" r="17" fill="rgba(255,255,255,0.92)" />
      <path d="M14 100c0-22 16-34 36-34s36 12 36 34" fill="rgba(255,255,255,0.92)" />
    </svg>
  )
}

// The one genuinely new visual decision this whole overhaul needed a
// comparison Artifact for — Oval, locked 2026-08-30 (see the People
// Library artifact's own shape-switcher). aspect-[3/4] + a true 50%
// border-radius is what actually produces an oval from a portrait-ratio
// box. Real bug found live (2026-08-30): Tailwind's `rounded-full`
// resolves to a fixed huge *pixel* radius (`calc(infinity * 1px)`), not a
// percentage — on a non-square box that clips to a stadium/pill shape
// (flat sides, semicircular caps), not an ellipse, since the corner
// radius gets capped at half the *shorter* side regardless of the box's
// own aspect ratio. `rounded-[50%]` forces the percentage form instead,
// which CSS computes independently per axis (50% of width, 50% of
// height), producing a true ellipse inscribed in the box — this is what
// both approved Artifacts already used directly as raw CSS
// (`border-radius: 50%`), so the mismatch was mockup-only, not a design
// regression.
function PersonAvatar({ person, className }: { person: MockPerson; className: string }) {
  const color = PALETTE[person.paletteIndex % PALETTE.length]
  return (
    <div
      className={`relative aspect-[3/4] overflow-hidden rounded-[50%] border border-border [container-type:inline-size] ${className}`}
      style={{ backgroundColor: color }}
    >
      {person.avatarKind === 'bust' ? (
        <BustSilhouette />
      ) : (
        // Sized in container-query units (% of this avatar's own rendered
        // width, via [container-type:inline-size] above), not a fixed rem
        // size — PersonAvatar renders at very different sizes depending on
        // caller (~150px grid card vs. ~44px list row), and a fixed size
        // would read as oversized at one and tiny at the other.
        <div className="flex h-full w-full items-center justify-center font-display font-medium text-white text-[26cqw]">
          {initials(person.name)}
        </div>
      )}
    </div>
  )
}

// Edit/Delete, same shape as BookContextMenu.tsx — Delete is real against
// this mockup's own local state (cheap, harmless, and demonstrates the
// interaction fully); Edit is a stub for now, since the real Edit Person
// modal doesn't exist as a mockup yet (that's Phase 5) and Person Details
// itself doesn't either (Phase 4) — right-clicking a card today can only
// prove the menu itself, not open anything real.
function PersonContextMenu({
  person,
  onDelete,
  children,
}: {
  person: MockPerson
  onDelete: () => void
  children: React.ReactNode
}) {
  return (
    <ContextMenu
      hideTriggerButton
      items={[
        { label: 'Edit Person', onSelect: () => {} },
        {
          label: 'Delete Person',
          destructive: true,
          onSelect: () => {
            if (window.confirm(`Delete "${person.name}"? This can't be undone.`)) onDelete()
          },
        },
      ]}
    >
      {children}
    </ContextMenu>
  )
}

// ---- Grid card ----
function PersonGridCard({ person, onDelete }: { person: MockPerson; onDelete: () => void }) {
  const lifespan = formatLifespan(person)
  return (
    <PersonContextMenu person={person} onDelete={onDelete}>
      {/* Centered under the portrait (direct instruction) — a deliberate
          break from the Book/Piece grid card convention (left-aligned),
          since a name/dates lockup under a portrait reads as a caption,
          not a list item, the same reasoning a museum placard or a
          contact card centers its own text under a photo. Lifespan and
          piece count get their own line each rather than one bullet-
          joined line — "pieces" is the least identity-defining fact here,
          so it reads better as a quieter second line than sharing a row
          with the dates. */}
      <div className="flex cursor-pointer flex-col items-center gap-2 text-center">
        <PersonAvatar
          person={person}
          className="w-full shadow-sm transition-shadow hover:shadow-lg"
        />
        <div className="flex flex-col gap-0.5">
          <p className="line-clamp-2 font-display text-sm font-medium text-ink">{person.name}</p>
          {lifespan && <p className="truncate text-xs text-ink-soft">{lifespan}</p>}
          <p className="truncate text-xs text-ink-soft">{piecesLabel(person)}</p>
        </div>
      </div>
    </PersonContextMenu>
  )
}

// ---- List row ----
function PersonListRow({ person, onDelete }: { person: MockPerson; onDelete: () => void }) {
  return (
    <PersonContextMenu person={person} onDelete={onDelete}>
      <div className="flex cursor-pointer items-center gap-4 rounded-md px-2 py-2.5 text-left hover:bg-accent-soft">
        <PersonAvatar person={person} className="w-11 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-base font-medium text-ink">{person.name}</p>
          <p className="truncate text-sm text-ink-soft">{metaLine(person)}</p>
        </div>
        <IconChevronRight size={18} className="shrink-0 text-[#aca7a1]" />
      </div>
    </PersonContextMenu>
  )
}

// ---------------------------------------------------------------------
// Filter drawer — "Show only" is the one section this library needs
// (design doc's own filter drawer convention, PieceFilterDrawer.tsx):
// "Show all composers" plus an info button explaining the default >2-
// piece threshold, exactly as specced. No relational facets the way
// Piece/Book have (Key/Instrument/Sheet Type don't apply to a Person).
// ---------------------------------------------------------------------

interface PersonFilterState {
  showAll: boolean
  era: string[]
  centuries: number[]
}
const EMPTY_PERSON_FILTERS: PersonFilterState = { showAll: false, era: [], centuries: [] }

function toggleInArray<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]
}

// Musical era: a coarse, single-bucket classification (Baroque/Classical/
// Romantic/Modern/Contemporary — the standard music-history convention),
// not a stored field on Person — "should be very minimal" per the
// original brief, and a real person's actual stylistic era isn't reliably
// derivable from birth/death years alone anyway (Beethoven straddles
// Classical/Romantic; this picks one bucket, not a scholarly claim).
// Computed from the midpoint of the birth/death span (falling back to
// whichever single year is known) — same "small, checked-in, approximate
// table, not an authoritative external source" posture as the deferred
// public-domain feature's own copyright-region table (design doc §13).
const ERA_ORDER = ['Renaissance & Earlier', 'Baroque', 'Classical', 'Romantic', 'Modern', 'Contemporary'] as const
type Era = (typeof ERA_ORDER)[number]

function getEra(person: MockPerson): Era | null {
  const year =
    person.birthYear && person.deathYear
      ? Math.round((person.birthYear + person.deathYear) / 2)
      : (person.birthYear ?? person.deathYear)
  if (year === null) return null
  if (year < 1600) return 'Renaissance & Earlier'
  if (year < 1750) return 'Baroque'
  if (year < 1820) return 'Classical'
  if (year < 1900) return 'Romantic'
  if (year < 2000) return 'Modern'
  return 'Contemporary'
}

// Century filter: every century a person's lifespan actually *touches*,
// not just the century they were born or died in (direct instruction) —
// Beethoven (1770-1827) matches both 18th and 19th century. A single known
// year (birth or death alone) still matches its own one century; neither
// known matches none.
function century(year: number): number {
  return Math.ceil(year / 100)
}
function getCenturies(person: MockPerson): number[] {
  if (person.birthYear && person.deathYear) {
    const first = century(person.birthYear)
    const last = century(person.deathYear)
    return Array.from({ length: last - first + 1 }, (_, i) => first + i)
  }
  const only = person.birthYear ?? person.deathYear
  return only ? [century(only)] : []
}
function ordinal(n: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`
}

function distinctEras(): Era[] {
  return ERA_ORDER.filter((era) => MOCK_PEOPLE.some((p) => getEra(p) === era))
}
function countEra(era: Era): number {
  return MOCK_PEOPLE.filter((p) => getEra(p) === era).length
}
function distinctCenturies(): number[] {
  const values = new Set<number>()
  MOCK_PEOPLE.forEach((p) => getCenturies(p).forEach((c) => values.add(c)))
  return [...values].sort((a, b) => a - b)
}
function countCentury(c: number): number {
  return MOCK_PEOPLE.filter((p) => getCenturies(p).includes(c)).length
}

function activePersonFilterCount(f: PersonFilterState): number {
  return (f.showAll ? 1 : 0) + f.era.length + f.centuries.length
}

function FacetSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border py-3 last:border-b-0">
      <p className="mb-1.5 text-xs font-semibold tracking-wide text-ink-soft uppercase">{title}</p>
      <div className="flex flex-col">{children}</div>
    </div>
  )
}
function FacetRow({
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

function PersonFilterDrawer({
  open,
  filters,
  onChange,
  onClose,
}: {
  open: boolean
  filters: PersonFilterState
  onChange: (next: PersonFilterState) => void
  onClose: () => void
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
          <FacetSection title="Show only">
            <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1.5 text-sm text-ink hover:bg-paper-sunken">
              <input
                type="checkbox"
                checked={filters.showAll}
                onChange={() => onChange({ ...filters, showAll: !filters.showAll })}
                className="accent-accent"
              />
              <span className="flex flex-1 items-center gap-1.5">
                Show all composers
                <InfoTooltip
                  message="By default, only people credited on more than 2 pieces are shown, so one-off arrangers and duplicate/misspelled entries from older data don't clutter this list. Check this to see everyone."
                  ariaLabel="What does this mean?"
                  triggerClassName="flex size-4 items-center justify-center rounded-full border border-ink-soft/60 text-[0.6rem] font-bold text-ink-soft"
                >
                  i
                </InfoTooltip>
              </span>
            </label>
          </FacetSection>

          <FacetSection title="Musical Era">
            {distinctEras().map((era) => (
              <FacetRow
                key={era}
                label={era}
                count={countEra(era)}
                checked={filters.era.includes(era)}
                onChange={() => onChange({ ...filters, era: toggleInArray(filters.era, era) })}
              />
            ))}
          </FacetSection>

          <FacetSection title="Century">
            {distinctCenturies().map((c) => (
              <FacetRow
                key={c}
                label={`${ordinal(c)} century`}
                count={countCentury(c)}
                checked={filters.centuries.includes(c)}
                onChange={() => onChange({ ...filters, centuries: toggleInArray(filters.centuries, c) })}
              />
            ))}
          </FacetSection>
        </div>
      </aside>
    </>
  )
}

// ---------------------------------------------------------------------
// Sort — direct port of BookSortControl/PieceLibrarySample's own segmented
// field+direction button.
// ---------------------------------------------------------------------

const PERSON_SORT_FIELDS = ['Name', 'Piece Count', 'Birth Year', 'Death Year', 'Date Added'] as const
type PersonSortField = (typeof PERSON_SORT_FIELDS)[number]
type SortDirection = 'asc' | 'desc'

const PERSON_DIRECTION_LABEL: Record<PersonSortField, Record<SortDirection, string>> = {
  Name: { asc: 'A to Z', desc: 'Z to A' },
  'Piece Count': { asc: 'Fewest first', desc: 'Most first' },
  'Birth Year': { asc: 'Earliest first', desc: 'Latest first' },
  'Death Year': { asc: 'Earliest first', desc: 'Latest first' },
  'Date Added': { asc: 'Oldest first', desc: 'Newest first' },
}

function PersonSortControl({
  field,
  direction,
  onFieldChange,
  onDirectionToggle,
}: {
  field: PersonSortField
  direction: SortDirection
  onFieldChange: (v: PersonSortField) => void
  onDirectionToggle: () => void
}) {
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const directionLabel = PERSON_DIRECTION_LABEL[field][direction]

  function openMenu() {
    const i = PERSON_SORT_FIELDS.indexOf(field)
    setHighlightedIndex(i >= 0 ? i : 0)
    setOpen(true)
  }
  function select(opt: PersonSortField) {
    onFieldChange(opt)
    setOpen(false)
  }
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) openMenu()
      else setHighlightedIndex((i) => (i + 1) % PERSON_SORT_FIELDS.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) openMenu()
      else setHighlightedIndex((i) => (i - 1 + PERSON_SORT_FIELDS.length) % PERSON_SORT_FIELDS.length)
    } else if ((event.key === 'Enter' && !event.shiftKey) || event.key === ' ') {
      if (open) {
        event.preventDefault()
        select(PERSON_SORT_FIELDS[highlightedIndex])
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
          {direction === 'asc' ? <IconArrowUp size={15} /> : <IconArrowDown size={15} />}
        </button>
      </div>
      {open && (
        <div className="absolute z-10 mt-1 w-full min-w-[150px] overflow-hidden rounded-md border border-border bg-paper-raised py-1 shadow-lg">
          {PERSON_SORT_FIELDS.map((opt, index) => (
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

// A person's birth/death year can be null (the 4 generic-arranger fixture
// entries have neither) — a null always sorts last, *regardless* of
// direction, same "direction-invariant blank-field placement" rule the
// real backend already uses for Book's Year Written sort (CLAUDE.md >
// Library sort/filter). Baking `dir` into every comparator (rather than
// sorting ascending and calling .reverse() on 'desc', this function's own
// previous approach) is what makes that possible — a plain reverse() would
// flip a null-last array into null-*first*, and would also flip the
// relative order of tied elements, which a comparator-based sort is
// otherwise stable against.
function compareNullableYearLast(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return (a - b) * dir
}

// A person entered with a nickname in quotes — "Jelly Roll" Morton — must
// still sort under "J", not collate as if the quote itself were the first
// letter. Mirrors the real backend's own quoteStrippedSQL (people.go):
// strips a single leading straight or curly-opening double quote, nothing
// more (a closing quote is never the first character of a real name).
function nameSortKey(name: string): string {
  return /^["“]/.test(name) ? name.slice(1) : name
}

function sortPeople(people: MockPerson[], field: PersonSortField, direction: SortDirection): MockPerson[] {
  const sorted = [...people]
  const dir = direction === 'asc' ? 1 : -1
  if (field === 'Name') sorted.sort((a, b) => nameSortKey(a.name).localeCompare(nameSortKey(b.name)) * dir)
  else if (field === 'Piece Count') sorted.sort((a, b) => (a.pieceCount - b.pieceCount) * dir)
  else if (field === 'Birth Year') sorted.sort((a, b) => compareNullableYearLast(a.birthYear, b.birthYear, dir))
  else if (field === 'Death Year') sorted.sort((a, b) => compareNullableYearLast(a.deathYear, b.deathYear, dir))
  else sorted.sort((a, b) => (a.id - b.id) * dir)
  return sorted
}

// ---------------------------------------------------------------------
// New Person — deliberately minimal (design doc §5's "no required fields
// beyond what's genuinely needed" reasoning, NewBookModal's own precedent
// above): just Name (required) and the two year fields. Bio/portrait
// belong to the real Edit Person modal (Phase 5), not creation.
// ---------------------------------------------------------------------

interface NewPersonFormValues {
  name: string
  birthYear: string
  deathYear: string
}

function NewPersonModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (values: NewPersonFormValues) => void
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<NewPersonFormValues>({ defaultValues: { name: '', birthYear: '', deathYear: '' } })

  function handleClose() {
    reset()
    onClose()
  }
  function onSubmit(data: NewPersonFormValues) {
    onCreate(data)
    reset()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      labelledBy="new-person-title"
      header={
        <div className="flex items-start justify-between gap-4">
          <h2 id="new-person-title" className="font-display text-2xl font-medium text-ink">
            New person
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
            form="new-person-form"
            className="rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90"
          >
            Create
          </button>
        </div>
      }
    >
      <form id="new-person-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="np-name" className="text-sm text-ink-soft">
            Name <span className="text-ink-soft/60 italic">(Required)</span>
          </label>
          <input
            id="np-name"
            autoFocus
            className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
            {...register('name', { required: 'Name is required.', maxLength: 255 })}
          />
          {errors.name && <p className="text-sm text-red-700">{errors.name.message}</p>}
        </div>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="np-birth" className="text-sm text-ink-soft">
              Birth year
            </label>
            <input
              id="np-birth"
              inputMode="numeric"
              className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('birthYear')}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="np-death" className="text-sm text-ink-soft">
              Death year
            </label>
            <input
              id="np-death"
              inputMode="numeric"
              className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('deathYear')}
            />
          </div>
        </div>
      </form>
    </Modal>
  )
}

type ViewMode = 'grid' | 'list'

export function PeopleLibrarySample() {
  useMockupTitle('People Library')

  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [people, setPeople] = useState<MockPerson[]>(MOCK_PEOPLE)
  const [newPersonOpen, setNewPersonOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [filters, setFilters] = useState<PersonFilterState>(EMPTY_PERSON_FILTERS)
  const [sortField, setSortField] = useState<PersonSortField>('Name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const nextPersonId = useRef(1000)

  function handleCreatePerson(values: NewPersonFormValues) {
    const birthYear = values.birthYear.trim() ? Number(values.birthYear.trim()) : null
    const deathYear = values.deathYear.trim() ? Number(values.deathYear.trim()) : null
    setPeople((prev) => [
      {
        id: nextPersonId.current++,
        name: values.name.trim(),
        birthYear: Number.isFinite(birthYear) ? birthYear : null,
        deathYear: Number.isFinite(deathYear) ? deathYear : null,
        // A freshly created person has no credits yet, so they'd be
        // invisible under the default >2-piece filter — same reasoning as
        // NewBookModal's own pieceCount: 0, just made *visible* here
        // rather than hidden, since there'd be no other way to find a
        // just-created entry.
        pieceCount: 0,
        avatarKind: 'initials',
        paletteIndex: prev.length % PALETTE.length,
      },
      ...prev,
    ])
    setNewPersonOpen(false)
  }

  function handleDeletePerson(id: number) {
    setPeople((prev) => prev.filter((p) => p.id !== id))
  }

  function passesShowOnly(p: MockPerson): boolean {
    return filters.showAll || p.pieceCount > 2 || p.id >= 1000
  }
  function passesEra(p: MockPerson): boolean {
    if (filters.era.length === 0) return true
    const era = getEra(p)
    return era !== null && filters.era.includes(era)
  }
  function passesCentury(p: MockPerson): boolean {
    if (filters.centuries.length === 0) return true
    return getCenturies(p).some((c) => filters.centuries.includes(c))
  }

  const filtered = people.filter(
    (p) =>
      passesShowOnly(p) &&
      passesEra(p) &&
      passesCentury(p) &&
      (!query.trim() || p.name.toLowerCase().includes(query.trim().toLowerCase())),
  )
  const sortedPeople = sortPeople(filtered, sortField, sortDirection)
  // Scoped to the >2-piece default specifically (not era/century) — this
  // hint exists to explain *that* default, not to summarize every active
  // filter's effect.
  const hiddenCount = people.length - people.filter(passesShowOnly).length

  const activeFilterCount = activePersonFilterCount(filters)
  function clearFilterPill(field: 'era' | 'centuries', value: string | number) {
    setFilters((f) => ({
      ...f,
      [field]: (f[field] as (string | number)[]).filter((v) => v !== value),
    }))
  }
  const pillEntries: { field: 'era' | 'centuries'; value: string | number; label: string }[] = [
    ...filters.era.map((e) => ({ field: 'era' as const, value: e, label: e })),
    ...filters.centuries.map((c) => ({ field: 'centuries' as const, value: c, label: `${ordinal(c)} century` })),
  ]

  return (
    <div className="flex flex-1 flex-col">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-border bg-paper p-4">
        <div className="relative min-w-[180px] max-w-md flex-1">
          <IconSearch
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft"
          />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your people…"
            className="w-full rounded-md border border-border bg-paper-raised py-2 pr-3 pl-9 text-sm text-ink"
          />
        </div>

        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 text-sm active:border-accent active:text-accent ${
            activeFilterCount > 0
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-border bg-paper-raised text-ink hover:border-accent hover:text-accent'
          }`}
        >
          <IconAdjustmentsHorizontal size={16} />
          Filters
          {activeFilterCount > 0 && (
            <span className="flex size-4 items-center justify-center rounded-full bg-accent text-[0.65rem] font-semibold text-white">
              {activeFilterCount}
            </span>
          )}
        </button>

        <PersonSortControl
          field={sortField}
          direction={sortDirection}
          onFieldChange={setSortField}
          onDirectionToggle={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
        />

        <button
          type="button"
          onClick={() => setNewPersonOpen(true)}
          className="ml-auto flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-paper-raised px-3 py-2 text-sm text-ink hover:border-accent hover:text-accent active:border-accent active:text-accent"
        >
          <IconPlus size={16} />
          New Person
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
                  onClick={() => clearFilterPill(entry.field, entry.value)}
                  aria-label={`Remove ${entry.label} filter`}
                  className="flex size-4 cursor-pointer items-center justify-center rounded-full text-accent opacity-75 hover:opacity-100"
                >
                  <IconX size={11} />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => setFilters((f) => ({ ...f, era: [], centuries: [] }))}
              className="cursor-pointer text-xs text-ink-soft underline decoration-dotted underline-offset-2 hover:text-ink"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      <div className="p-4 pb-0">
        <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
          Design mockup — <span className="font-medium text-ink">People Library</span>. Search, Filters,
          Sort, grid/list, New Person, and right-click Delete are all genuinely interactive against 17
          fixture people. Cards aren't real links — Person Details (Phase 4) doesn't exist as a route yet.
        </div>
      </div>

      <div className="flex-1 p-4">
        <p className="mb-3 text-xs text-ink-soft tabular-nums">
          {sortedPeople.length} {sortedPeople.length === 1 ? 'person' : 'people'}
          {/* Bullet, not an interpunct — CLAUDE.md's own standing dot-
              separator convention, caught via a broader grep while fixing
              the same drift on PersonDetailsSample.tsx. */}
          {!filters.showAll && hiddenCount > 0 && ` • ${hiddenCount} hidden (see Filters)`}
        </p>

        {sortedPeople.length === 0 && <p className="p-8 text-center text-ink-soft">No people match these filters.</p>}

        {sortedPeople.length > 0 && viewMode === 'grid' && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-4 gap-y-6">
            {sortedPeople.map((person) => (
              <PersonGridCard key={person.id} person={person} onDelete={() => handleDeletePerson(person.id)} />
            ))}
          </div>
        )}

        {sortedPeople.length > 0 && viewMode === 'list' && (
          <div className="flex flex-col divide-y divide-border">
            {sortedPeople.map((person) => (
              <PersonListRow key={person.id} person={person} onDelete={() => handleDeletePerson(person.id)} />
            ))}
          </div>
        )}
      </div>

      <NewPersonModal open={newPersonOpen} onClose={() => setNewPersonOpen(false)} onCreate={handleCreatePerson} />

      <PersonFilterDrawer open={drawerOpen} filters={filters} onChange={setFilters} onClose={() => setDrawerOpen(false)} />
    </div>
  )
}
