import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IconX, IconXFilled } from '@tabler/icons-react'
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
import { type SortDirection, type SortFieldOption } from '../components/SortControl'
import { LibraryToolbar } from '../components/LibraryToolbar'
import { WIDE_CONTENT_MAX_W } from '../lib/layout'
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
// Sort — now driving real sort/dir query params against GET /api/people
// through the shared components/SortControl.tsx (this page used to carry
// its own local PersonSortControl duplicate, keyed by display label
// rather than a machine key — consolidated so People matches how
// Piece/Books already share this component, per direct instruction when
// the toolbar itself got ported onto the shared LibraryToolbar).
// ---------------------------------------------------------------------

type PersonSortField = 'name' | 'pieceCount' | 'birthYear' | 'deathYear' | 'dateAdded'

const SORT_FIELDS: SortFieldOption<PersonSortField>[] = [
  { value: 'name', label: 'Name' },
  { value: 'pieceCount', label: 'Piece Count' },
  { value: 'birthYear', label: 'Birth Year' },
  { value: 'deathYear', label: 'Death Year' },
  { value: 'dateAdded', label: 'Date Added' },
]
const DIRECTION_LABEL: Record<PersonSortField, Record<SortDirection, string>> = {
  name: { asc: 'A to Z', desc: 'Z to A' },
  pieceCount: { asc: 'Fewest first', desc: 'Most first' },
  birthYear: { asc: 'Earliest first', desc: 'Latest first' },
  deathYear: { asc: 'Earliest first', desc: 'Latest first' },
  dateAdded: { asc: 'Oldest first', desc: 'Newest first' },
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
  const [sortField, setSortField] = useState<PersonSortField>('name')
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
    queryKey: ['people', { query: debouncedQuery, sort: sortField, dir: sortDirection }],
    queryFn: () =>
      listPeople({
        query: debouncedQuery || undefined,
        sort: sortField,
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
      <LibraryToolbar
        query={query}
        onQueryChange={setQuery}
        searchPlaceholder="Search your people…"
        activeFilterCount={activeFilterCount}
        onOpenFilters={() => setDrawerOpen(true)}
        sortFields={SORT_FIELDS}
        sortField={sortField}
        sortDirection={sortDirection}
        onSortFieldChange={setSortField}
        onSortDirectionToggle={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
        sortDirectionLabel={DIRECTION_LABEL[sortField][sortDirection]}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        newButton={{ label: 'New Person', onClick: () => setNewPersonOpen(true) }}
        rightColumnGridColsClassName="sm:grid-cols-[auto_1fr_212px] 2xl:grid-cols-[auto_1fr_256px]"
      >
        {pillEntries.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
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
      </LibraryToolbar>

      <div className={`${WIDE_CONTENT_MAX_W} flex-1 p-4`}>
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
