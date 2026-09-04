import { useRef, useState, type KeyboardEvent } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  IconAdjustmentsHorizontal,
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconLayoutGridFilled,
  IconLayoutListFilled,
  IconPlus,
  IconSearch,
  IconX,
  IconXFilled,
} from '@tabler/icons-react'
import { createPerson, getPersonPortraitUrl, listPeople } from '../api/people'
import { ApiError } from '../api/client'
import type { Person, PersonCreateRequest } from '../api/types'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { afterMinDuration } from '../lib/minDuration'
import { PALETTE } from '../lib/pieceSplitLogic'
import { ClickableCard } from '../components/ClickableCard'
import { InfoTooltip } from '../components/InfoTooltip'
import { Modal } from '../components/Modal'
import { PersonContextMenu } from '../components/PersonContextMenu'
import { usePageTitle } from '../lib/usePageTitle'

// The real People Library (/people) — composer/arranger overhaul, Stage B.
// Real build of PeopleLibrarySample.tsx (/mockup/people-library, kept as a
// standing design reference) — same toolbar/grid/list/Filter Drawer/Sort
// shell as the Piece/Books Library, wired to the real /api/people endpoint
// instead of 17 fixture people. If the two ever look different, that's
// either a bug or a change that needs porting to both.
//
// Unlike the mockup's fixture people (which carry a hand-picked
// avatarKind: 'initials' | 'bust' for visual variety), a real Person has
// no such field — every avatar is either a real uploaded portrait
// (Person Details' own camera badge, Stage B/PersonDetailsPage.tsx) or
// plain initials, never the hand-authored bust silhouette. paletteIndex
// is derived from the person's own id (stable across reloads/re-sorts,
// unlike an array-index-based color which would shift with sort order),
// not tracked as its own field.

function formatLifespan(person: Person): string | null {
  if (person.birthYear && person.deathYear) return `${person.birthYear}–${person.deathYear}`
  if (person.deathYear) return `d. ${person.deathYear}`
  if (person.birthYear) return `b. ${person.birthYear}`
  return null
}

function piecesLabel(person: Person): string {
  return `${person.pieceCount} ${person.pieceCount === 1 ? 'piece' : 'pieces'}`
}

function metaLine(person: Person): string {
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

// Oval — aspect-[3/4] + rounded-[50%] (a true percentage border-radius,
// computed independently per axis), not rounded-full (a fixed huge pixel
// radius that clips a non-square box to a stadium shape, not an ellipse).
// Locked in the approved Phase 1/2 Artifacts; see PeopleLibrarySample.tsx's
// own comment for the real bug this fixed.
function PersonAvatar({ person, className }: { person: Person; className: string }) {
  const color = PALETTE[person.id % PALETTE.length]
  return (
    <div
      className={`relative aspect-[3/4] overflow-hidden rounded-[50%] border border-border [container-type:inline-size] ${className}`}
      style={{ backgroundColor: color }}
    >
      {person.hasCustomPortrait ? (
        <img
          src={getPersonPortraitUrl(person.id, person.portraitImageHash)}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center font-display font-medium text-white text-[26cqw]">
          {initials(person.name)}
        </div>
      )}
    </div>
  )
}

function PersonGridCard({ person }: { person: Person }) {
  const lifespan = formatLifespan(person)
  return (
    <PersonContextMenu person={person} hideTriggerButton>
      {/* Centered under the portrait — a name/dates lockup under a
          portrait reads as a caption, not a list item, same reasoning a
          museum placard or contact card centers its own text under a
          photo (locked in the Phase 1 artifact review). */}
      <ClickableCard
        to={`/people/${person.id}`}
        state={{ backLabel: 'People' }}
        className="flex flex-col items-center gap-2 text-center"
      >
        <PersonAvatar person={person} className="w-full shadow-sm transition-shadow hover:shadow-lg" />
        <div className="flex flex-col gap-0.5">
          <p className="line-clamp-2 font-display text-sm font-medium text-ink">{person.name}</p>
          {lifespan && <p className="truncate text-xs text-ink-soft">{lifespan}</p>}
          <p className="truncate text-xs text-ink-soft">{piecesLabel(person)}</p>
        </div>
      </ClickableCard>
    </PersonContextMenu>
  )
}

function PersonListRow({ person }: { person: Person }) {
  return (
    <PersonContextMenu person={person} hideTriggerButton>
      <ClickableCard
        to={`/people/${person.id}`}
        state={{ backLabel: 'People' }}
        className="flex items-center gap-4 rounded-md px-2 py-2.5 text-left hover:bg-accent-soft"
      >
        <PersonAvatar person={person} className="w-11 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-base font-medium text-ink">{person.name}</p>
          <p className="truncate text-sm text-ink-soft">{metaLine(person)}</p>
        </div>
      </ClickableCard>
    </PersonContextMenu>
  )
}

// ---------------------------------------------------------------------
// Filter drawer — same "Show only" + Musical Era + Century sections as
// the approved mockup. Era/Century are computed client-side (no backend
// facet endpoint for either — a Person's own dataset is small, same
// assumption Key/Instrument's fixed-list lookups already make), directly
// porting PeopleLibrarySample.tsx's own getEra/getCenturies/ordinal logic.
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

const ERA_ORDER = ['Renaissance & Earlier', 'Baroque', 'Classical', 'Romantic', 'Modern', 'Contemporary'] as const
type Era = (typeof ERA_ORDER)[number]

function getEra(person: Person): Era | null {
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

function century(year: number): number {
  return Math.ceil(year / 100)
}
function getCenturies(person: Person): number[] {
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
  people,
  filters,
  onChange,
  onClose,
}: {
  open: boolean
  people: Person[]
  filters: PersonFilterState
  onChange: (next: PersonFilterState) => void
  onClose: () => void
}) {
  const eras = ERA_ORDER.filter((era) => people.some((p) => getEra(p) === era))
  const countEra = (era: Era) => people.filter((p) => getEra(p) === era).length
  const centuries = [...new Set(people.flatMap(getCenturies))].sort((a, b) => a - b)
  const countCentury = (c: number) => people.filter((p) => getCenturies(p).includes(c)).length

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
            {eras.map((era) => (
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
            {centuries.map((c) => (
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
// Sort — direct port of the mockup's own segmented field+direction
// button, now driving real sort/dir query params against GET /api/people.
// ---------------------------------------------------------------------

const PERSON_SORT_FIELDS = ['Name', 'Piece Count', 'Birth Year', 'Death Year', 'Date Added'] as const
type PersonSortField = (typeof PERSON_SORT_FIELDS)[number]
type SortDirection = 'asc' | 'desc'

const SORT_FIELD_PARAM: Record<PersonSortField, 'name' | 'pieceCount' | 'birthYear' | 'deathYear' | 'dateAdded'> = {
  Name: 'name',
  'Piece Count': 'pieceCount',
  'Birth Year': 'birthYear',
  'Death Year': 'deathYear',
  'Date Added': 'dateAdded',
}
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

// ---------------------------------------------------------------------
// New Person — deliberately minimal, same reasoning as NewBookModal.tsx:
// just Name (required) and the two year fields. Bio/portrait belong to
// the Edit Person modal / Person Details' camera badge, not creation.
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
  isCreating,
}: {
  open: boolean
  onClose: () => void
  onCreate: (values: NewPersonFormValues) => void
  isCreating: boolean
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
            className="mt-1 shrink-0 cursor-pointer text-ink-soft hover:text-accent"
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
            disabled={isCreating}
            className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent disabled:cursor-default disabled:opacity-45"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="new-person-form"
            disabled={isCreating}
            className="cursor-pointer rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90 disabled:cursor-default disabled:opacity-60"
          >
            {isCreating ? 'Creating…' : 'Create'}
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

function toIntOrNull(value: string): number | null {
  if (value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function PeopleLibraryPage() {
  usePageTitle('People')
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 250)
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [newPersonOpen, setNewPersonOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [filters, setFilters] = useState<PersonFilterState>(EMPTY_PERSON_FILTERS)
  const [sortField, setSortField] = useState<PersonSortField>('Name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  // A freshly created person has no credits yet, so they'd otherwise be
  // immediately invisible under the default >2-piece "Show only" filter —
  // the exact same problem PeopleLibrarySample.tsx's own fixture data
  // solved with a `p.id >= 1000` marker for session-created entries. Real
  // ids have no such reserved range, so this tracks "created this
  // session" explicitly instead — same exemption, real mechanism. Found
  // live: a just-created person disappeared the instant the modal closed.
  const [justCreatedIds, setJustCreatedIds] = useState<Set<number>>(new Set())

  const { data: people = [], isLoading } = useQuery({
    queryKey: ['people', { query: debouncedQuery, sort: SORT_FIELD_PARAM[sortField], dir: sortDirection }],
    queryFn: () =>
      listPeople({
        query: debouncedQuery || undefined,
        sort: SORT_FIELD_PARAM[sortField],
        dir: sortDirection,
      }),
  })

  const createStartedAtRef = useRef(0)
  const [isCreating, setIsCreating] = useState(false)
  const createMutation = useMutation({
    // See lib/minDuration.ts — this app's mutations round-trip in ~1-15ms
    // against the local SQLite backend, faster than a browser paint, so
    // the Date.now() capture lives here (mutationFn), not the onCreate
    // handler passed into NewPersonModal's own handleSubmit(), which the
    // react-hooks/purity lint rule can't statically prove doesn't run
    // during render.
    mutationFn: (values: NewPersonFormValues) => {
      createStartedAtRef.current = Date.now()
      const req: PersonCreateRequest = {
        name: values.name,
        birthYear: toIntOrNull(values.birthYear),
        deathYear: toIntOrNull(values.deathYear),
      }
      return createPerson(req)
    },
    onSuccess: (created) => {
      setJustCreatedIds((prev) => new Set(prev).add(created.id))
      queryClient.invalidateQueries({ queryKey: ['people'] })
      afterMinDuration(createStartedAtRef.current, () => {
        setIsCreating(false)
        setNewPersonOpen(false)
      })
    },
    onError: (error) => {
      setIsCreating(false)
      window.alert(error instanceof ApiError ? error.message : 'Could not create this person.')
    },
  })

  function passesShowOnly(p: Person): boolean {
    return filters.showAll || p.pieceCount > 2 || justCreatedIds.has(p.id)
  }
  function passesEra(p: Person): boolean {
    if (filters.era.length === 0) return true
    const era = getEra(p)
    return era !== null && filters.era.includes(era)
  }
  function passesCentury(p: Person): boolean {
    if (filters.centuries.length === 0) return true
    return getCenturies(p).some((c) => filters.centuries.includes(c))
  }

  const filtered = people.filter((p) => passesShowOnly(p) && passesEra(p) && passesCentury(p))
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

      <div className="flex-1 p-4">
        {isLoading && <p className="text-ink-soft">Loading…</p>}

        {!isLoading && (
          <p className="mb-3 text-xs text-ink-soft tabular-nums">
            {filtered.length} {filtered.length === 1 ? 'person' : 'people'}
            {!filters.showAll && hiddenCount > 0 && ` • ${hiddenCount} hidden (see Filters)`}
          </p>
        )}

        {!isLoading && filtered.length === 0 && (
          <p className="p-8 text-center text-ink-soft">No people match these filters.</p>
        )}

        {filtered.length > 0 && viewMode === 'grid' && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-4 gap-y-6">
            {filtered.map((person) => (
              <PersonGridCard key={person.id} person={person} />
            ))}
          </div>
        )}

        {filtered.length > 0 && viewMode === 'list' && (
          <div className="flex flex-col divide-y divide-border">
            {filtered.map((person) => (
              <PersonListRow key={person.id} person={person} />
            ))}
          </div>
        )}
      </div>

      <NewPersonModal
        open={newPersonOpen}
        onClose={() => setNewPersonOpen(false)}
        onCreate={(values) => {
          setIsCreating(true)
          createMutation.mutate(values)
        }}
        isCreating={isCreating}
      />

      <PersonFilterDrawer
        open={drawerOpen}
        people={people}
        filters={filters}
        onChange={setFilters}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  )
}
