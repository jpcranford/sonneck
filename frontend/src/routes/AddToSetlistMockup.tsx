import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  IconCalendarFilled,
  IconCalendarPlus,
  IconCheck,
  IconHeartFilled,
  IconSearch,
  IconXFilled,
} from '@tabler/icons-react'
import { ContextMenu } from '../components/ContextMenu'
import { PracticeStatusIcon } from '../components/PracticeStatusIcon'
import { MODAL_TRANSITION_MS } from '../components/Modal'
import { EditSetlistModal } from './EditSetlistMockup'
import {
  ALL_MOCK_SETLISTS,
  getUpcomingSetlists,
  type MockSetlist,
} from '../lib/setlistsMockupFixture'
import { useMockupTitle } from '../lib/useMockupTitle'
import { formatDateOnly } from '../lib/dateOnly'

// Setlists design pass, Phase 5 — the Library grid/list cards' own "Add to
// Setlist" entry point (one of the feature's three, alongside Piece
// Details' overflow menu and the Setlist page's own bulk picker) plus the
// "this piece is already in a setlist" indicator (decision 6).
//
// Hand-copied piece cards (PieceGridCard.tsx/PieceListCard.tsx's own
// markup, fixture data instead of real Piece objects) rather than
// importing those components directly — standard mockup convention,
// unavoidable here anyway since the point is a change to their own context
// menu. ContextMenu.tsx itself is reused as a real import: a small, stable
// shared primitive not being redesigned here, same "pure presentational,
// no page-level markup of its own" exception this project's mockups
// already make for InfoTooltip/MarkdownText/PracticeStatusIcon elsewhere.
//
// The "already in a setlist" indicator reuses the favorite-heart's own
// established precedent exactly: an inline icon right after the title,
// plain native `title` attribute (not InfoTooltip) — these cards already
// treat a status icon as self-explanatory-enough for a native tooltip, and
// there's no reason a second such icon here should suddenly need more.

interface FixturePiece {
  id: number
  title: string
  meta: string
  favorite: boolean
  setlistIds: string[]
  practiceStatus: string | null
}

const FIXTURE_PIECES: FixturePiece[] = [
  {
    id: 1,
    title: 'Prelude in C Major, BWV 846',
    meta: 'J.S. Bach • 1722',
    favorite: true,
    setlistIds: ['1'],
    practiceStatus: 'Learning',
  },
  {
    id: 2,
    title: 'Clair de lune',
    meta: 'Debussy • 1905',
    favorite: false,
    setlistIds: [],
    practiceStatus: null,
  },
]

// The five seeded statuses, in their usual order (User Settings, the Filter
// Drawer). The real build reads the viewer's own list from
// GET /api/practice-statuses, whose iconKey keeps a renamed status's icon.
const PRACTICE_STATUSES = ['Want to Learn', 'Learning', 'Learned', 'Stalled', 'Dropped']

// Practice status, set from the right-click / long-press menu (design C′,
// chosen from a four-way comparison): a labelled strip of the five status
// icons at the top of the menu, above the actions. One click sets a status
// and closes the menu; clicking the current one clears it. The label line
// names whichever icon is hovered or focused, else the current status —
// the icons never stand alone.
function PracticeStatusStrip({
  status,
  onChange,
  close,
}: {
  status: string | null
  onChange: (status: string | null) => void
  close: () => void
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  return (
    <div className="px-3 pt-1.5 pb-2" onMouseLeave={() => setHovered(null)}>
      <div className="mb-1.5 flex justify-between gap-3 text-xs text-ink-soft">
        <span>Practice status</span>
        <span className="font-medium text-ink">{hovered ?? status ?? 'None'}</span>
      </div>
      <div className="flex gap-1" role="radiogroup" aria-label="Practice status">
        {PRACTICE_STATUSES.map((name) => {
          const current = status === name
          return (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={current}
              aria-label={current ? `${name} (click to clear)` : name}
              title={current ? `${name} — click to clear` : name}
              onMouseEnter={() => setHovered(name)}
              onFocus={() => setHovered(name)}
              onBlur={() => setHovered(null)}
              onClick={() => {
                onChange(current ? null : name)
                close()
              }}
              className={`flex size-[30px] cursor-pointer items-center justify-center rounded-md border ${
                current
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border bg-paper-raised text-ink-soft hover:border-accent hover:text-ink'
              }`}
            >
              <PracticeStatusIcon status={name} size={16} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

// "Nov 1" — short month + day, no year (this popover only ever shows a
// setlist's own upcoming gig date, never one far enough out that the year
// would be ambiguous). Locale left undefined, like every other date call in
// this app (PiecePage.tsx, SetlistDetailsMockup.tsx's formatAbsoluteDate,
// ...) — the browser/OS's own default locale decides language and
// month/day ordering, this only pins the *format* (short month + numeric
// day, no year), not the locale that renders it.
function formatShortDate(gigDate: string): string {
  return formatDateOnly(gigDate, { month: 'short', day: 'numeric' })
}

// Shared checkbox row, used by both the search dropdown and the quick list
// below it — same visual weight either way, just a different data source.
// `date` is only ever passed by the quick list below the search bar (its
// own rows are the ones with a gig date worth surfacing inline) — the
// search dropdown's rows stay date-less, matching how they render today.
function SetlistToggleRow({
  name,
  date,
  checked,
  highlighted,
  onToggle,
  onMouseDown,
}: {
  name: string
  date?: string
  checked: boolean
  highlighted?: boolean
  onToggle: () => void
  onMouseDown?: (event: ReactMouseEvent) => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      onMouseDown={onMouseDown}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink ${
        highlighted ? 'bg-accent-soft' : 'hover:bg-accent-soft'
      }`}
    >
      <span
        className={`flex size-3.5 shrink-0 items-center justify-center rounded border ${
          checked ? 'border-accent bg-accent-fill text-white' : 'border-border'
        }`}
      >
        {checked && <IconCheck size={9} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {date && <span className="shrink-0 text-xs text-ink-soft/60">{date}</span>}
    </button>
  )
}

// Shared "which setlist?" popover — the one real, shared component between
// this file's own cards and the Piece Details mockup's toolbar button
// (direct instruction: "the menu that pops up should be a popover
// identical... we can prob reuse the same actually" — a correction to this
// feature's own earlier plan, which called for two independently hand-
// copied pickers sharing only their fixture data shape). Exported so
// PieceDetailsSample.tsx can import it directly rather than keeping a
// second hand-copied version in sync by hand.
//
// A further correction reshaped the body into two tiers, rather than one
// flat checkbox list: a search bar (for reaching a setlist that isn't one
// of the handful shown by default — "unlisted" here means "not already
// visible below," not "doesn't exist") whose own dropdown always keeps a
// pinned "New Setlist…" row at the bottom, and beneath it the same "5
// soonest upcoming" quick list the real sidebar shows — computed via the
// exact same getUpcomingSetlists call against the same fixture universe
// (lib/setlistsMockupFixture.ts), so this popover's quick list is honestly
// the same data as the sidebar's, not just similarly shaped. An empty quick
// list shows centered, de-emphasized italic text rather than nothing.
//
// "Present until dismissed" — opening/closing is still owned by the
// caller's own toggle button — plus a real outside-click/Escape dismiss,
// same convention as SidebarSetlistsMockup.tsx's "⋯" menu. The search
// dropdown's own Escape only closes the dropdown itself (stopping
// propagation before it reaches that same document-level listener); a
// second Escape then closes the whole popover.
export function AddToSetlistPicker({
  allSetlists,
  setlistIds,
  onToggle,
  onClose,
}: {
  allSetlists: MockSetlist[]
  setlistIds: string[]
  onToggle: (id: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  // "New Setlist…" swaps the popover for the New Setlist modal (the same
  // EditSetlistMockup modal the Setlists Library mockup opens), its name
  // pre-filled from the search box — the real picker then adds the piece
  // to the new setlist; this fixture has nowhere to add it. The picker
  // stays mounted until the modal has finished closing.
  const [creating, setCreating] = useState<'no' | 'open' | 'closing'>('no')

  const quickList = useMemo(() => getUpcomingSetlists(allSetlists, 5), [allSetlists])
  const quickListIds = useMemo(() => new Set(quickList.map((s) => s.id)), [quickList])

  // The search universe is deliberately "everything not already shown in
  // the quick list below" — that's what makes it a search for *unlisted*
  // setlists, not just a second way to reach the same handful.
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allSetlists.filter(
      (s) => !quickListIds.has(s.id) && (q === '' || s.name.toLowerCase().includes(q)),
    )
  }, [allSetlists, quickListIds, query])

  // +1 slot for the always-pinned "New Setlist…" row at the end.
  const navigableCount = searchResults.length + 1

  function startCreating() {
    setSearchOpen(false)
    setCreating('open')
  }
  function finishCreating() {
    setCreating('closing')
    setTimeout(onClose, MODAL_TRANSITION_MS)
  }

  useEffect(() => {
    // The modal handles its own dismissal while it's open.
    if (creating !== 'no') return
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose, creating])

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      if (searchOpen) {
        event.preventDefault()
        event.stopPropagation()
        setSearchOpen(false)
      }
      return
    }
    if (!searchOpen) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlighted((h) => (h + 1) % navigableCount)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlighted((h) => (h - 1 + navigableCount) % navigableCount)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (highlighted < searchResults.length) onToggle(searchResults[highlighted].id)
      else startCreating()
    }
  }

  // Prevents the input's onBlur from firing (and closing the dropdown)
  // before a click on one of its own rows registers — the standard
  // mousedown-preventDefault fix for this exact combobox race.
  function keepInputFocused(event: ReactMouseEvent) {
    event.preventDefault()
  }

  if (creating !== 'no') {
    return (
      <EditSetlistModal
        open={creating === 'open'}
        onClose={finishCreating}
        mode="create"
        initialName={query.trim()}
      />
    )
  }

  return (
    <div
      ref={ref}
      className="absolute top-full right-0 z-20 mt-1 w-64 overflow-hidden rounded-md border border-border bg-paper-raised py-2 text-left shadow-lg"
    >
      <div className="mb-2 flex items-center justify-between px-3">
        <span className="text-xs font-medium text-ink-soft">Add to Setlist</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="cursor-pointer text-ink-soft hover:text-ink"
        >
          <IconXFilled size={13} />
        </button>
      </div>

      <div className="relative px-3">
        <div className="relative">
          <IconSearch
            size={13}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-soft/60"
          />
          <input
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setSearchOpen(true)
              setHighlighted(0)
            }}
            onFocus={() => {
              setSearchOpen(true)
              setHighlighted(0)
            }}
            onBlur={() => setSearchOpen(false)}
            onKeyDown={onInputKeyDown}
            placeholder="Search setlists…"
            aria-label="Search setlists"
            className="w-full rounded-md border border-border bg-paper py-1.5 pr-2.5 pl-7 text-sm text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none"
          />
        </div>

        {searchOpen && (
          <div className="absolute top-full right-0 left-0 z-30 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-paper-raised py-1 shadow-lg">
            {searchResults.length === 0 && query.trim() !== '' && (
              <p className="px-3 py-1.5 text-xs text-ink-soft/60 italic">No matches</p>
            )}
            {searchResults.map((setlist, i) => (
              <SetlistToggleRow
                key={setlist.id}
                name={setlist.name}
                checked={setlistIds.includes(setlist.id)}
                highlighted={highlighted === i}
                onMouseDown={keepInputFocused}
                onToggle={() => onToggle(setlist.id)}
              />
            ))}
            <button
              type="button"
              onMouseDown={keepInputFocused}
              onClick={startCreating}
              className={`flex w-full cursor-pointer items-center gap-2 border-t border-border px-3 py-1.5 text-left text-sm text-ink-soft hover:bg-accent-soft hover:text-ink ${
                highlighted === searchResults.length ? 'bg-accent-soft text-ink' : ''
              }`}
            >
              <IconCalendarPlus size={14} />
              New Setlist…
            </button>
          </div>
        )}
      </div>

      <div className="mt-2 border-t border-border pt-1">
        {quickList.length === 0 ? (
          <p className="px-3 py-3 text-center text-sm text-ink-soft/60 italic">No upcoming sets</p>
        ) : (
          quickList.map((setlist) => (
            <SetlistToggleRow
              key={setlist.id}
              name={setlist.name}
              date={formatShortDate(setlist.gigDate)}
              checked={setlistIds.includes(setlist.id)}
              onToggle={() => onToggle(setlist.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function FixtureGridCard({
  piece,
  setlistIds,
  onToggleSetlist,
  practiceStatus,
  onSetPracticeStatus,
}: {
  piece: FixturePiece
  setlistIds: string[]
  onToggleSetlist: (id: string) => void
  practiceStatus: string | null
  onSetPracticeStatus: (status: string | null) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const inSetlist = setlistIds.length > 0
  const inSetlistNames = setlistIds
    .map((id) => ALL_MOCK_SETLISTS.find((s) => s.id === id)?.name)
    .filter(Boolean)
    .join(', ')

  return (
    <div className="relative">
      <ContextMenu
        header={(close) => (
          <PracticeStatusStrip
            status={practiceStatus}
            onChange={onSetPracticeStatus}
            close={close}
          />
        )}
        items={[
          {
            label: piece.favorite ? 'Remove from Favorites' : 'Add to Favorites',
            onSelect: () => {},
          },
          { label: 'Add to Setlist', onSelect: () => setPickerOpen(true) },
          { label: 'Edit Piece', onSelect: () => {} },
          { label: 'Delete Piece', destructive: true, onSelect: () => {} },
        ]}
      >
        <div className="flex w-56 flex-col overflow-hidden rounded-lg border border-border bg-paper-raised text-left">
          <div className="relative aspect-[180/132] w-full border-b border-border bg-paper-sunken">
            {practiceStatus && (
              <span className="absolute bottom-2 left-2 flex max-w-[calc(100%-3rem)] items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent shadow-sm">
                <PracticeStatusIcon status={practiceStatus} size={13} className="shrink-0" />
                <span className="truncate">{practiceStatus}</span>
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1 p-3">
            <p className="flex min-w-0 items-center gap-1.5 font-display text-sm font-medium text-ink">
              <span className="truncate">{piece.title}</span>
              {piece.favorite && (
                <span className="shrink-0 text-accent" title="Favorite">
                  <IconHeartFilled size={13} />
                </span>
              )}
              {inSetlist && (
                <span className="shrink-0 text-accent" title={`In ${inSetlistNames}`}>
                  <IconCalendarFilled size={13} />
                </span>
              )}
            </p>
            <p className="truncate text-xs text-ink-soft">{piece.meta}</p>
          </div>
        </div>
      </ContextMenu>
      {pickerOpen && (
        <AddToSetlistPicker
          allSetlists={ALL_MOCK_SETLISTS}
          setlistIds={setlistIds}
          onToggle={onToggleSetlist}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}

function FixtureListCard({
  piece,
  setlistIds,
  onToggleSetlist,
  practiceStatus,
  onSetPracticeStatus,
}: {
  piece: FixturePiece
  setlistIds: string[]
  onToggleSetlist: (id: string) => void
  practiceStatus: string | null
  onSetPracticeStatus: (status: string | null) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const inSetlist = setlistIds.length > 0
  const inSetlistNames = setlistIds
    .map((id) => ALL_MOCK_SETLISTS.find((s) => s.id === id)?.name)
    .filter(Boolean)
    .join(', ')

  return (
    <div className="relative">
      <ContextMenu
        header={(close) => (
          <PracticeStatusStrip
            status={practiceStatus}
            onChange={onSetPracticeStatus}
            close={close}
          />
        )}
        items={[
          {
            label: piece.favorite ? 'Remove from Favorites' : 'Add to Favorites',
            onSelect: () => {},
          },
          { label: 'Add to Setlist', onSelect: () => setPickerOpen(true) },
          { label: 'Edit Piece', onSelect: () => {} },
          { label: 'Delete Piece', destructive: true, onSelect: () => {} },
        ]}
      >
        <div className="flex w-full max-w-md items-center justify-between gap-4 rounded-lg border border-border bg-paper-raised p-3 text-left">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="flex min-w-0 items-center gap-1.5 font-display text-lg font-medium text-ink">
              <span className="truncate">{piece.title}</span>
              {piece.favorite && (
                <span className="shrink-0 text-accent" title="Favorite">
                  <IconHeartFilled size={13} />
                </span>
              )}
              {inSetlist && (
                <span className="shrink-0 text-accent" title={`In ${inSetlistNames}`}>
                  <IconCalendarFilled size={13} />
                </span>
              )}
            </p>
            <p className="text-sm text-ink-soft">{piece.meta}</p>
            {practiceStatus && (
              <span className="mt-1 flex w-fit items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                <PracticeStatusIcon status={practiceStatus} size={13} className="shrink-0" />
                {practiceStatus}
              </span>
            )}
          </div>
          <div className="h-[84px] w-[100px] shrink-0 rounded-md border border-border bg-paper-sunken" />
        </div>
      </ContextMenu>
      {pickerOpen && (
        <AddToSetlistPicker
          allSetlists={ALL_MOCK_SETLISTS}
          setlistIds={setlistIds}
          onToggle={onToggleSetlist}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}

export function AddToSetlistMockup() {
  useMockupTitle('Add to Setlist')
  const [memberships, setMemberships] = useState<Record<number, string[]>>(
    Object.fromEntries(FIXTURE_PIECES.map((p) => [p.id, p.setlistIds])),
  )

  const [statuses, setStatuses] = useState<Record<number, string | null>>(
    Object.fromEntries(FIXTURE_PIECES.map((p) => [p.id, p.practiceStatus])),
  )

  function toggle(pieceId: number, setlistId: string) {
    setMemberships((m) => {
      const current = m[pieceId] ?? []
      const next = current.includes(setlistId)
        ? current.filter((id) => id !== setlistId)
        : [...current, setlistId]
      return { ...m, [pieceId]: next }
    })
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl font-medium text-ink">
          Add to Setlist — Library cards
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          Reference sample — the Library grid/list cards' new right-click "Add to Setlist" item
          (icon <IconCalendarPlus size={14} className="inline align-[-2px]" />, shared across every
          add-to-setlist entry point) and the "already in a setlist" indicator next to the favorite
          heart. Right-click either card below, or long-press on touch.
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          The menu also opens with a <b className="font-medium text-ink">practice status strip</b>{' '}
          (design C′): the five status icons at the top, labelled with whichever one you point at.
          One click sets a status and closes the menu; clicking the current one clears it. The same
          menu serves the Library grid and list, Book Details and Person Details.
        </p>
      </div>

      <div>
        <h2 className="mb-3 font-display text-lg font-medium text-ink">Grid view</h2>
        <div className="flex flex-wrap gap-4">
          {FIXTURE_PIECES.map((piece) => (
            <FixtureGridCard
              key={piece.id}
              piece={piece}
              setlistIds={memberships[piece.id] ?? []}
              onToggleSetlist={(id) => toggle(piece.id, id)}
              practiceStatus={statuses[piece.id] ?? null}
              onSetPracticeStatus={(status) => setStatuses((s) => ({ ...s, [piece.id]: status }))}
            />
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-3 font-display text-lg font-medium text-ink">List view</h2>
        <div className="flex flex-col gap-3">
          {FIXTURE_PIECES.map((piece) => (
            <FixtureListCard
              key={piece.id}
              piece={piece}
              setlistIds={memberships[piece.id] ?? []}
              onToggleSetlist={(id) => toggle(piece.id, id)}
              practiceStatus={statuses[piece.id] ?? null}
              onSetPracticeStatus={(status) => setStatuses((s) => ({ ...s, [piece.id]: status }))}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
