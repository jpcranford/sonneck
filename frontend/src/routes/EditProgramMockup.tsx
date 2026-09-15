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
import { useMockupTitle } from '../lib/useMockupTitle'

// Setlists design pass, Phase 8 — originally the "Add Entries" modal (§13,
// Frontend surfaces item 4), built against Phase 7's approved comparison
// Artifact (https://claude.ai/code/artifact/d1582159-a06f-409d-b7ef-b26969b57067)
// — Option B, "Split — Browse / Staged." Turned dual-purpose in a later
// round (real Program on the right, drag-handle reorder, inline custom-
// entry edit — absorbing scope decisions 1/16 had reserved for two other
// not-yet-built modals), then renamed "Edit Entries." Full history of both
// rounds, plus the InfoTooltip font/consolidation work it triggered, is in
// memory `project_setlists_build.md`'s "Phase 8" sections — not repeated
// here.
//
// Renamed again, this round, to **Edit Program** (file: AddEntriesMockup.tsx
// → EditEntriesMockup.tsx → this), and rebuilt around a real 4-option style
// comparison Artifact rather than assumed: the split browse/program layout
// is gone — this modal now only ever shows the Program itself, one column,
// narrower (`size="lg"`, 672px, down from the two-pane view's `xl`/768px).
// Rows dropped the `paper-sunken` background pane they used to sit on — no
// separate colored backdrop at all now, just individually bordered cards
// sitting directly on the modal's own white body ("Option B — Bordered
// Cards" from that Artifact, the direction closest to what was already
// shipped, chosen over "Divided List" (UploadPortraitModal's own boxed
// Wikipedia-results shape), "Flat List" (People Library/Books' own
// hairline-divided rows), and "Accent CTA" (a tinted, higher-contrast add
// row)). The old always-visible search pane and its checkbox multi-select
// are gone too, replaced by a two-button row — "+ Piece" / "+ Custom" —
// ending the list itself: "+ Piece" turns that row into a real search bar,
// prefilled with the 5 most recently edited library pieces before any text
// is typed (`recentRank` on `LIBRARY_PIECES`) and searching the full
// library once you type; picking a result appends it and collapses back to
// the two buttons. "+ Custom" opens the same Name/Duration + Count-as-music
// toggle/Description form as before, unchanged.

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

// Same fixture universe as the Phase 7 artifact (12 pieces). No static
// "already in setlist" flag — membership is computed live against
// `programEntries` below (see `libraryPieceIdsInProgram`).
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
  // Markdown, via the real MarkdownText component (same as every other
  // description-shaped field in the app — Piece/Book/Setlist descriptions,
  // CLAUDE.md > Frontend's Markdown support note). Matches decision 15's
  // "custom entries support an optional free-text notes field" — renamed
  // "description" here to match this modal's own add/edit form label; the
  // real data model's `setlist_entries.custom_notes` column name may want
  // reconciling with this at build time.
  description?: string
  countsAsMusic?: boolean
}

type ProgramEntry = ProgramPieceEntry | ProgramCustomEntry

// The same 7 entries SetlistDetailsMockup.tsx's own INITIAL_ENTRIES shows
// for "Sunday Morning Service" — kept manually in sync (not a shared
// import; mockups hand-copy their own fixtures per this project's standing
// convention) so this modal's "before" state honestly matches what the
// real page displays. `libraryPieceId` links the 4 piece entries back to
// their LIBRARY_PIECES row for the live already-in-program computation.
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

interface EditProgramModalProps {
  open: boolean
  onClose: () => void
  setlistName: string
  libraryPieces?: ProgramLibraryPiece[]
  onSave?: (entries: ProgramEntry[]) => void
}

// What the bottom-of-list add row is currently showing — the two buttons,
// the piece search, or the custom-entry form. Only one at a time; picking a
// piece or submitting/canceling the custom form always returns here to
// 'buttons'.
type AddRowMode = 'buttons' | 'search' | 'custom'

export function EditProgramModal({
  open,
  onClose,
  setlistName,
  libraryPieces = LIBRARY_PIECES,
  onSave,
}: EditProgramModalProps) {
  const [programEntries, setProgramEntries] = useState<ProgramEntry[]>(INITIAL_PROGRAM_ENTRIES)
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
    setPieceQuery('')
    setSearchHighlight(-1)
    setAddRowMode('search')
  }

  function closeAddRow() {
    setAddRowMode('buttons')
  }

  // Selecting a result always appends a new instance (decision 4 —
  // duplicates allowed on purpose, so re-picking an already-in-program
  // piece is never blocked). Direct instruction: the search stays open
  // afterward rather than collapsing back to the two buttons, so adding
  // several pieces in a row doesn't need "+ Piece" pressed again each
  // time — only the query/highlight reset, back to "Recently edited," and
  // the input gets focus back for the next pick. Explicit dismissal (the
  // × on the input, Escape, or the corner × once back on "buttons") is
  // still the only thing that actually closes it.
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
    } else if (event.key === 'Enter') {
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

  function openEditCustomForm(entry: ProgramCustomEntry) {
    setEditingEntryId(entry.id)
    setCustomName(entry.title)
    setCustomDuration(entry.durationSeconds != null ? formatDuration(entry.durationSeconds) : '')
    setCustomDescription(entry.description ?? '')
    setCustomCountsAsMusic(entry.countsAsMusic ?? false)
    setAddRowMode('custom')
  }

  function closeCustomForm() {
    setEditingEntryId(null)
    setCustomName('')
    setCustomDuration('')
    setCustomDescription('')
    setCustomCountsAsMusic(false)
    closeAddRow()
  }

  // Direct instruction: the "+ Piece" / "+ Custom Entry" row itself never
  // disappears — clicking a button switches which content is expanded
  // below it (its own button taking on a pressed/active look), rather than
  // the whole row being replaced by that content the way it used to be.
  // Clicking the *already*-active button toggles it back closed — the
  // natural behavior for something styled as pressed, and it reuses the
  // exact same reset each explicit × already performs, so nothing about
  // discarding an in-progress custom draft is different depending on which
  // control closed it.
  function selectAddMode(mode: 'search' | 'custom') {
    if (addRowMode === mode) {
      if (mode === 'custom') closeCustomForm()
      else closeAddRow()
      return
    }
    if (mode === 'search') openPieceSearch()
    else openAddCustomForm()
  }

  // Direct instruction: adding a new custom entry keeps the form open
  // (fields reset, ready for the next one) instead of collapsing back to
  // the two buttons — the same "stay open until explicitly closed" as the
  // piece search. Saving an *edit* to an already-existing entry (opened via
  // its own pencil icon, `editingEntryId` set) still closes on save,
  // though — that's a one-off correction to a specific row, not a batch-add
  // flow, and there's nothing meaningful left to keep the form open *for*
  // once its one target entry is updated.
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
  // for that case). The whole card is the drag surface (direct instruction),
  // not just the grip icon — `.no-drag` on the pencil/remove buttons opts
  // them back out, checked before capture ever starts so their own click
  // still fires normally.
  //
  // Capture itself is set on `listRef` — the outer, never-reordered list
  // container — not on the card being dragged. A real bug found live,
  // reproduced deterministically (not just "sometimes on scroll"): once a
  // drag crosses into a neighboring row, the reorder swap moves that row's
  // own DOM node to a new position among its siblings (React's key-based
  // reconciliation, via `insertBefore`) — and Chromium drops pointer
  // capture the instant its *held* element is relocated in the DOM tree,
  // even though the node itself isn't removed or recreated. `onPointerUp`
  // then never fires (nothing was released, the browser just stopped
  // listening), so `draggingId` stayed stuck set — the card visibly parked
  // at 40% opacity and every further move did nothing, until an unrelated
  // click elsewhere reset state, which is exactly the "needs a click to
  // drop" symptom. `listRef.current` never moves in the DOM no matter how
  // many times its children reorder, so capturing there instead survives
  // any number of hops — confirmed by dragging a card across three
  // neighbors in one continuous gesture and by dispatching a synthetic
  // `pointercancel` mid-drag, both via Playwright, not just eyeballed.
  const listRef = useRef<HTMLDivElement>(null)

  // `target instanceof Element`, not `HTMLElement` — a click on the pencil/
  // remove button's own icon lands on its inner <svg>/<path>, which is an
  // SVGElement, not an HTMLElement (a second real bug found in the same
  // pass: the narrower check silently missed every icon click, letting the
  // card's own drag capture steal it — Chromium suppresses a descendant's
  // synthesized `click` once an ancestor holds pointer capture, so Remove/
  // Edit stopped firing entirely whenever the click landed on the icon
  // rather than the button's own padding). `Element` is the shared base
  // both HTML and SVG elements extend, and `closest()` is defined on it
  // either way.
  function isDragBlocker(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest('.no-drag') != null
  }

  // Reorders by id, not by reading `draggingId` from closure — lets this
  // get called safely from both the plain pointermove handler below and
  // the auto-scroll rAF loop's own effect (a different closure "generation"
  // each time `draggingId` changes), with no staleness to reason about
  // either way. `useCallback` with an empty dep array: its own behavior
  // never depends on anything from render (just the stable `setProgramEntries`
  // dispatcher), so this reference never changes — required for the
  // auto-scroll effect below to list it as a dependency without that effect
  // (and its rAF loop) restarting on every single reorder mid-drag.
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

  // A real bug found live: the grabbing-hand cursor only ever came from a
  // card's own `active:cursor-grabbing` class, which reverted to the plain
  // default arrow the instant the pointer moved off that specific card —
  // trivially easy during a real drag, since the ghost is a floating
  // visual with `pointer-events: none`, so whatever's actually under the
  // cursor at any moment is a gap between cards, the modal's own padding,
  // or another row entirely, none of which had any cursor override of
  // their own. `document.body`'s own inline `cursor` style is the standard
  // fix every custom-JS drag implementation reaches for here — `cursor` is
  // inherited, so it applies everywhere nothing more specific overrides
  // it, for the entire drag rather than only while hovering the one card
  // that started it. A `useEffect`, not a direct mutation inside the
  // pointerdown/pointerup handlers — this project's React Compiler setup
  // disallows mutating something defined outside the component (`document`
  // is global) from plain event-handler-shaped functions; tying it to
  // `draggingId` via an effect is exactly the "consider using an effect"
  // escape hatch the compiler's own error suggests, and it keeps the
  // cursor's own lifecycle declaratively following the same state the
  // ghost and the dimmed placeholder card already derive from.
  useEffect(() => {
    if (!draggingId) return
    document.body.style.cursor = 'grabbing'
    return () => {
      document.body.style.cursor = ''
    }
  }, [draggingId])

  // The ghost's own position updates on every move, independent of the
  // reorder logic below — direct instruction: dragging previously moved
  // nothing but the *array*, so the card being dragged only ever appeared
  // wherever its current sorted index placed it, snapping discretely from
  // one row's slot to the next rather than following the pointer. Now the
  // floating ghost (rendered via `createPortal`, below) tracks the actual
  // cursor continuously; the reorder-on-crossing logic is unchanged and
  // still live-updates `programEntries` as the ghost passes over a
  // neighbor, so the list is already in its final order by the time the
  // pointer is released — only the *visual* dragged object was decoupled
  // from that, not the underlying reorder timing.
  function onListPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingId) return
    setGhostPos({ x: event.clientX, y: event.clientY })
    lastPointerRef.current = { x: event.clientX, y: event.clientY }
    reorderAtPoint(draggingId, event.clientX, event.clientY)
  }

  // Auto-scroll while the ghost sits near the list's own scrolled top/bottom
  // edge — real gap found live: dragging to the visible top/bottom with
  // more entries above/below never scrolled at all, since nothing but
  // `pointermove` ever ran the reorder check, and a stationary pointer
  // parked at the edge produces no further `pointermove` events for that to
  // react to. A `requestAnimationFrame` loop, started fresh whenever a drag
  // begins (the effect's own dependency is `draggingId`, so it reliably
  // gets a new closure each drag rather than reading a stale one), scrolls
  // the container at a speed that ramps up the closer the *last known*
  // pointer position is to either edge, and re-runs the reorder check
  // against that same last-known position on every frame — not just on
  // `pointermove` — so the list keeps reordering correctly under a
  // stationary pointer as new rows scroll into reach underneath it.
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
    setProgramEntries(INITIAL_PROGRAM_ENTRIES)
    closeAddRow()
    closeCustomForm()
    onClose()
  }

  function handleSave() {
    onSave?.(programEntries)
    onClose()
  }

  const draggingEntry = draggingId ? programEntries.find((e) => e.id === draggingId) : undefined

  return (
    <>
    <Modal
      open={open}
      onClose={handleCancel}
      labelledBy="edit-program-title"
      size="md"
      header={
        // Matches EditPieceModal/EditBookModal/EditPersonModal's own header
        // exactly — title size, subtitle size, the full-bleed border-b
        // (-mx-6/px-6 cancels Modal's own px-6 header padding then reapplies
        // it, so the line reaches the dialog's true edges), and the corner
        // close button — this modal had drifted from that shared shape
        // (smaller title, no divider, no visible close button) since it
        // predates the other three's own header convention.
        <div className="-mx-6 flex items-start justify-between gap-4 border-b border-border px-6 pb-4">
          <div>
            <h2 id="edit-program-title" className="font-display text-2xl font-medium text-ink">
              Edit program
            </h2>
            <p className="text-sm text-ink-soft">{setlistName}</p>
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
      }
      footer={
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
            className="cursor-pointer rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90"
          >
            Save
          </button>
        </div>
      }
    >
      <p className="mb-2 text-xs font-medium tracking-wide text-ink-soft uppercase">Program ({programEntries.length})</p>
      <div
        ref={listRef}
        onPointerMove={onListPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        className="flex flex-col gap-1.5"
      >
        {programEntries.map((entry) => (
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
        ))}

        {/* Add row — ends the list itself. "Bordered Cards" (Option B of a
            4-way style Artifact): a plain bordered box that matches the
            entry rows' own card chrome, not a dashed/tinted "empty state"
            treatment. The two-button row is always rendered now (direct
            instruction) — it no longer gets replaced by whichever content
            is active; that content expands directly below it, inside this
            same bordered card, with the active button restyled to look
            pressed. Buttons themselves aren't independently rounded
            anymore (the outer card's own `overflow-hidden` handles that
            corner now, with a `border-r` divider between them — a plain
            segmented-control shape), and the content section below picks
            up its old card's own border/background as a `border-t` divider
            plus this shared wrapper's `bg-paper-raised` instead. The
            pressed state itself is deliberately neutral (`bg-paper-sunken
            text-ink`), not accent-colored — direct correction, since accent
            is this button row's own *hover* language too (still used for
            the idle button's hover state), and reusing it for "this is the
            one that's currently open" made hover and selected read as the
            same signal. `bg-paper-sunken` is this app's own established
            "highlighted/active row" neutral already, e.g. the piece search
            results' own keyboard-highlighted row uses the same token. */}
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
          <div className="border-t border-border p-2.5">
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
                    // A real <button> can't validly contain the InfoTooltip
                    // badge's own nested <button> (a button-inside-a-button
                    // is invalid HTML — the browser silently "repairs" that
                    // nesting, breaking the tooltip's own group-hover CSS
                    // entirely, since the repaired DOM no longer matches the
                    // JSX tree). `role="button"` + manual Enter/Space
                    // handling keeps this row keyboard-operable without
                    // that restriction — the same fix this modal's own
                    // library-piece rows already needed once before.
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
                            // stopPropagation only — the font-leak this used
                            // to also guard against is fixed at the source
                            // now, in InfoTooltip.tsx's own bubble className.
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

        {addRowMode === 'custom' && (
          // Field labels/inputs match EditPieceModal/EditBookModal/
          // EditPersonModal's own real form conventions — sentence-case
          // `text-sm text-ink-soft` labels (not the small-caps tracked
          // micro-labels this form used before), `px-3 py-2` inputs on
          // `bg-paper-raised` at the default text size (not the smaller/
          // denser `px-2 py-1 text-sm` on plain `bg-paper`), and no custom
          // `focus:border-accent` override — the app's own global
          // `:focus-visible` outline (index.css) is what every real modal
          // field already relies on.
          // A real <form>, scoped to just this sub-form's own fields — not
          // the whole modal body, which would make Enter in any of these
          // fields fire the top-level Save/close instead of this form's own
          // Add/Save action (the piece-search input above already handles
          // its own Enter via onKeyDown for the identical reason). Matches
          // the real modals' own Enter-to-submit convention at the scope it
          // actually applies here.
          //
          // Field/font sizes (`text-sm`, `py-1.5`) and the corner ×
          // dismiss button both match its "+ Piece" sibling above — the
          // two add-row sub-forms sit in the exact same slot in the list
          // and should read as the same weight, not one visibly larger
          // than the other. The corner × is an addition, not a
          // replacement — the footer Cancel/Save pair below still does
          // the same job for anyone who reaches for it instead.
          <form
            onSubmit={(event) => {
              event.preventDefault()
              submitCustomForm()
            }}
            className="relative border-t border-border p-3"
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
        )}
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
        // `elementFromPoint` during the drag; font sizes match the real
        // cards exactly (`text-sm`/`text-xs`), same as the "+ Piece"
        // dropdown rows they were both just bumped to match.
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

export function EditProgramMockup() {
  useMockupTitle('Edit Program')
  const [open, setOpen] = useState(true)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-6 md:px-8 md:py-8">
      <Link to="/mockup" className="inline-flex w-fit items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
        <IconArrowLeft size={20} />
        Setlists
      </Link>

      <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
        Reference sample — <span className="font-medium text-ink">Edit Program modal</span> (design doc §13, Phase 8,
        restyled to a single-column, bordered-card list). Drag anywhere on a card to reorder it (not just the grip
        icon); click a custom entry's pencil to edit its name/duration/description/"Count as music"; click × to
        remove any row. "+ Piece" opens a search bar prefilled with your 5 most recently edited pieces; "+ Custom
        Entry" opens the same fields form. Nothing is final until "Save"; "Cancel" discards every change this
        session, including reorders.
      </div>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-fit cursor-pointer rounded-md bg-accent px-4 py-2 font-display text-sm text-white hover:bg-accent/90"
      >
        Open Edit Program
      </button>

      <EditProgramModal open={open} onClose={() => setOpen(false)} setlistName="Sunday Morning Service" onSave={() => {}} />
    </div>
  )
}
