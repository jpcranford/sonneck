import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import {
  IconArrowLeft,
  IconCalendarFilled,
  IconGripVertical,
  IconPencil,
  IconPlus,
  IconSearch,
  IconX,
  IconXFilled,
} from '@tabler/icons-react'
import { InfoTooltip } from '../components/InfoTooltip'
import { MarkdownText } from '../components/MarkdownText'
import { Modal } from '../components/Modal'
import { Toggle } from '../components/Toggle'
import { daysFromNow } from '../lib/setlistsMockupFixture'
import { useMockupTitle } from '../lib/useMockupTitle'

// Setlists design pass, Phase 10 — decision 23 skipped Phase 9's own
// comparison Artifact outright (scope had narrowed too far to warrant one —
// a fairly conventional name/gig-date/description form plus delete) and
// handed down a concrete build direction instead: copy the former
// `EditProgramMockup.tsx`'s own body wholesale and add underlined text tabs
// at the top ("Setlist Details" / "Program Order") switching between two
// panels in one modal, rather than designing this from scratch. "Program
// Order" below is that now-retired file's own body, carried over unchanged
// in every particular (drag-handle reorder, "+ Piece"/"+ Custom Entry",
// inline custom-entry edit, the scroll-into-view fix, the standard
// keystroke-shortcut set) — its own full build history (13+ polish rounds)
// lives in memory `project_setlists_build.md`'s "Phase 8" sections, not
// repeated here. "Setlist Details" is the other half: name/gig
// date/description (decision 1's remaining scope after reordering moved to
// Phase 8). This modal also doubles as the New Setlist create state
// (decision 3a) — the page wrapper below has an "Open New Setlist" demo
// button alongside "Open Edit Setlist," both driving the same
// `EditSetlistModal`.
//
// **The full fold happened — direct instruction — and `EditProgramMockup.tsx`
// no longer exists.** Decision 23 had left this genuinely open: "whether
// this stays two mockup files sharing a tab strip, or gets fully folded
// into one real modal... every trigger button on the Setlist Details page
// opening this same modal, auto-opened to the relevant tab." The answer
// was yes — the standalone Edit Program modal/route/mockup-index entry are
// gone, and `SetlistDetailsMockup.tsx`'s own two relevant buttons ("Edit
// setlist" and the Program section's own action, now labeled "Edit
// Program") both open *this* modal, each via a shared `initialTab` prop
// that tells it which tab to land on when it opens (see that prop's own
// comment below for why a one-time-at-mount default wasn't enough).
//
// **Whole-setlist delete does NOT live here** — first built inside this
// modal's own footer (decision 1's original call), then moved out by a
// direct correction to actually match the rest of the app: delete lives on
// `SetlistDetailsMockup.tsx`'s own header as an icon-only button, the same
// treatment `PiecePage.tsx`/`BookDetailsPage.tsx` already give Delete
// Piece/Delete Book (confirmed by reading those two files, plus
// `PieceContextMenu.tsx`/`BookContextMenu.tsx`, directly before making the
// change) — a native `window.confirm()`, never a custom Modal, and never
// inside the entity's own Edit modal.
//
// No "underlined text tabs" pattern existed anywhere else in this codebase
// to match (confirmed by search — Admin/User Settings are single-scroll
// pages with jump-nav, not tabs) — the classNames below are a new,
// considered pattern using this app's own existing tokens (`border-accent`
// for the active tab's underline, `text-ink-soft`/`hover:text-ink` for an
// inactive one), not a copy of anything that already shipped.

export interface ProgramLibraryPiece {
  id: string
  title: string
  composer: string
  keys: string[]
  durationSeconds: number
  pages: number
  // Set only on the 5 most recently edited pieces (1 = most recent) — what
  // "+ Piece" prefills its search with before any text is typed. Unrelated
  // to `libraryPieceIdsInProgram` below — a recently edited piece can
  // already be in the program too, and the search list shows both facts at
  // once (the "already in this setlist" badge still lights up here).
  recentRank?: number
}

// Same fixture universe as EditProgramMockup.tsx (12 pieces) — hand-copied,
// not shared, per this project's standing mockup-fixture convention.
const LIBRARY_PIECES: ProgramLibraryPiece[] = [
  { id: 'p1', title: 'Prelude in C Major, BWV 846', composer: 'J.S. Bach', keys: ['C major'], durationSeconds: 150, pages: 2, recentRank: 3 },
  { id: 'p2', title: 'Ave Maria', composer: 'Franz Schubert', keys: ['B♭ major'], durationSeconds: 255, pages: 4 },
  {
    id: 'p3',
    title: 'Jesu, Joy of Man’s Desiring',
    composer: 'J.S. Bach',
    keys: ['G major', 'D major'],
    durationSeconds: 225,
    pages: 3,
    recentRank: 5,
  },
  {
    id: 'p4',
    title: 'How Great Thou Art',
    composer: 'Carl Boberg, arr. Stuart K. Hine',
    keys: ['E♭ major', 'F major'],
    durationSeconds: 180,
    pages: 1,
  },
  {
    id: 'p5',
    title: 'Amazing Grace',
    composer: 'Traditional, arr. Edwin O. Excell',
    keys: ['G major'],
    durationSeconds: 200,
    pages: 2,
  },
  { id: 'p6', title: 'Nearer, My God, to Thee', composer: 'Lowell Mason', keys: ['A♭ major'], durationSeconds: 170, pages: 1, recentRank: 1 },
  {
    id: 'p7',
    title: 'Be Thou My Vision',
    composer: 'Traditional Irish, arr. David Evans',
    keys: ['D major'],
    durationSeconds: 160,
    pages: 2,
  },
  { id: 'p8', title: 'Air on the G String', composer: 'J.S. Bach', keys: ['D major'], durationSeconds: 250, pages: 3 },
  { id: 'p9', title: 'Canon in D', composer: 'Johann Pachelbel', keys: ['D major'], durationSeconds: 275, pages: 5, recentRank: 2 },
  { id: 'p10', title: 'Rondeau', composer: 'Jean-Joseph Mouret', keys: ['D major'], durationSeconds: 115, pages: 1 },
  { id: 'p11', title: 'Trumpet Voluntary', composer: 'Jeremiah Clarke', keys: ['D major'], durationSeconds: 185, pages: 2, recentRank: 4 },
  { id: 'p12', title: 'Sheep May Safely Graze', composer: 'J.S. Bach', keys: ['B♭ major'], durationSeconds: 290, pages: 4 },
]

interface ProgramPieceEntry {
  id: string
  kind: 'piece'
  libraryPieceId: string
  role?: string
  title: string
  composer: string
  keys: string[]
  durationSeconds: number
  pages: number
}

interface ProgramCustomEntry {
  id: string
  kind: 'custom'
  title: string
  durationSeconds?: number
  description?: string
  countsAsMusic?: boolean
}

type ProgramEntry = ProgramPieceEntry | ProgramCustomEntry

// The same 7 entries SetlistDetailsMockup.tsx/EditProgramMockup.tsx both
// show for "Sunday Morning Service" — this modal's own *edit*-mode starting
// state; *create* mode starts with an empty Program instead (see
// `EditSetlistModal`'s own lazy useState initializer below).
const INITIAL_PROGRAM_ENTRIES: ProgramEntry[] = [
  {
    id: 'e1',
    kind: 'piece',
    libraryPieceId: 'p1',
    role: 'Prelude',
    title: 'Prelude in C Major, BWV 846',
    composer: 'J.S. Bach',
    keys: ['C major'],
    durationSeconds: 150,
    pages: 2,
  },
  {
    id: 'e2',
    kind: 'custom',
    title: 'Welcome & Announcements',
    durationSeconds: 180,
    description: 'Reminder: mention the *bake sale* sign-up sheet before the offering.',
  },
  {
    id: 'e3',
    kind: 'piece',
    libraryPieceId: 'p3',
    role: 'Processional',
    title: 'Jesu, Joy of Man’s Desiring',
    composer: 'J.S. Bach',
    keys: ['G major', 'D major'],
    durationSeconds: 225,
    pages: 3,
  },
  {
    id: 'e4',
    kind: 'piece',
    libraryPieceId: 'p2',
    role: 'Offertory',
    title: 'Ave Maria',
    composer: 'Franz Schubert',
    keys: ['B♭ major'],
    durationSeconds: 255,
    pages: 4,
  },
  {
    id: 'e5',
    kind: 'piece',
    libraryPieceId: 'p4',
    role: 'Closing Hymn',
    title: 'How Great Thou Art',
    composer: 'Carl Boberg, arr. Stuart K. Hine',
    keys: ['E♭ major', 'F major'],
    durationSeconds: 180,
    pages: 1,
  },
  { id: 'e6', kind: 'custom', title: 'Congregational Response', durationSeconds: 120, countsAsMusic: true },
  { id: 'e7', kind: 'custom', title: 'Postlude Improvisation', durationSeconds: 300 },
]

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function parseDurationInput(value: string): number | undefined {
  const match = value.trim().match(/^(\d+):(\d{2})$/)
  if (!match) return undefined
  return Number(match[1]) * 60 + Number(match[2])
}

type SetlistModalTab = 'details' | 'program'

interface EditSetlistModalProps {
  open: boolean
  onClose: () => void
  // 'create' is decision 3a's "doubles as the New Setlist modal" state —
  // blank fields, an empty Program.
  mode: 'create' | 'edit'
  // Which tab this modal lands on *the next time it opens* — not just a
  // one-time initial value read once at mount. This component's own
  // instance stays mounted across open/close (the caller toggles `open`,
  // it doesn't conditionally render `<EditSetlistModal>` itself), so a
  // plain `useState(initialTab)` lazy initializer would only ever apply on
  // the very first render — every later open would keep whatever tab was
  // last active, regardless of which trigger button was clicked. The sync
  // effect below (keyed on `open`/`initialTab`) re-applies this value every
  // time `open` flips true instead — the same "synchronize local state to
  // an external controlled prop via a real effect" pattern `Modal.tsx`
  // itself already uses for its own `mounted`/`visible` state, not the
  // render-phase-update anti-pattern that file's own comment warns against.
  initialTab?: SetlistModalTab
  initialName?: string
  initialGigDate?: string // ISO date, matches <input type="date">'s own value format
  initialDescription?: string
  libraryPieces?: ProgramLibraryPiece[]
  onSave?: (setlist: { name: string; gigDate: string; description: string }, entries: ProgramEntry[]) => void
}

// What the bottom-of-list add row is currently showing — the two buttons,
// the piece search, or the custom-entry form. Only one at a time; picking a
// piece or submitting/canceling the custom form always returns here to
// 'buttons'.
type AddRowMode = 'buttons' | 'search' | 'custom'

export function EditSetlistModal({
  open,
  onClose,
  mode,
  initialTab = 'details',
  initialName = '',
  initialGigDate = '',
  initialDescription = '',
  libraryPieces = LIBRARY_PIECES,
  onSave,
}: EditSetlistModalProps) {
  const [activeTab, setActiveTab] = useState<SetlistModalTab>(initialTab)
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: see `initialTab`'s own comment above — this component's instance persists across open/close, so re-applying the caller's requested tab has to happen on every open, not just once at mount. Same posture Modal.tsx's own mounted/visible sync takes for the identical reason (its own disable comment sits on the same line pattern).
    setActiveTab(initialTab)
  }, [open, initialTab])
  const [name, setName] = useState(initialName)
  const [gigDate, setGigDate] = useState(initialGigDate)
  const [description, setDescription] = useState(initialDescription)

  // Create mode starts with an empty Program (decision 3a) — nothing to
  // copy in, since the setlist doesn't exist yet.
  const [programEntries, setProgramEntries] = useState<ProgramEntry[]>(() =>
    mode === 'create' ? [] : INITIAL_PROGRAM_ENTRIES,
  )
  const [draggingId, setDraggingId] = useState<string | null>(null)
  // The floating ghost's current page position, in real screen pixels — set
  // from `event.clientX/clientY` on every pointermove, not derived from
  // `draggingId`'s own array position, which is exactly the point: the
  // ghost tracks the actual pointer continuously, while the reorder logic
  // below is free to keep shuffling the underlying array underneath it.
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null)
  // Where inside the card the pointer grabbed it (so the ghost keeps that
  // same grab point under the cursor instead of snapping its top-left
  // corner there) and the card's own width at drag start (so the ghost
  // renders at the same size regardless of where it ends up over the
  // list). Real state, not a ref — this project's React Compiler setup
  // disallows reading a ref's `.current` during render (CLAUDE.md's own
  // standing gotcha), and the ghost's own inline `style` needs to read
  // these on every render while it's shown. Both are set once per drag, at
  // pointerdown, not on every pointermove, so this costs nothing extra.
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [dragWidth, setDragWidth] = useState(0)
  // Auto-scroll while dragging near the list's own scrolled edge (Modal's
  // body div, the real `overflow-y-auto` ancestor — the list itself has no
  // scroll region of its own). Refs, not state: both update every
  // pointermove/frame, and neither needs to trigger a re-render — only the
  // scroll container's own `scrollTop` and the ghost's `style` (already
  // state) need to visibly change.
  const scrollContainerRef = useRef<HTMLElement | null>(null)
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)
  const [addRowMode, setAddRowMode] = useState<AddRowMode>('buttons')
  const [pieceQuery, setPieceQuery] = useState('')
  const [searchHighlight, setSearchHighlight] = useState(-1)
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)
  const [customName, setCustomName] = useState('')
  const [customDuration, setCustomDuration] = useState('')
  const [customDescription, setCustomDescription] = useState('')
  const [customCountsAsMusic, setCustomCountsAsMusic] = useState(false)
  // Both sub-forms stay open after a successful add so several pieces/
  // custom entries can be added back-to-back — `autoFocus` only fires once,
  // at mount, so these refocus the field by hand after each add resets it
  // (the input itself never unmounts across an add, since `addRowMode`
  // doesn't change).
  const pieceSearchInputRef = useRef<HTMLInputElement>(null)
  const customNameInputRef = useRef<HTMLInputElement>(null)
  // The one currently-open expanding block — the piece search, the bottom
  // add-row's own custom-entry form, or an existing entry's inline edit
  // form — whichever is rendered right now (addRowMode/editingEntryId are
  // kept mutually exclusive by openPieceSearch/openAddCustomForm/
  // openEditCustomForm, so only one of the three is ever mounted at once,
  // and this one ref can just always point at it). See the effect below for
  // why this exists rather than relying on the focused input's own
  // implicit autofocus-scroll.
  const expandedRef = useRef<HTMLElement | null>(null)
  // A callback ref, not `expandedRef` passed directly — the two elements it
  // attaches to (the search block's own <div>, the custom form's <form>)
  // are different concrete DOM types, and a plain RefObject<HTMLElement>
  // isn't assignable to either one's own more specific Ref<HTMLDivElement>/
  // Ref<HTMLFormElement> prop. A callback ref's parameter type is
  // contravariant, so one typed as accepting the wider HTMLElement | null
  // is assignable at both call sites.
  const setExpandedRef = useCallback((node: HTMLElement | null) => {
    expandedRef.current = node
  }, [])

  const libraryPieceIdsInProgram = useMemo(() => {
    const ids = new Set<string>()
    for (const entry of programEntries) {
      if (entry.kind === 'piece') ids.add(entry.libraryPieceId)
    }
    return ids
  }, [programEntries])

  // Empty query → the 5 most recently edited pieces, soonest-edited first.
  // Once you type, this searches the whole library, not just those 5.
  const pieceResults = useMemo(() => {
    const q = pieceQuery.trim().toLowerCase()
    if (!q) {
      return libraryPieces
        .filter((p): p is ProgramLibraryPiece & { recentRank: number } => p.recentRank != null)
        .sort((a, b) => a.recentRank - b.recentRank)
    }
    return libraryPieces.filter((p) => p.title.toLowerCase().includes(q) || p.composer.toLowerCase().includes(q))
  }, [pieceQuery, libraryPieces])

  function removeEntry(id: string) {
    setProgramEntries((current) => current.filter((e) => e.id !== id))
  }

  function openPieceSearch() {
    // Closes any inline custom-entry edit that might be open — the two
    // flows share the same customName/customDuration/etc. state, and
    // leaving an inline edit form open underneath the search would read as
    // two things active at once for no reason.
    setEditingEntryId(null)
    setPieceQuery('')
    setSearchHighlight(-1)
    setAddRowMode('search')
  }

  function closeAddRow() {
    setAddRowMode('buttons')
  }

  // Selecting a result always appends a new instance (decision 4 —
  // duplicates allowed on purpose, so re-picking an already-in-program
  // piece is never blocked). The search stays open afterward rather than
  // collapsing back to the two buttons, so adding several pieces in a row
  // doesn't need "+ Piece" pressed again each time — only the query/
  // highlight reset, back to "Recently edited," and the input gets focus
  // back for the next pick. Explicit dismissal (the × on the input,
  // Escape, or the corner × once back on "buttons") is still the only
  // thing that actually closes it.
  function selectPiece(piece: ProgramLibraryPiece) {
    setProgramEntries((current) => [
      ...current,
      {
        id: `staged-${piece.id}-${Date.now()}`,
        kind: 'piece',
        libraryPieceId: piece.id,
        title: piece.title,
        composer: piece.composer,
        keys: piece.keys,
        durationSeconds: piece.durationSeconds,
        pages: piece.pages,
      },
    ])
    setPieceQuery('')
    setSearchHighlight(-1)
    pieceSearchInputRef.current?.focus()
  }

  // Standing dropdown-keyboard-nav rule (CLAUDE.md > Frontend): ArrowUp/
  // ArrowDown wrap at both ends, Enter picks the highlighted result.
  function onPieceSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSearchHighlight((h) => (pieceResults.length === 0 ? -1 : (h + 1) % pieceResults.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSearchHighlight((h) => (pieceResults.length === 0 ? -1 : (h - 1 + pieceResults.length) % pieceResults.length))
    } else if (event.key === 'Enter' && !event.shiftKey) {
      // !shiftKey — Shift+Enter is reserved for the whole-modal Save
      // shortcut below (`handleFormKeyDown`); same guard `TagComboBox.tsx`
      // already uses on its own Enter handling for the identical reason.
      event.preventDefault()
      const target = pieceResults[searchHighlight]
      if (target) selectPiece(target)
    } else if (event.key === 'Escape') {
      closeAddRow()
    }
  }

  function openAddCustomForm() {
    setEditingEntryId(null)
    setCustomName('')
    setCustomDuration('')
    setCustomDescription('')
    setCustomCountsAsMusic(false)
    setAddRowMode('custom')
  }

  // Renders inline, in this entry's own position in the list — not the
  // bottom add-row (see EditProgramMockup.tsx's own comment for the real
  // reported bug this fixed). Any bottom add-row that was already open
  // (search or custom) gets closed first — only one expanding block is
  // ever open at a time (also what lets `expandedRef` above stay a single
  // ref rather than three).
  function openEditCustomForm(entry: ProgramCustomEntry) {
    if (addRowMode !== 'buttons') closeAddRow()
    setEditingEntryId(entry.id)
    setCustomName(entry.title)
    setCustomDuration(entry.durationSeconds != null ? formatDuration(entry.durationSeconds) : '')
    setCustomDescription(entry.description ?? '')
    setCustomCountsAsMusic(entry.countsAsMusic ?? false)
  }

  // Closes whichever of the two mutually-exclusive custom-form flows is
  // actually open — an inline edit (editingEntryId set) or the bottom
  // add-row's own "+ Custom Entry" form (addRowMode === 'custom').
  function closeCustomForm() {
    setEditingEntryId(null)
    setCustomName('')
    setCustomDuration('')
    setCustomDescription('')
    setCustomCountsAsMusic(false)
    if (addRowMode === 'custom') closeAddRow()
  }

  // The "+ Piece" / "+ Custom Entry" row itself never disappears — clicking
  // a button switches which content is expanded below it (its own button
  // taking on a pressed/active look), rather than the whole row being
  // replaced by that content. Clicking the *already*-active button toggles
  // it back closed, reusing the exact same reset each explicit × already
  // performs.
  function selectAddMode(mode: 'search' | 'custom') {
    if (addRowMode === mode) {
      if (mode === 'custom') closeCustomForm()
      else closeAddRow()
      return
    }
    if (mode === 'search') openPieceSearch()
    else openAddCustomForm()
  }

  // Adding a new custom entry keeps the form open (fields reset, ready for
  // the next one) instead of collapsing back to the two buttons — the same
  // "stay open until explicitly closed" as the piece search. Saving an
  // *edit* to an already-existing entry (opened via its own pencil icon,
  // `editingEntryId` set) still closes on save — a one-off correction to a
  // specific row, not a batch-add flow.
  function submitCustomForm() {
    if (!customName.trim()) return
    const durationSeconds = parseDurationInput(customDuration)
    const description = customDescription.trim() || undefined
    if (editingEntryId) {
      setProgramEntries((current) =>
        current.map((entry) =>
          entry.id === editingEntryId && entry.kind === 'custom'
            ? { ...entry, title: customName.trim(), durationSeconds, description, countsAsMusic: customCountsAsMusic }
            : entry,
        ),
      )
      closeCustomForm()
    } else {
      setProgramEntries((current) => [
        ...current,
        {
          id: `custom-${Date.now()}`,
          kind: 'custom',
          title: customName.trim(),
          durationSeconds,
          description,
          countsAsMusic: customCountsAsMusic,
        },
      ])
      setCustomName('')
      setCustomDuration('')
      setCustomDescription('')
      setCustomCountsAsMusic(false)
      customNameInputRef.current?.focus()
    }
  }

  // Pointer-based reorder (works for mouse AND touch alike, unlike native
  // HTML5 drag-and-drop, which has no touch support at all) — elementFromPoint
  // on every move to find which row is currently under the pointer, since
  // this interaction genuinely needs to know *which other row*, not just
  // "did the same pointer move" (CLAUDE.md's own standing gotcha's carve-out
  // for that case). The whole card is the drag surface, not just the grip
  // icon — `.no-drag` on the pencil/remove buttons opts them back out,
  // checked before capture ever starts so their own click still fires
  // normally.
  //
  // Capture itself is set on `listRef` — the outer, never-reordered list
  // container — not on the card being dragged (see EditProgramMockup.tsx's
  // own comment for the real bug this avoids: a card that reorders during
  // its own drag loses pointer capture the instant React relocates its DOM
  // node, which would otherwise strand `draggingId` set).
  const listRef = useRef<HTMLDivElement>(null)

  // `target instanceof Element`, not `HTMLElement` — a click on the pencil/
  // remove button's own icon lands on its inner <svg>/<path>, an
  // SVGElement, not an HTMLElement. `Element` is the shared base both HTML
  // and SVG elements extend, and `closest()` is defined on it either way.
  function isDragBlocker(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest('.no-drag') != null
  }

  // Reorders by id, not by reading `draggingId` from closure — lets this
  // get called safely from both the plain pointermove handler below and
  // the auto-scroll rAF loop's own effect (a different closure "generation"
  // each time `draggingId` changes), with no staleness to reason about
  // either way.
  const reorderAtPoint = useCallback((fromId: string, clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY)
    const rowEl = el?.closest('[data-entry-id]') as HTMLElement | null
    const overId = rowEl?.dataset.entryId
    if (!overId || overId === fromId) return
    setProgramEntries((current) => {
      const fromIndex = current.findIndex((e) => e.id === fromId)
      const toIndex = current.findIndex((e) => e.id === overId)
      if (fromIndex === -1 || toIndex === -1) return current
      const next = [...current]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }, [])

  function onCardPointerDown(event: ReactPointerEvent<HTMLDivElement>, id: string) {
    if (isDragBlocker(event.target)) return
    const rect = event.currentTarget.getBoundingClientRect()
    setDragOffset({ x: event.clientX - rect.left, y: event.clientY - rect.top })
    setDragWidth(rect.width)
    // Modal's own body div (`overflow-y-auto`, `Modal.tsx`) is the real
    // scroll container — the Program list has no scroll region of its own.
    scrollContainerRef.current = listRef.current?.closest('.overflow-y-auto') as HTMLElement | null
    lastPointerRef.current = { x: event.clientX, y: event.clientY }
    listRef.current?.setPointerCapture(event.pointerId)
    setDraggingId(id)
    setGhostPos({ x: event.clientX, y: event.clientY })
  }

  // `document.body`'s own inline `cursor` style is the standard fix every
  // custom-JS drag implementation reaches for here — `cursor` is
  // inherited, so it applies everywhere nothing more specific overrides
  // it, for the entire drag rather than only while hovering the one card
  // that started it. A `useEffect`, not a direct mutation inside the
  // pointerdown/pointerup handlers — this project's React Compiler setup
  // disallows mutating something defined outside the component (`document`
  // is global) from plain event-handler-shaped functions.
  useEffect(() => {
    if (!draggingId) return
    document.body.style.cursor = 'grabbing'
    return () => {
      document.body.style.cursor = ''
    }
  }, [draggingId])

  // The ghost's own position updates on every move, independent of the
  // reorder logic below — the floating ghost (rendered via `createPortal`,
  // below) tracks the actual cursor continuously; the reorder-on-crossing
  // logic is unchanged and still live-updates `programEntries` as the
  // ghost passes over a neighbor, so the list is already in its final
  // order by the time the pointer is released.
  function onListPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingId) return
    setGhostPos({ x: event.clientX, y: event.clientY })
    lastPointerRef.current = { x: event.clientX, y: event.clientY }
    reorderAtPoint(draggingId, event.clientX, event.clientY)
  }

  // Auto-scroll while the ghost sits near the list's own scrolled top/
  // bottom edge — a `requestAnimationFrame` loop, started fresh whenever a
  // drag begins, scrolls the container at a speed that ramps up the closer
  // the *last known* pointer position is to either edge, and re-runs the
  // reorder check against that same last-known position on every frame —
  // not just on `pointermove` — so the list keeps reordering correctly
  // under a stationary pointer as new rows scroll into reach underneath it.
  useEffect(() => {
    if (!draggingId) return
    // Narrows `string | null` → `string` once, outside `tick` — TS can't
    // see the early-return above through the nested closure below.
    const activeDraggingId = draggingId
    const EDGE_ZONE = 56
    const MAX_SPEED = 14
    let rafId: number

    function tick() {
      const container = scrollContainerRef.current
      const pointer = lastPointerRef.current
      if (container && pointer) {
        const rect = container.getBoundingClientRect()
        let speed = 0
        if (pointer.y < rect.top + EDGE_ZONE) {
          speed = -MAX_SPEED * (1 - Math.max(0, pointer.y - rect.top) / EDGE_ZONE)
        } else if (pointer.y > rect.bottom - EDGE_ZONE) {
          speed = MAX_SPEED * (1 - Math.max(0, rect.bottom - pointer.y) / EDGE_ZONE)
        }
        if (speed !== 0) {
          container.scrollTop += speed
          reorderAtPoint(activeDraggingId, pointer.x, pointer.y)
        }
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [draggingId, reorderAtPoint])

  // Wired to onPointerCancel/onLostPointerCapture too, not just onPointerUp
  // — belt-and-suspenders alongside the `listRef` capture fix above, so a
  // capture loss from any *other* cause (an actual scroll gesture
  // intervening, the tab losing focus mid-drag, etc.) still cleans up
  // instead of leaving `draggingId` stuck.
  function endDrag() {
    setDraggingId(null)
    setGhostPos(null)
    scrollContainerRef.current = null
    lastPointerRef.current = null
  }

  function handleCancel() {
    setName(initialName)
    setGigDate(initialGigDate)
    setDescription(initialDescription)
    setProgramEntries(mode === 'create' ? [] : INITIAL_PROGRAM_ENTRIES)
    setActiveTab('details')
    closeAddRow()
    closeCustomForm()
    onClose()
  }

  function handleSave() {
    onSave?.({ name: name.trim(), gigDate, description }, programEntries)
    onClose()
  }

  // This app's standard modal shortcut set beyond Modal.tsx's own free
  // Escape-to-close handling: Shift+Enter saves, from anywhere in the
  // modal (either tab) — the same unconditional `handleFormKeyDown`
  // pattern EditBookModal.tsx/EditPersonModal.tsx already use, adapted to
  // a plain wrapping `<div>` since this modal has no single wrapping
  // `<form>` of its own. Guarded by the same `!name.trim()` check the Save
  // button's own `disabled` already uses, so Shift+Enter can't save a
  // blank-named setlist the button itself wouldn't allow either.
  function handleFormKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault()
      if (name.trim()) handleSave()
    }
  }

  // Scrolls whichever block just opened (piece search / custom-entry add /
  // an existing entry's inline edit) fully into view, with a small peek
  // past its own bottom edge rather than stopping flush with it (see
  // EditProgramMockup.tsx's own comment for the full story: no explicit
  // scroll code existed before that fix, and the implicit autofocus-scroll
  // it replaced turned out to land on two different, inconsistent Chromium
  // heuristics depending on sub-pixel differences in each form's own
  // padding). Plain scrollTop arithmetic, not `Element.scrollIntoView` —
  // simpler, and it's what lets EXTRA_PEEK exist at all.
  useEffect(() => {
    if (addRowMode === 'buttons' && editingEntryId === null) return
    const target = expandedRef.current
    const container = target?.closest('.overflow-y-auto') as HTMLElement | null
    if (!target || !container) return
    const targetRect = target.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const EXTRA_PEEK = 16
    if (targetRect.bottom > containerRect.bottom) {
      container.scrollTop += targetRect.bottom - containerRect.bottom + EXTRA_PEEK
    } else if (targetRect.top < containerRect.top) {
      container.scrollTop -= containerRect.top - targetRect.top
    }
  }, [addRowMode, editingEntryId])

  const draggingEntry = draggingId ? programEntries.find((e) => e.id === draggingId) : undefined

  // Shared by both places a custom entry's fields get edited — the bottom
  // add-row's own "+ Custom Entry" form, and (see the entries map below) an
  // existing custom entry's inline edit form, opened via its own pencil
  // icon. Only one of the two is ever open at once, so both call sites can
  // safely share the same customName/customDuration/etc. state —
  // `wrapperClassName` is the one real difference.
  function renderCustomEntryForm(key: string, wrapperClassName: string) {
    return (
      <form
        key={key}
        ref={setExpandedRef}
        onSubmit={(event) => {
          event.preventDefault()
          submitCustomForm()
        }}
        className={wrapperClassName}
      >
        <button
          type="button"
          onClick={closeCustomForm}
          aria-label="Cancel custom entry"
          className="absolute top-2 right-2 cursor-pointer rounded p-1 text-ink-soft hover:bg-paper-sunken hover:text-ink"
        >
          <IconX size={13} />
        </button>
        <label htmlFor="f-custom-name" className="text-sm text-ink-soft">
          Name
        </label>
        <input
          ref={customNameInputRef}
          id="f-custom-name"
          type="text"
          autoFocus
          value={customName}
          onChange={(event) => setCustomName(event.target.value)}
          placeholder="Welcome &amp; Announcements"
          className="mt-1 mb-2 w-full rounded-md border border-border bg-paper-raised px-3 py-1.5 text-sm text-ink"
        />
        <div className="mb-2 flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor="f-custom-duration" className="text-sm text-ink-soft">
              Duration
            </label>
            <input
              id="f-custom-duration"
              type="text"
              value={customDuration}
              onChange={(event) => setCustomDuration(event.target.value)}
              placeholder="3:00"
              className="mt-1 w-full rounded-md border border-border bg-paper-raised px-3 py-1.5 text-sm text-ink"
            />
          </div>
          <div className="flex flex-1 py-1.5">
            <Toggle checked={customCountsAsMusic} onChange={setCustomCountsAsMusic} label="Count as music" />
          </div>
        </div>
        <label htmlFor="f-custom-description" className="text-sm text-ink-soft">
          Description <span className="text-ink-soft/60 italic">(Markdown supported)</span>
        </label>
        <textarea
          id="f-custom-description"
          value={customDescription}
          onChange={(event) => setCustomDescription(event.target.value)}
          placeholder="Reminder: mention the bake sale sign-up sheet before the offering."
          rows={2}
          className="mt-1 mb-3 w-full resize-none rounded-md border border-border bg-paper-raised px-3 py-1.5 text-sm text-ink"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={closeCustomForm}
            className="cursor-pointer rounded-md border border-border bg-paper-raised px-3 py-1.5 text-sm text-ink hover:border-accent"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!customName.trim()}
            className="cursor-pointer rounded-md bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {editingEntryId ? 'Save' : 'Add'}
          </button>
        </div>
      </form>
    )
  }

  return (
    <>
    <Modal
      open={open}
      onClose={handleCancel}
      labelledBy="edit-setlist-title"
      size="md"
      header={
        // Same header shape as EditProgramModal/EditPieceModal/
        // EditBookModal/EditPersonModal — title size, subtitle size,
        // full-bleed border-b, corner close button — extended here with
        // the tab row sitting *above* that border-b, inside the pinned
        // header itself rather than the scrolling body: the border is the
        // header/content separator, and the tabs are header-level
        // navigation, not page content, so they belong above the line
        // that ends the header, not below it. The single border-b now
        // lives on this outer wrapper (after both the title row and the
        // tab row) instead of directly under the title row alone — each
        // tab's own `-mb-px border-b-2` still sits flush on top of that
        // one shared line, the same CSS trick as before, just relocated.
        // Subtitle only in edit mode (the setlist's own current name, same
        // "pre-edit stored value as context" convention EditBookModal's
        // own subtitle uses) — create mode has no existing name yet to
        // show. Tab labels are plain sans (no `font-display`) — they're UI
        // chrome/navigation, not a heading or piece title, matching every
        // other tab-adjacent UI text in this app's own sans-for-chrome
        // convention.
        <div className="-mx-6 border-b border-border px-6">
          <div className="flex items-start justify-between gap-4 pb-4">
            <div>
              <h2 id="edit-setlist-title" className="font-display text-2xl font-medium text-ink">
                {mode === 'create' ? 'New setlist' : 'Edit setlist'}
              </h2>
              {mode === 'edit' && <p className="text-sm text-ink-soft">{initialName}</p>}
            </div>
            <button
              type="button"
              onClick={handleCancel}
              aria-label="Close"
              className="mt-1 shrink-0 cursor-pointer text-ink-soft hover:text-accent"
            >
              <IconXFilled size={22} />
            </button>
          </div>
          <div className="flex gap-6">
            <button
              type="button"
              onClick={() => setActiveTab('details')}
              className={`-mb-px cursor-pointer border-b-2 pb-2 text-sm font-medium ${
                activeTab === 'details' ? 'border-accent text-ink' : 'border-transparent text-ink-soft hover:text-ink'
              }`}
            >
              Setlist Details
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('program')}
              className={`-mb-px cursor-pointer border-b-2 pb-2 text-sm font-medium ${
                activeTab === 'program' ? 'border-accent text-ink' : 'border-transparent text-ink-soft hover:text-ink'
              }`}
            >
              Program Order
            </button>
          </div>
        </div>
      }
      footer={
        // Whole-setlist delete does NOT live here — a direct correction,
        // matching this app's real convention instead (confirmed by
        // reading PieceContextMenu.tsx/BookContextMenu.tsx/PiecePage.tsx/
        // BookDetailsPage.tsx directly): a destructive whole-record delete
        // lives on the entity's own Details page as an icon-only button
        // (`SetlistDetailsMockup.tsx`'s own header, leftmost, permanently
        // red), or its library context menu — never inside its Edit
        // modal. Footer is back to a plain Cancel/Save pair, same shape as
        // EditProgramModal's own.
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!name.trim()}
            className="cursor-pointer rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save
          </button>
        </div>
      }
    >
      <div onKeyDown={handleFormKeyDown}>
      {/* Setlist Details — name/gig date/description (decision 1's
          remaining scope), styled to match EditBookModal/EditPieceModal's
          own real field conventions (`text-sm text-ink-soft` labels,
          `px-3 py-2` inputs on `bg-paper-raised`). Both tab panels stay
          mounted at all times (`hidden`, not a conditional unmount) —
          matches this app's own existing dual-tree convention (e.g. the
          real Setlist Details page's desktop/mobile split before decision
          18 collapsed it to one) and, more importantly here, keeps the
          Program tab's own drag/add-row state fully intact across a tab
          switch instead of unmounting and losing it. */}
      <div className={activeTab === 'details' ? 'flex flex-col gap-4' : 'hidden'}>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-setlist-name" className="text-sm text-ink-soft">
            Name <span className="text-ink-soft/60 italic">(Required)</span>
          </label>
          <input
            id="f-setlist-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-setlist-gig-date" className="text-sm text-ink-soft">
            Gig date
          </label>
          <input
            id="f-setlist-gig-date"
            type="date"
            value={gigDate}
            onChange={(event) => setGigDate(event.target.value)}
            className="w-fit rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
          />
          {/* A native <input type="date"> already displays in whatever
              format the browser resolves from the OS/browser locale (e.g.
              MM/DD/YYYY in en-US, DD/MM/YYYY in en-GB) — genuinely
              locale-aware for free, not something this component
              formats/controls itself (the field's own `value`/`onChange`
              stay plain ISO `yyyy-mm-dd` regardless of what's displayed).
              Called out here since a screenshot taken in one locale can
              otherwise look like a hardcoded format choice. */}
          <span className="text-xs text-ink-soft">Shown in your browser's own date format.</span>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-setlist-description" className="text-sm text-ink-soft">
            Description <span className="text-ink-soft/60 italic">(Markdown supported)</span>
          </label>
          <textarea
            id="f-setlist-description"
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="min-h-[96px] resize-none rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
          />
        </div>
      </div>

      {/* Program Order — EditProgramMockup.tsx's own body, unchanged. */}
      <div className={activeTab === 'program' ? '' : 'hidden'}>
        <p className="mb-2 text-xs font-medium tracking-wide text-ink-soft uppercase">Program ({programEntries.length})</p>
        <div
          ref={listRef}
          onPointerMove={onListPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          className="flex flex-col gap-1.5"
        >
          {programEntries.map((entry) => {
            // Inline edit, in this entry's own position — not the bottom
            // add-row. Not draggable while its own form is open — the row
            // swaps to a plain bordered form, no onPointerDown/
            // data-entry-id, so a drag passing over it just doesn't treat
            // it as a drop target for the moment it's being edited.
            if (entry.kind === 'custom' && entry.id === editingEntryId) {
              return renderCustomEntryForm(entry.id, 'relative rounded-md border border-accent bg-paper-raised p-3')
            }
            return (
            <div
              key={entry.id}
              data-entry-id={entry.id}
              onPointerDown={(event) => onCardPointerDown(event, entry.id)}
              className={`flex touch-none items-start gap-1.5 rounded-md border border-border bg-paper-raised px-2 py-1.5 cursor-grab select-none active:cursor-grabbing ${
                draggingId === entry.id ? 'opacity-40' : ''
              }`}
            >
              <span
                aria-hidden="true"
                className="mr-1 shrink-0 self-center text-ink-soft/50"
              >
                <IconGripVertical size={14} />
              </span>
              {entry.kind === 'custom' && (
                <button
                  type="button"
                  onClick={() => openEditCustomForm(entry)}
                  aria-label={`Edit ${entry.title}`}
                  className="no-drag mt-0.5 shrink-0 cursor-pointer text-ink-soft hover:text-accent"
                >
                  <IconPencil size={13} />
                </button>
              )}
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate ${
                    entry.kind === 'piece'
                      ? 'font-display text-sm font-medium text-ink'
                      : 'font-sans text-sm font-normal text-ink-soft italic'
                  }`}
                >
                  {entry.title}
                </div>
                {entry.kind === 'piece' ? (
                  <div className="truncate text-xs text-ink-soft">
                    {entry.composer} <span aria-hidden="true">•</span> {entry.keys.join(' › ')}
                  </div>
                ) : (
                  entry.description && (
                    <div className="line-clamp-2 text-xs text-ink-soft italic">
                      <MarkdownText>{entry.description}</MarkdownText>
                    </div>
                  )
                )}
              </div>
              {entry.durationSeconds != null && (
                <span className="mt-0.5 shrink-0 font-mono text-xs tabular-nums text-ink-soft">
                  {formatDuration(entry.durationSeconds)}
                </span>
              )}
              <button
                type="button"
                onClick={() => removeEntry(entry.id)}
                aria-label={`Remove ${entry.title}`}
                className="no-drag mt-0.5 shrink-0 cursor-pointer text-ink-soft hover:text-ink"
              >
                <IconX size={14} />
              </button>
            </div>
            )
          })}

          {/* Add row — ends the list itself. A plain bordered box matching
              the entry rows' own card chrome. The two-button row is always
              rendered — it doesn't get replaced by whichever content is
              active; that content expands directly below it, inside this
              same bordered card, with the active button restyled to look
              pressed (`bg-paper-sunken text-ink`, deliberately not accent —
              accent is this row's own hover language too). */}
          <div className="rounded-md border border-border bg-paper-raised overflow-hidden">
            <div className="flex">
              <button
                type="button"
                onClick={() => selectAddMode('search')}
                className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 border-r border-border px-3 py-2 text-sm font-medium ${
                  addRowMode === 'search' ? 'bg-paper-sunken text-ink' : 'text-ink-soft hover:bg-accent-soft hover:text-accent'
                }`}
              >
                <IconPlus size={14} />
                Piece
              </button>
              <button
                type="button"
                onClick={() => selectAddMode('custom')}
                className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium ${
                  addRowMode === 'custom' ? 'bg-paper-sunken text-ink' : 'text-ink-soft hover:bg-accent-soft hover:text-accent'
                }`}
              >
                <IconPlus size={14} />
                Custom Entry
              </button>
            </div>

          {addRowMode === 'search' && (
            <div ref={setExpandedRef} className="border-t border-border p-2.5">
              <div className="relative">
                <IconSearch size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-soft/60" />
                <input
                  ref={pieceSearchInputRef}
                  type="text"
                  autoFocus
                  value={pieceQuery}
                  onChange={(event) => {
                    setPieceQuery(event.target.value)
                    setSearchHighlight(-1)
                  }}
                  onKeyDown={onPieceSearchKeyDown}
                  placeholder="Search pieces…"
                  aria-label="Search pieces"
                  className="w-full rounded-md border border-border bg-paper py-1.5 pr-8 pl-7 text-sm text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  onClick={closeAddRow}
                  aria-label="Cancel adding a piece"
                  className="absolute top-1/2 right-1.5 -translate-y-1/2 cursor-pointer rounded p-1 text-ink-soft hover:bg-paper-sunken hover:text-ink"
                >
                  <IconX size={13} />
                </button>
              </div>
              <p className="mt-2 mb-1 text-[0.65rem] font-medium tracking-wide text-ink-soft uppercase">
                {pieceQuery.trim() ? `${pieceResults.length} ${pieceResults.length === 1 ? 'match' : 'matches'}` : 'Recently edited'}
              </p>
              <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
                {pieceResults.length === 0 ? (
                  <p className="px-2 py-4 text-center text-sm text-ink-soft italic">No matches</p>
                ) : (
                  pieceResults.map((piece, i) => {
                    const inProgram = libraryPieceIdsInProgram.has(piece.id)
                    return (
                      // A real <button> can't validly contain the
                      // InfoTooltip badge's own nested <button> — invalid
                      // HTML, silently "repaired" by the browser in a way
                      // that breaks the tooltip's own group-hover CSS.
                      // `role="button"` + manual Enter/Space handling
                      // keeps this row keyboard-operable without that
                      // restriction.
                      <div
                        key={piece.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => selectPiece(piece)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            selectPiece(piece)
                          }
                        }}
                        className={`flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left ${
                          i === searchHighlight ? 'bg-paper-sunken' : 'hover:bg-paper-sunken'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 font-display text-sm font-medium text-ink">
                            <span className="truncate">{piece.title}</span>
                            {inProgram && (
                              <span onClick={(event) => event.stopPropagation()}>
                                <InfoTooltip
                                  message="Already in this setlist"
                                  ariaLabel="Already in this setlist"
                                  showPointerCursor={false}
                                  triggerClassName="shrink-0 text-accent"
                                >
                                  <IconCalendarFilled size={12} />
                                </InfoTooltip>
                              </span>
                            )}
                          </div>
                          <div className="truncate text-xs text-ink-soft">
                            {piece.composer} <span aria-hidden="true">•</span> {piece.keys.join(' › ')}
                          </div>
                        </div>
                        <span className="shrink-0 font-mono text-xs tabular-nums text-ink-soft">
                          {formatDuration(piece.durationSeconds)}
                        </span>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}

          {addRowMode === 'custom' && renderCustomEntryForm('add-custom-entry', 'relative border-t border-border p-3')}
          </div>
        </div>
      </div>
      </div>
    </Modal>

    {draggingId &&
      ghostPos &&
      draggingEntry &&
      createPortal(
        // A pure visual clone, not a real Modal descendant — `position:
        // fixed` inside Modal's own dialog would be trapped by its
        // `transition-[transform,opacity]`/`scale-*` classes (a `transform`
        // on an ancestor makes it the containing block for a fixed
        // descendant, same class of bug as the app's own documented
        // overflow-hidden-clips-a-popup gotcha) — portaling straight to
        // `document.body` sidesteps both that and the dialog's own rounded-
        // corner clipping. `pointer-events: none` so it never intercepts
        // `elementFromPoint` during the drag.
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: ghostPos.x - dragOffset.x,
            top: ghostPos.y - dragOffset.y,
            width: dragWidth,
            pointerEvents: 'none',
            zIndex: 9999,
          }}
          className="flex items-start gap-1.5 rounded-md border border-accent bg-paper-raised px-2 py-1.5 shadow-xl"
        >
          <span className="mr-1 shrink-0 self-center text-ink-soft/50">
            <IconGripVertical size={14} />
          </span>
          {draggingEntry.kind === 'custom' && (
            <span className="mt-0.5 shrink-0 text-ink-soft">
              <IconPencil size={13} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div
              className={`truncate ${
                draggingEntry.kind === 'piece'
                  ? 'font-display text-sm font-medium text-ink'
                  : 'font-sans text-sm font-normal text-ink-soft italic'
              }`}
            >
              {draggingEntry.title}
            </div>
            {draggingEntry.kind === 'piece' ? (
              <div className="truncate text-xs text-ink-soft">
                {draggingEntry.composer} <span aria-hidden="true">•</span> {draggingEntry.keys.join(' › ')}
              </div>
            ) : (
              draggingEntry.description && (
                <div className="line-clamp-2 text-xs text-ink-soft italic">
                  <MarkdownText>{draggingEntry.description}</MarkdownText>
                </div>
              )
            )}
          </div>
          {draggingEntry.durationSeconds != null && (
            <span className="mt-0.5 shrink-0 font-mono text-xs tabular-nums text-ink-soft">
              {formatDuration(draggingEntry.durationSeconds)}
            </span>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}

export function EditSetlistMockup() {
  useMockupTitle('Edit Setlist')
  const [modalOpen, setModalOpen] = useState(true)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('edit')
  const [modalTab, setModalTab] = useState<SetlistModalTab>('details')

  function openModal(mode: 'create' | 'edit', tab: SetlistModalTab = 'details') {
    setModalMode(mode)
    setModalTab(tab)
    setModalOpen(true)
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-6 md:px-8 md:py-8">
      <Link to="/mockup" className="inline-flex w-fit items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
        <IconArrowLeft size={20} />
        Setlists
      </Link>

      <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
        Reference sample — <span className="font-medium text-ink">Edit Setlist modal</span> (design doc §13, Phase
        10, decision 23) — the full fold: the former Edit Program modal no longer exists as its own mockup, and
        "Program Order" here is that file's own body, copied wholesale and unchanged. "Setlist Details" is the other
        tab — name/gig date/description. Doubles as the New Setlist create state — "Open New Setlist" opens the same
        modal blank, with an empty Program. "Open on Program Tab" demonstrates the Setlist Details page's own "Edit
        Program" button, which opens this same modal pre-landed on the Program Order tab instead of Setlist Details.
        Whole-setlist delete lives on the Setlist Details page itself (an icon-only button, same treatment as
        Piece/Book Details), not in this modal.
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => openModal('edit')}
          className="w-fit cursor-pointer rounded-md bg-accent px-4 py-2 font-display text-sm text-white hover:bg-accent/90"
        >
          Open Edit Setlist
        </button>
        <button
          type="button"
          onClick={() => openModal('edit', 'program')}
          className="w-fit cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-sm text-ink hover:border-accent"
        >
          Open on Program Tab
        </button>
        <button
          type="button"
          onClick={() => openModal('create')}
          className="w-fit cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-sm text-ink hover:border-accent"
        >
          Open New Setlist
        </button>
      </div>

      {/* Keyed by mode — forces a fresh instance (and fresh initial state)
          when switching between the "edit" and "create" demo buttons,
          rather than one persistent instance carrying stale edit-mode
          field values into a freshly-opened "New Setlist" state or vice
          versa. Not keyed by tab — switching between "Open Edit Setlist"
          and "Open on Program Tab" (both mode="edit") should reuse the
          same instance, exactly like the real Setlist Details page's own
          two trigger buttons do, and rely on `initialTab`'s own sync
          effect to land on the right tab each time. */}
      <EditSetlistModal
        key={modalMode}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        mode={modalMode}
        initialTab={modalTab}
        initialName={modalMode === 'edit' ? 'Sunday Morning Service' : ''}
        initialGigDate={modalMode === 'edit' ? daysFromNow(22) : ''}
        initialDescription={
          modalMode === 'edit'
            ? "Our regular Sunday service, followed by a fellowship reception in the parish hall. *Please note*: the organ's swell pedal is still being serviced, so dynamics will lean quieter than usual this week."
            : ''
        }
        onSave={() => {}}
      />
    </div>
  )
}
