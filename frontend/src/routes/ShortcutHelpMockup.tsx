import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Checkbox } from '../components/Checkbox'
import { useMockupTitle } from '../lib/useMockupTitle'
import { useShortcutBlocker } from '../lib/shortcuts'

// ---------------------------------------------------------------------
// DESIGN MOCKUP — the shortcut help: hold / or ? for about a second (not
// while typing) and a small card in the bottom-right corner lists the
// current page's shortcuts; letting go hides it. Design D of a side-by-side
// (https://claude.ai/artifact/9DnBZ9e89ARPXfZ69fHEH4); a "Keep holding"
// pill fills while the key is held. Keys the viewer can't use are left
// off; a page's edit window keys are listed for reference; the sidebar's
// number keys fold into one line. The lists below copy the real ones each
// page registers with lib/shortcuts.ts — not wired to it, so a choice of
// page and viewer can be previewed from here.
// ---------------------------------------------------------------------

const HOLD_MS = 1000
// The pill waits this long into a / hold (a tap of / is a shortcut), so a
// quick tap never flashes it; a ? hold shows it at once.
const PILL_DELAY_MS = 100

type Perm = 'edit' | 'download' | 'create'
interface Row {
  keys: string[]
  label: string
  needs?: Perm
}
interface PageList {
  title: string
  keys: Row[]
  window?: { title: string; needs?: Perm; keys: Row[] }
}

const LIBRARY_KEYS: Row[] = [
  { keys: ['/'], label: 'Search (tap)' },
  { keys: ['V'], label: 'Switch to list view' },
  { keys: ['F'], label: 'Filters' },
  { keys: ['O'], label: 'Sort by…' },
  { keys: ['R'], label: 'Reverse the sort' },
]
const SAVE_CLOSE: Row[] = [
  { keys: ['Shift', 'Enter'], label: 'Save' },
  { keys: ['Esc'], label: 'Close' },
]

const PAGES = {
  piece: {
    title: 'Piece Details',
    keys: [
      { keys: ['E'], label: 'Edit piece', needs: 'edit' },
      { keys: ['F'], label: 'Add to favorites', needs: 'edit' },
      { keys: ['P'], label: 'Open the page viewer' },
      { keys: ['D'], label: 'Download PDF', needs: 'download' },
      { keys: ['S'], label: 'Add to setlist', needs: 'create' },
      { keys: ['C'], label: 'Copy citation' },
    ],
    window: {
      title: 'In Edit Piece',
      needs: 'edit',
      keys: [
        { keys: ['Enter'], label: 'Save' },
        { keys: ['Shift', 'Enter'], label: 'Save & close' },
        { keys: ['←', '→'], label: 'Previous / next piece' },
        { keys: ['Esc'], label: 'Close' },
      ],
    },
  },
  book: {
    title: 'Book Details',
    keys: [
      { keys: ['E'], label: 'Edit book', needs: 'edit' },
      { keys: ['O'], label: 'Open the book’s PDF', needs: 'download' },
    ],
    window: { title: 'In Edit Book', needs: 'edit', keys: SAVE_CLOSE },
  },
  person: {
    title: 'Person Details',
    keys: [{ keys: ['E'], label: 'Edit person', needs: 'edit' }],
    window: { title: 'In Edit Person', needs: 'edit', keys: SAVE_CLOSE },
  },
  setlist: {
    title: 'Setlist Details',
    keys: [
      { keys: ['E'], label: 'Edit setlist' },
      { keys: ['D'], label: 'Download Set PDF', needs: 'download' },
      { keys: ['C'], label: 'Copy program as plain text' },
      { keys: ['M'], label: 'Copy program as Markdown' },
    ],
    window: { title: 'In Edit Setlist', keys: SAVE_CLOSE },
  },
  library: { title: 'Library', keys: LIBRARY_KEYS },
  books: {
    title: 'Books',
    keys: [...LIBRARY_KEYS, { keys: ['N'], label: 'New Book', needs: 'edit' }],
  },
  people: {
    title: 'People',
    keys: [...LIBRARY_KEYS, { keys: ['N'], label: 'New Person', needs: 'edit' }],
  },
  setlists: { title: 'Setlists', keys: [{ keys: ['N'], label: 'New setlist', needs: 'create' }] },
  settings: { title: 'User Settings', keys: [] },
} satisfies Record<string, PageList>
type PageId = keyof typeof PAGES

const PAGE_OPTIONS: { id: PageId; label: string }[] = [
  { id: 'piece', label: 'Piece Details' },
  { id: 'book', label: 'Book Details' },
  { id: 'person', label: 'Person Details' },
  { id: 'setlist', label: 'Setlist Details' },
  { id: 'library', label: 'Library' },
  { id: 'books', label: 'Books' },
  { id: 'people', label: 'People' },
  { id: 'setlists', label: 'Setlists' },
  { id: 'settings', label: 'User Settings' },
]

// Library, People, Books, Upload, Favorites, Want to Learn, Currently
// Practicing, Learned, then Setlists — minus Books when hidden. Upload
// keeps its number without permission, as it keeps its (faded) place in
// the sidebar.
function sidebarCount(booksHidden: boolean): number {
  return booksHidden ? 8 : 9
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[5px] border border-b-2 border-border bg-paper-raised px-1.5 font-sans text-xs font-semibold text-ink">
      {children}
    </kbd>
  )
}

function Keys({ keys }: { keys: string[] }) {
  if (keys.length === 1) return <Key>{keys[0]}</Key>
  // ← → read as a pair, numbers as a range ("1–9"); a modifier combo gets
  // a "+".
  const joiner =
    keys[0] === '←' ? null : (
      <span className="text-ink-faint">{/^\d+$/.test(keys[0]) ? '–' : '+'}</span>
    )
  return (
    <span className="inline-flex shrink-0 items-center gap-[3px]">
      {keys.map((key, i) => (
        <span key={key} className="inline-flex items-center gap-[3px]">
          {i > 0 && joiner}
          <Key>{key}</Key>
        </span>
      ))}
    </span>
  )
}

function KeyRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center gap-2.5 py-0.5 text-sm text-ink">
      <Keys keys={keys} />
      <span>{label}</span>
    </div>
  )
}

const SECTION = 'mb-1.5 text-[0.7rem] tracking-[0.08em] text-ink-muted uppercase'

function ShortcutCard({
  list,
  can,
  sidebarKeys,
  heldKey,
}: {
  list: PageList
  can: (perm?: Perm) => boolean
  sidebarKeys: number
  heldKey: string
}) {
  const keys = list.keys.filter((row) => can(row.needs))
  const window = list.window && can(list.window.needs) ? list.window : null
  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="pointer-events-none fixed right-4 bottom-4 z-[70] max-h-[calc(100dvh-2rem)] w-[270px] overflow-hidden rounded-lg border border-border bg-paper-raised p-4 shadow-lg"
    >
      <p className={SECTION}>{list.title}</p>
      {keys.map((row) => (
        <KeyRow key={row.label} {...row} />
      ))}
      {window && (
        <>
          <p className={`${SECTION} mt-2.5`}>{window.title}</p>
          {window.keys.map((row) => (
            <KeyRow key={row.label} {...row} />
          ))}
        </>
      )}
      <div className="mt-1.5 border-t border-border pt-2">
        <KeyRow keys={['1', String(sidebarKeys)]} label="Sidebar, top to bottom" />
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted">
        Let go of <Key>{heldKey}</Key> to close
      </p>
    </div>
  )
}

// Shown while the key is held, before the card: a ring fills over the
// second so it's clear holding is doing something. Centered on the content
// area (right of the sidebar), not the whole window — `centerX` is that
// area's middle, measured when the hold starts. `delayed`: waits
// PILL_DELAY_MS, its ring then starting that far along.
function HoldPill({ centerX, delayed }: { centerX: number; delayed: boolean }) {
  const [visible, setVisible] = useState(!delayed)
  useEffect(() => {
    if (!delayed) return
    const timer = window.setTimeout(() => setVisible(true), PILL_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [delayed])
  if (!visible) return null
  const elapsed = delayed ? PILL_DELAY_MS : 0
  const startOffset = 50.3 * (1 - elapsed / HOLD_MS)
  return (
    <div
      style={{ left: centerX }}
      className="pointer-events-none fixed bottom-6 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full bg-scrim/95 py-1.5 pr-3 pl-2.5 text-xs text-white"
    >
      <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
        <circle
          cx="10"
          cy="10"
          r="8"
          fill="none"
          stroke="rgb(255 255 255 / 0.3)"
          strokeWidth="2.5"
        />
        <circle
          cx="10"
          cy="10"
          r="8"
          fill="none"
          stroke="#fff"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="50.3"
          strokeDashoffset={startOffset}
          transform="rotate(-90 10 10)"
        >
          <animate
            attributeName="stroke-dashoffset"
            from={startOffset}
            to="0"
            dur={`${HOLD_MS - elapsed}ms`}
            fill="freeze"
          />
        </circle>
      </svg>
      Keep holding for shortcuts
    </div>
  )
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
    return true
  if (target.tagName !== 'INPUT') return false
  const type = (target as HTMLInputElement).type
  return type !== 'checkbox' && type !== 'radio'
}

export function ShortcutHelpMockup() {
  useMockupTitle('Shortcut Help')
  const [page, setPage] = useState<PageId>('piece')
  const [canEdit, setCanEdit] = useState(true)
  const [canDownload, setCanDownload] = useState(true)
  const [canCreate, setCanCreate] = useState(true)
  const [booksHidden, setBooksHidden] = useState(false)
  // null, or the key being held and whether the card is showing yet.
  // The app's own shortcut help (AppShell) stands aside on this page, which
  // draws its own copy for whichever page and viewer are picked above.
  useShortcutBlocker(true)
  const [hold, setHold] = useState<{ key: string; shown: boolean; centerX: number } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  function startHold(key: string) {
    const content = document.getElementById('app-scroll-container')?.getBoundingClientRect()
    const centerX = content ? content.left + content.width / 2 : window.innerWidth / 2
    setHold({ key, shown: false, centerX })
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setHold({ key, shown: true, centerX }), HOLD_MS)
  }
  function endHold() {
    window.clearTimeout(timer.current)
    setHold(null)
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '/' && event.key !== '?') return
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      event.preventDefault()
      startHold(event.key)
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.key === '/' || event.key === '?' || event.key === 'Shift') endHold()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', endHold)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', endHold)
      window.clearTimeout(timer.current)
    }
  }, [])

  const can = (perm?: Perm) =>
    !perm ||
    (perm === 'edit' && canEdit) ||
    (perm === 'download' && canDownload) ||
    (perm === 'create' && canCreate)

  const toggles: [string, boolean, (v: boolean) => void][] = [
    ['Can edit', canEdit, setCanEdit],
    ['Can download', canDownload, setCanDownload],
    ['Can create setlists', canCreate, setCanCreate],
    ['Books hidden in the sidebar', booksHidden, setBooksHidden],
  ]

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8">
      <h1 className="font-display text-3xl font-medium text-ink">Shortcut Help</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-soft">
        Hold <Key>/</Key> or <Key>?</Key> for about a second — anywhere but a text field — and a
        card in the corner lists this page's shortcuts until you let go. Choose a page and what the
        viewer is allowed to do; keys they can't use are left off.
      </p>

      <div className="mt-6 flex flex-col gap-5">
        <div>
          <p className="mb-2 text-xs tracking-wide text-ink-soft uppercase">Page</p>
          <div className="flex flex-wrap gap-1.5">
            {PAGE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={page === option.id}
                onClick={() => setPage(option.id)}
                className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm ${
                  page === option.id
                    ? 'border-accent/30 bg-accent-soft text-accent'
                    : 'border-border bg-paper-raised text-ink-soft hover:bg-paper-hover hover:text-ink'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs tracking-wide text-ink-soft uppercase">Viewer</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {toggles.map(([label, value, set]) => (
              <label
                key={label}
                className="flex cursor-pointer items-center gap-2 text-sm text-ink"
              >
                <Checkbox checked={value} onChange={(event) => set(event.target.checked)} />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border p-4">
          <p className="flex-1 text-sm text-ink-soft">
            {hold?.shown
              ? 'Showing — let go to hide it.'
              : hold
                ? 'Keep holding…'
                : 'Hold / or ? now. On a phone, press and hold the button.'}
          </p>
          <button
            type="button"
            onPointerDown={(event) => {
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
              startHold('/')
            }}
            onPointerUp={endHold}
            onPointerCancel={endHold}
            onContextMenu={(event) => event.preventDefault()}
            className="cursor-pointer touch-none rounded-md border border-border bg-paper-raised px-4 py-2 font-display font-medium text-sm text-ink select-none hover:border-accent"
          >
            Press and hold to preview
          </button>
        </div>
      </div>

      {hold && !hold.shown && <HoldPill centerX={hold.centerX} delayed={hold.key === '/'} />}
      {hold?.shown && (
        <ShortcutCard
          list={PAGES[page]}
          can={can}
          sidebarKeys={sidebarCount(booksHidden)}
          heldKey={hold.key}
        />
      )}
    </div>
  )
}
