import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  IconAdjustmentsHorizontal,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowLeft,
  IconBallpen,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCircle,
  IconCircleOff,
  IconCircleCheckFilled,
  IconClef,
  IconClock,
  IconContrast,
  IconDots,
  IconEraser,
  IconGripVertical,
  IconHighlight,
  IconInfoCircle,
  IconListNumbers,
  IconMetronome,
  IconMinus,
  IconNotebook,
  IconPencil,
  IconPhotoCog,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlaylist,
  IconPlus,
  IconRefresh,
  IconStopwatch,
  IconSun,
  IconTypography,
  IconX,
} from '@tabler/icons-react'
import { getPiece, getPiecePageUrl, getPieceThumbnailUrl, searchPieces } from '../api/pieces'
import { listPracticeStatuses } from '../api/lookups'
import { Checkbox } from '../components/Checkbox'
import { InfoTooltip } from '../components/InfoTooltip'
import { MarkdownText } from '../components/MarkdownText'
import { PracticeStatusKeyIcon } from '../components/PracticeStatusIcon'
import { SingleSelect } from '../components/SingleSelect'
import { Toggle } from '../components/Toggle'
import { useAnchoredPanel } from '../hooks/useAnchorRect'
import { useNoPageScroll } from '../hooks/useNoPageScroll'
import { stageTurn, type StagePoint } from '../lib/sheetViewerGestures'
import { sortPracticeStatuses } from '../lib/practiceStatusOrder'
import { useShortcutBlocker } from '../lib/shortcuts'
import { useMockupTitle } from '../lib/useMockupTitle'
import { copyToClipboard } from '../lib/clipboard'
import {
  clearInterruptedTurnTest,
  interruptedTurnTest,
  runTurnTest,
} from '../lib/sheetViewerTurnTest'

// Sheet Viewer, Phase 2 of its plan: the mode's working page — score and
// toolbar — with no annotations and no new backend. Built from the Phase 1
// picks (https://claude.ai/artifact/5s44AKhdG75qTVCazN3A7d): a top bar in
// every orientation; Annotate swaps in a tinted toolbar of tools; the
// ‹ n / N › page cyclers sit in the same spot in both modes; Annotate opens
// with no tool, and tapping the picked tool again puts it down; side-thirds
// tap zones; the clock in the toolbar, its icon following its mode; the
// theory reference's icon is the clef. Notes and practice status will live
// in the Info drawer (Phases 3–4); photo filters are Phase 5; the
// annotation tools here are placeholders until Phase 11.
//
// Pages are the selected piece's real page images from the existing
// thumbnail endpoint (read-only) — the mode's own full-resolution pages
// come with the Phase 9 rendering core.
//
// Every control's hit area is 48×48 (Phase 0): a 48px button around a
// smaller drawn face. Each carries data-hit for
// frontend/scripts/check-hit-areas.mjs, which measures them.

const HIT =
  'relative flex h-12 min-w-12 shrink-0 cursor-pointer items-center justify-center group-data-[hits=true]/sv:outline group-data-[hits=true]/sv:outline-1 group-data-[hits=true]/sv:-outline-offset-1 group-data-[hits=true]/sv:outline-dashed group-data-[hits=true]/sv:outline-danger'
const FACE =
  'flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-[10px] whitespace-nowrap'
// The hover fill follows the surface: paper-hover on the Play toolbar and in
// menus, a lighter step of the tint on Annotate's accent-soft toolbar. Each
// surface sets --sv-hover.
const FACE_HOVER = 'group-hover/b:bg-(--sv-hover)'

const TOOLS = [
  { key: 'pen', label: 'Pen', Icon: IconBallpen },
  { key: 'highlighter', label: 'Highlighter', Icon: IconHighlight },
  { key: 'eraser', label: 'Eraser', Icon: IconEraser },
  { key: 'text', label: 'Text', Icon: IconTypography },
] as const
type Tool = (typeof TOOLS)[number]['key']
// Placeholder palette — the real one is designed in Phase 11.
const COLORS = ['#2b2622', '#c0392b', '#2f6fb5', '#e0a526']

// Practice statuses in practice order, by their durable icon (the real
// strip reads the viewer's own list; this mockup writes nothing).
// Shown when the picked piece has no notes of its own yet.
const EXAMPLE_NOTES =
  '**Big picture:** keep it moving; the middle section is a waltz, not a ballad.\nOct 12 — first time through at tempo. Left hand still heavy in the bridge.'
// Phase 3: notes are broad strokes and practice-log entries; markings on the
// music itself belong in Annotate.
const EMPTY_NOTES =
  'Nothing yet. Big picture notes go here: what to remember about this piece, or a log of how practice is going. Markings on the music can be made in Annotate mode.'
const INFO_WIDTH = 380
const QUEUE_WIDTH = 380
// Phase 6 (30s per the round-3 answers): a piece counts as practiced today
// once its last page has been
// reached and at least this long has been spent on it.
const PRACTICED_MS = 30_000

// A setlist's custom entries (Phase 6): each gets a placeholder page in the
// session, drawn like the Setlist PDF's Generated Program Page. Fixtures.
interface CustomEntry {
  name: string
  role: string
  notes?: string
  duration?: string
}
const CUSTOM_ENTRIES: Record<string, CustomEntry> = {
  'c:welcome': {
    name: 'Welcome and Announcements',
    role: 'Welcome',
    notes: 'Introduce the guest choir before the prelude.',
    duration: '3:00',
  },
  'c:offering': { name: 'Offering', role: 'Offertory', duration: '4:00' },
  'c:benediction': { name: 'Benediction', role: 'Sending' },
}
type QueueKey = number | string
const PHOTO_WIDTH = 320

// Photo controls (Phase 5): discrete steps, never live-dragged values.
interface Photo {
  brightness: number
  contrast: number
  grayscale: boolean
  invert: boolean
  margin: boolean
}
const PHOTO_DEFAULT: Photo = {
  brightness: 100,
  contrast: 100,
  grayscale: false,
  invert: false,
  margin: false,
}
const PHOTO_STEP = 10
const PHOTO_MIN = 50
const PHOTO_MAX = 150

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  return `${m}:${String(seconds % 60).padStart(2, '0')}`
}
// The notes bar shows the first line, Markdown and all.
function firstLine(markdown: string) {
  return (markdown.split('\n').find((l) => l.trim()) ?? '').trim()
}

// Debounced turns (locked plan rule): a turn in the same direction within
// this long of the last one is ignored; the opposite direction always fires.
const DEBOUNCE_MS = 500
const CLOSE_CONFIRM_MS = 3000
const HINT_MS = 1800

function subscribeResize(callback: () => void) {
  window.addEventListener('resize', callback)
  return () => window.removeEventListener('resize', callback)
}
// The layout viewport's width, which pinch-zoom never changes: iPad Safari
// shrinks window.innerWidth as you zoom in, which switched the toolbar to
// its phone layout mid-zoom and redrew every page.
function useWindowWidth() {
  return useSyncExternalStore(subscribeResize, () => document.documentElement.clientWidth)
}

// Whether the page is pinch-zoomed in (the visual viewport scaled up).
// Browsers without visualViewport never report it.
function subscribeViewportZoom(callback: () => void) {
  window.visualViewport?.addEventListener('resize', callback)
  return () => window.visualViewport?.removeEventListener('resize', callback)
}
function usePinchZoomed() {
  return useSyncExternalStore(
    subscribeViewportZoom,
    () => (window.visualViewport?.scale ?? 1) > 1.05,
  )
}

/** The clock and stopwatch readouts: Atkinson Hyperlegible Next with
 * tabular figures (--font-clock), so the time never shifts as it ticks;
 * picked from https://claude.ai/artifact/MErMxck4q46QJopCX3fGs1. Its colons
 * sit on the baseline, so each is raised 0.09em — centered on the figures'
 * height, measured from the font's own outlines. */
function ClockText({ text }: { text: string }) {
  return (
    <span className="font-clock whitespace-nowrap tabular-nums">
      {text.split(':').map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="relative -top-[0.09em]">:</span>}
          {part}
        </Fragment>
      ))}
    </span>
  )
}

const pad = (n: number) => String(n).padStart(2, '0')
// The stopwatch always shows seconds — without them it sat at 00:00 for its
// first minute and read as broken.
// Started or resumed between two of the readout's 250ms ticks, "now" is still
// the last tick's time, a moment before the start — clamped, so it never
// reads as negative (-1 seconds).
function stopwatchText(ms: number) {
  const s = Math.floor(Math.max(0, ms) / 1000)
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
}
// The clock's seconds are the menu's Show seconds switch (off by default);
// it keeps its leading zeros either way.
const clockFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const clockFormatSeconds = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

// No title tooltips on the viewer's controls (user, 2026-10-21): once Chrome
// on the Mac shows one, it keeps the plain arrow cursor while tooltip mode
// lasts, and a toolbar of touching buttons never lets it reset — so the hand
// cursor vanished across the whole bar. Each control keeps its aria-label.
function HitButton({
  label,
  onClick,
  children,
  faceClassName = '',
  disabled,
  inset,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  faceClassName?: string
  disabled?: boolean
  /** Keeps a face wider than 40px 4px inside its tap area, as a 40px face
   * always is — so a wide toolbar button (the armed "Exit?", the labeled
   * Annotate, the clock) sits as far from the screen's edge and its
   * neighbors as an icon does. */
  inset?: boolean
}) {
  return (
    <button
      type="button"
      data-hit
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`${HIT} group/b disabled:opacity-50 ${inset ? 'px-1' : ''}`}
    >
      <span className={`${FACE} ${faceClassName || FACE_HOVER}`}>{children}</span>
    </button>
  )
}

/** A faint, tappable "coming soon" button — the app's InfoTooltip treatment. */
function SoonButton({
  label,
  message,
  children,
}: {
  label: string
  message: string
  children: ReactNode
}) {
  return (
    <span data-hit className={HIT}>
      <InfoTooltip
        message={message}
        ariaLabel={label}
        showPointerCursor={false}
        triggerClassName="flex size-12 items-center justify-center text-ink-fainter"
      >
        {children}
      </InfoTooltip>
    </span>
  )
}

type ClockMode = 'clock' | 'stopwatch'

export function SheetViewerMockup() {
  useMockupTitle('Sheet Viewer')
  // Page shortcuts (letters, numbers, the shortcut help) stay off while the
  // viewer is up; it has its own keys — the pedal set below.
  useShortcutBlocker(true)
  // Nothing here scrolls: no page bounce, no browser pull-to-refresh.
  useNoPageScroll()
  const navigate = useNavigate()
  const width = useWindowWidth()
  // Pinch-zoomed in, the score pans instead of turning: taps and swipes
  // on it do nothing (the pedal keys and the toolbar still turn).
  const zoomed = usePinchZoomed()
  const tier = width >= 1100 ? 'wide' : width >= 640 ? 'mid' : 'phone'
  // Below 900px the labeled Annotate button doesn't fit (beside the clock
  // and Info with the cyclers centered; on a phone, beside the title, Info
  // and ⋯), so it's an icon there.
  const annotateLabel = width >= 900

  const [pieceId, setPieceId] = useState<number | null>(null)
  // The Mockup panel's turn test (lib/sheetViewerTurnTest.ts). A run that
  // Safari cut short by reloading the tab shows its report on return.
  const [turnTestResult, setTurnTestResult] = useState<string | null>(interruptedTurnTest)
  const [turnTestRunning, setTurnTestRunning] = useState(false)
  const [turnTestCopied, setTurnTestCopied] = useState(false)
  const { data: recent = [] } = useQuery({
    queryKey: ['pieces', 'sheet-viewer-mockup'],
    queryFn: () => searchPieces({ sort: 'dateAdded', dir: 'desc', limit: 60 }),
  })
  const activeId = pieceId ?? recent.find((p) => p.pageCount > 1)?.id ?? recent[0]?.id ?? null
  const { data: piece } = useQuery({
    queryKey: ['piece', activeId],
    queryFn: () => getPiece(activeId as number),
    enabled: activeId !== null,
  })
  // A setlist session's custom entry showing instead of a piece.
  // Entry points link here with ?from=list (the sidebar's Practice List)
  // or ?from=setlist (Play Set); plain Play opens a single piece.
  const [searchParams] = useSearchParams()
  const from = searchParams.get('from')
  const [customKey, setCustomKey] = useState<string | null>(() =>
    from === 'setlist' ? 'c:welcome' : null,
  )
  const custom = customKey ? CUSTOM_ENTRIES[customKey] : null
  const pageCount = custom ? 1 : (piece?.pageCount ?? 1)

  // Practice List (Phase 6). Mockup fixtures from the library's newest
  // multi-page pieces; nothing is written.
  type SessionKind = 'piece' | 'list' | 'setlist'
  const [sessionKind, setSessionKind] = useState<SessionKind>(() =>
    from === 'list' ? 'list' : from === 'setlist' ? 'setlist' : 'piece',
  )
  const [listOverride, setListOverride] = useState<number[] | null>(null)
  const multi = recent.filter((p) => p.pageCount > 1)
  const practiceList = listOverride ?? multi.slice(0, 5).map((p) => p.id)
  const setlistPieces = multi.slice(5, 10).map((p) => p.id)
  const setlistQueue: QueueKey[] = [
    'c:welcome',
    ...setlistPieces.slice(0, 2),
    'c:offering',
    ...setlistPieces.slice(2),
    'c:benediction',
  ]
  const SETLIST_NAME = 'Sunday Service (example)'
  const queueIds: QueueKey[] =
    sessionKind === 'list' ? practiceList : sessionKind === 'setlist' ? setlistQueue : []
  const currentKey: QueueKey | null = customKey ?? activeId
  const queueIndex = currentKey === null ? -1 : queueIds.indexOf(currentKey)
  const byId = new Map(recent.map((p) => [p.id, p]))
  // Practiced today: true marked, false explicitly unmarked (not re-marked
  // automatically that day). Clears at midnight in the real thing.
  const [practiced, setPracticed] = useState<Record<number, boolean>>({})
  const [fastMinute, setFastMinute] = useState(false)
  // User Settings' "Track practice in the Sheet Viewer" (on by default).
  const [trackingOn, setTrackingOn] = useState(true)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  // The floating card that follows the pointer while dragging (Edit
  // Program's own pattern): where the pointer is, and where it grabbed the
  // row, so the card keeps that offset.
  const [dragGhost, setDragGhost] = useState<{
    x: number
    y: number
    dx: number
    dy: number
    width: number
  } | null>(null)

  const [page, setPage] = useState(1)
  const [mode, setMode] = useState<'play' | 'annotate'>('play')
  const [tool, setTool] = useState<Tool | null>(null)
  const [color, setColor] = useState(0)
  const [menu, setMenu] = useState<'clock' | 'more' | 'info' | 'photo' | 'queue' | null>(null)
  // Photo controls and the margin, per piece (a practice setting).
  const [photoByPiece, setPhotoByPiece] = useState<Record<number, Photo>>({})
  // The theme and Dark Mode Scores as the page opened with them; the Mockup
  // panel can try the other theme (restored on leaving).
  const [initialTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  )
  const [theme, setTheme] = useState<'light' | 'dark'>(initialTheme)
  const [darkScores, setDarkScores] = useState(() =>
    document.documentElement.hasAttribute('data-dark-scores'),
  )
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    return () => {
      document.documentElement.dataset.theme = initialTheme
    }
  }, [theme, initialTheme])
  // Info (Phases 3–4). Everything here is local to the mockup: edits,
  // statuses and the bar's on/off are kept per piece but never written.
  const [notesOverride, setNotesOverride] = useState<Record<number, string>>({})
  const [statusOverride, setStatusOverride] = useState<Record<number, string | null>>({})
  const [hoveredStatus, setHoveredStatus] = useState<string | null>(null)
  // Your own statuses (read only — the mockup writes nothing).
  const { data: practiceStatuses = [] } = useQuery({
    queryKey: ['practice-statuses'],
    queryFn: listPracticeStatuses,
  })
  // The notes bar is off until turned on for a piece (user, 2026-10-21).
  const [barShown, setBarShown] = useState<Record<number, boolean>>({})
  const [hasNotes, setHasNotes] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [sheetFull, setSheetFull] = useState(false)
  const [closeArmed, setCloseArmed] = useState(false)
  const [hint, setHint] = useState<{ text: string; id: number } | null>(null)
  const [showZones, setShowZones] = useState(false)
  const [showHits, setShowHits] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)

  const [clockOn, setClockOn] = useState(true)
  const [clockMode, setClockMode] = useState<ClockMode>('clock')
  const [showSeconds, setShowSeconds] = useState(false)
  const [swStart, setSwStart] = useState<number | null>(null)
  const [swAcc, setSwAcc] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(t)
  }, [])
  const readout =
    clockMode === 'stopwatch'
      ? stopwatchText(swAcc + (swStart !== null ? Math.max(0, now - swStart) : 0))
      : (showSeconds ? clockFormatSeconds : clockFormat).format(now)

  const edited =
    activeId !== null && activeId in notesOverride ? notesOverride[activeId] : undefined
  const notes = edited !== undefined ? edited : hasNotes ? piece?.userNotes || EXAMPLE_NOTES : ''
  const notesAreExample = edited === undefined && hasNotes && !piece?.userNotes
  const status =
    activeId !== null && activeId in statusOverride
      ? statusOverride[activeId]
      : (piece?.practiceStatus ?? null)
  const infoOpen = menu === 'info'
  // Hidden while any menu or Info is open, so nothing stacks over it.
  const showBar =
    notes !== '' && activeId !== null && !!barShown[activeId] && menu === null && !customKey

  const photo = (activeId !== null && photoByPiece[activeId]) || PHOTO_DEFAULT
  function setPhoto(change: Partial<Photo>) {
    if (activeId === null) return
    setPhotoByPiece({ ...photoByPiece, [activeId]: { ...photo, ...change } })
  }
  // Phase 5: with Dark Mode Scores on, the page is already inverted, so
  // Invert shows as on and locked, and the user's own invert is set aside
  // (not cleared) until Dark Mode Scores is off again.
  const invertHidden = theme === 'dark' && darkScores
  // The theme's own treatment sits underneath, never shown as a setting
  // (plan): the dark theme's 85% dim, or Dark Mode Scores' invert — then
  // the user's filters on top, so their values stay relative to the theme.
  // On the page and its mat together (so an invert doesn't leave a white
  // frame), never on the annotation layer, a sibling.
  const scoreFilter =
    [
      theme === 'dark' ? (darkScores ? 'invert(0.95) hue-rotate(180deg)' : 'brightness(0.85)') : '',
      photo.brightness !== 100 ? `brightness(${photo.brightness / 100})` : '',
      photo.contrast !== 100 ? `contrast(${photo.contrast / 100})` : '',
      photo.grayscale ? 'grayscale(1)' : '',
      // A full invert, deliberately unlike Dark Mode Scores' invert(0.95):
      // a light-theme Invert reaches true black, where Dark Mode Scores
      // stops at near-black (#0d0d0d). Kept as is for now (user, Phase 5);
      // matching the two is an open question for later.
      photo.invert && !invertHidden ? 'invert(1) hue-rotate(180deg)' : '',
    ]
      .filter(Boolean)
      .join(' ') || 'none'
  const photoChanged =
    photo.brightness !== 100 || photo.contrast !== 100 || photo.grayscale || photo.invert

  const last = useRef({ dir: 0, at: 0 })
  const photoAnchorRef = useRef<HTMLDivElement>(null)
  const queueAnchorRef = useRef<HTMLDivElement>(null)
  const phoneRow2Ref = useRef<HTMLDivElement>(null)
  const infoAnchorRef = useRef<HTMLDivElement>(null)
  const clockAnchorRef = useRef<HTMLDivElement>(null)
  const moreAnchorRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  const hintTimer = useRef<number | undefined>(undefined)
  useEffect(
    () => () => {
      window.clearTimeout(closeTimer.current)
      window.clearTimeout(hintTimer.current)
    },
    [],
  )

  function flash(text: string) {
    window.clearTimeout(hintTimer.current)
    setHint({ text, id: Date.now() })
    hintTimer.current = window.setTimeout(() => setHint(null), HINT_MS)
  }

  function turn(dir: -1 | 1) {
    const t = performance.now()
    if (dir === last.current.dir && t - last.current.at < DEBOUNCE_MS) {
      flash('Double-turn ignored')
      return
    }
    last.current = { dir, at: t }
    const next = Math.max(1, Math.min(pageCount, page + dir))
    if (next === page) {
      // In a queue (the Practice List or a setlist), turning past a piece's
      // end goes on to the next piece; back from its start, to the previous
      // piece's last page.
      const neighbor = queueIndex >= 0 ? queueIds[queueIndex + dir] : undefined
      if (neighbor !== undefined) {
        const target = typeof neighbor === 'number' ? byId.get(neighbor) : undefined
        goToPiece(neighbor, dir > 0 ? 1 : (target?.pageCount ?? 1))
        const name = typeof neighbor === 'string' ? CUSTOM_ENTRIES[neighbor]?.name : target?.title
        flash(`${dir > 0 ? 'Next' : 'Previous'}: ${name ?? 'entry'}`)
        return
      }
      flash(dir < 0 ? 'First page' : queueIds.length ? 'End of the list' : 'Last page')
      return
    }
    setPage(next)
  }
  function goToPiece(key: QueueKey, toPage = 1) {
    setEditing(false)
    if (typeof key === 'string') {
      setCustomKey(key)
      setPage(1)
      return
    }
    setCustomKey(null)
    setPieceId(key)
    setPage(toPage)
  }
  function openSession(kind: SessionKind) {
    setSessionKind(kind)
    setMenu(null)
    setCustomKey(null)
    if (kind === 'list') {
      // The sidebar entry always starts at the top of the list (user, Phase
      // 6 review — not where you last were).
      if (practiceList.length === 0) {
        setMenu('queue')
        return
      }
      setPieceId(practiceList[0])
      setPage(1)
    } else if (kind === 'piece') {
      // Play on a piece that's on the list opens the list at it.
      if (activeId !== null && practiceList.includes(activeId)) setSessionKind('list')
      setPage(1)
    } else if (kind === 'setlist') {
      setCustomKey(setlistQueue[0] as string)
      setPage(1)
    }
  }
  const turnRef = useRef(turn)
  const setMenuRef = useRef(setMenu)
  useEffect(() => {
    turnRef.current = turn
  })

  // Page-turner pedals pair as keyboards sending this fixed set (plan:
  // hardcoded, no remapping). Space/Enter would also press whichever
  // toolbar button last took focus, so the viewer claims them.
  // Pedals keep turning while Info is open (only taps close it first).
  const menuOpen = menu === 'clock' || menu === 'more'
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as Element | null
      if (target?.closest('input, textarea, select, [role="listbox"]')) return
      if (event.key === 'Escape') {
        setMenuRef.current(null)
        return
      }
      if (menuOpen) return
      const back = ['ArrowLeft', 'ArrowUp', 'PageUp']
      const forward = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter']
      if (back.includes(event.key)) {
        event.preventDefault()
        if (!event.repeat) turnRef.current(-1)
      } else if (forward.includes(event.key)) {
        event.preventDefault()
        if (!event.repeat) turnRef.current(1)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [menuOpen])

  // Practiced today: time on each piece adds up while it's showing; once its
  // last page has been reached too, it's marked (Phase 6).
  // A custom entry isn't a piece: nothing to mark.
  const viewId = customKey ? null : activeId
  const spent = useRef(new Map<number, number>())
  const viewing = useRef<{ id: number | null; since: number }>({ id: null, since: 0 })
  const reachedLast = useRef(new Set<number>())
  const threshold = useRef(PRACTICED_MS)
  const tracking = useRef(true)
  useEffect(() => {
    threshold.current = fastMinute ? 5_000 : PRACTICED_MS
    tracking.current = trackingOn
  }, [fastMinute, trackingOn])
  useEffect(() => {
    const now = Date.now()
    const prev = viewing.current
    if (prev.id !== null)
      spent.current.set(prev.id, (spent.current.get(prev.id) ?? 0) + now - prev.since)
    viewing.current = { id: viewId, since: now }
  }, [viewId])
  useEffect(() => {
    if (viewId !== null && piece?.id === viewId && page >= pageCount)
      reachedLast.current.add(viewId)
  }, [viewId, piece, page, pageCount])
  useEffect(() => {
    const t = window.setInterval(() => {
      const { id, since } = viewing.current
      // User Settings' practice-tracking switch off: nothing is recorded.
      if (!tracking.current || id === null || !reachedLast.current.has(id)) return
      if ((spent.current.get(id) ?? 0) + Date.now() - since < threshold.current) return
      setPracticed((prev) => (id in prev ? prev : { ...prev, [id]: true }))
    }, 1000)
    return () => window.clearInterval(t)
  }, [])

  // Neighbors load ahead so a turn shows the next page at once.
  useEffect(() => {
    if (activeId === null) return
    for (const p of [page - 1, page + 1]) {
      if (p >= 1 && p <= pageCount) new Image().src = getPieceThumbnailUrl(activeId, p)
    }
  }, [activeId, page, pageCount])

  function pressClose() {
    window.clearTimeout(closeTimer.current)
    if (closeArmed) {
      setCloseArmed(false)
      navigate('/mockup')
      return
    }
    setCloseArmed(true)
    closeTimer.current = window.setTimeout(() => setCloseArmed(false), CLOSE_CONFIRM_MS)
  }

  function enterAnnotate() {
    setMode('annotate')
    setTool(null)
    setMenu(null)
    flash('Annotate: pick a tool to mark; until then taps turn pages')
  }
  function leaveAnnotate() {
    setMode('play')
    setTool(null)
    flash('Play: taps turn pages')
  }
  function pickTool(key: Tool) {
    if (tool === key) {
      setTool(null)
      flash('No tool: taps turn pages')
    } else {
      setTool(key)
      flash(`${TOOLS.find((t) => t.key === key)?.label}: taps mark the page`)
    }
  }

  // One finger on the score: a tap turns by where it lands, a swipe by which
  // way it goes (lib/sheetViewerGestures.ts). A second finger (a pinch)
  // cancels it.
  const down = useRef<StagePoint | null>(null)
  const fingers = useRef(new Set<number>())
  function onStagePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Zoomed in, a drag pans the page; leave it to the browser.
    if (zoomed) return
    fingers.current.add(event.pointerId)
    // Its lift always reaches the score, even over the toolbar, so a
    // finger is never left counted as down.
    event.currentTarget.setPointerCapture(event.pointerId)
    if (fingers.current.size > 1) down.current = null
    else if (event.button === 0)
      down.current = { x: event.clientX, y: event.clientY, t: performance.now() }
  }
  function onStagePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    fingers.current.delete(event.pointerId)
    const start = down.current
    down.current = null
    if (!start) return
    if (mode === 'annotate' && tool) {
      flash('Marking the page arrives in Phase 15')
      return
    }
    const end = { x: event.clientX, y: event.clientY, t: performance.now() }
    const dir = stageTurn(start, end, event.currentTarget.getBoundingClientRect())
    if (dir) turn(dir)
  }
  function onStagePointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    fingers.current.delete(event.pointerId)
    down.current = null
  }

  // Exit: the back arrow (picked from a side-by-side,
  // https://claude.ai/artifact/Q9qdB9FgMXvie3ceDJbuFZ) — the app's "go
  // back", which is where exiting takes you; ✕ elsewhere closes a window or
  // removes something (the queue's ✕ removes a piece). Two taps.
  // A fixed width (picked from a side-by-side,
  // https://claude.ai/artifact/AGotxhczR6JhLquY1YMJBB): the arrow and the
  // armed "Exit?" share one grid cell, so the face is always as wide as
  // "Exit?" and the toolbar never shifts when it's tapped.
  const closeButton = (
    <HitButton
      label={closeArmed ? 'Tap again to exit' : 'Exit'}
      onClick={pressClose}
      inset
      faceClassName={`px-3 font-medium ${closeArmed ? 'bg-danger-fill text-white' : FACE_HOVER}`}
    >
      <span className="grid place-items-center [&>*]:col-start-1 [&>*]:row-start-1">
        <span className={closeArmed ? 'invisible' : ''}>
          <IconArrowLeft size={22} />
        </span>
        <span className={closeArmed ? '' : 'invisible'}>Exit?</span>
      </span>
    </HitButton>
  )

  const ClockIcon = clockMode === 'stopwatch' ? IconStopwatch : IconClock
  const clockButton = (
    <div ref={clockAnchorRef} className="relative">
      <HitButton label="Clock" onClick={() => setMenu(menu === 'clock' ? null : 'clock')} inset>
        <span className={`flex items-center gap-1.5 ${clockOn ? 'px-2.5' : ''}`}>
          <ClockIcon size={20} />
          {clockOn && (
            <span className="font-medium">
              <ClockText text={readout} />
            </span>
          )}
        </span>
      </HitButton>
    </div>
  )

  // Centered under the clock and kept on screen at the edges. Portaled to
  // <body>, so it sits over the backdrop that closes it.
  const clockMenuStyle = useAnchoredPanel(clockAnchorRef, menu === 'clock', 'below-center', {
    gap: 6,
    panelWidth: 288,
  })
  // pb-2, not 3: the last row's 48pt hit area has 4px of invisible space
  // under its 40px face, so 8px of padding puts the face 12px from the
  // bottom — the same as the switcher track's 12px from the top.
  const clockMenu =
    menu === 'clock' &&
    clockMenuStyle &&
    createPortal(
      <div
        style={clockMenuStyle}
        className="z-50 w-72 rounded-xl border border-border bg-paper px-3 pt-3 pb-2 shadow-xl [--sv-hover:var(--color-paper-hover)]"
      >
        <div className="flex rounded-[13px] bg-paper-sunken px-1">
          {(['clock', 'stopwatch'] as const).map((m) => (
            <button
              key={m}
              type="button"
              data-hit
              onClick={() => setClockMode(m)}
              className={`${HIT} flex-1 group/b`}
            >
              <span
                className={`${FACE} w-full gap-2 ${
                  clockMode === m ? 'bg-paper-raised font-medium shadow-sm' : 'text-ink-soft'
                }`}
              >
                {m === 'clock' ? <IconClock size={18} /> : <IconStopwatch size={18} />}
                {m === 'clock' ? 'Clock' : 'Stopwatch'}
              </span>
            </button>
          ))}
        </div>
        <div className="py-3 text-center text-[34px] leading-tight font-medium">
          <ClockText text={readout} />
        </div>
        {clockMode === 'stopwatch' && (
          <div className="flex">
            <button
              type="button"
              data-hit
              className={`${HIT} flex-1 group/b`}
              onClick={() => {
                if (swStart !== null) {
                  setSwAcc(swAcc + Date.now() - swStart)
                  setSwStart(null)
                } else setSwStart(Date.now())
              }}
            >
              <span className={`${FACE} ${FACE_HOVER} w-full justify-start px-3 gap-2.5`}>
                {swStart !== null ? <IconPlayerPause size={20} /> : <IconPlayerPlay size={20} />}
                {swStart !== null ? 'Pause' : swAcc ? 'Resume' : 'Start'}
              </span>
            </button>
            <button
              type="button"
              data-hit
              className={`${HIT} flex-1 group/b`}
              onClick={() => {
                setSwAcc(0)
                setSwStart(swStart !== null ? Date.now() : null)
              }}
            >
              <span className={`${FACE} ${FACE_HOVER} w-full justify-start px-3 gap-2.5`}>
                <IconRefresh size={20} />
                Reset
              </span>
            </button>
          </div>
        )}
        {/* Clock mode only: the stopwatch always shows seconds. */}
        {clockMode === 'clock' && (
          <>
            {/* The Sheet Viewer's switch row (design D): label first,
                lined up with the icon rows' text (12px padding + 20px icon
                + 10px gap), the 44×26 switch at the right edge; the whole
                48pt row flips it. */}
            <div
              data-hit
              className={`${HIT} w-full`}
              onClick={(event) => {
                if (event.target === event.currentTarget) setShowSeconds(!showSeconds)
              }}
            >
              <Toggle
                row
                checked={showSeconds}
                onChange={setShowSeconds}
                label="Show seconds"
                className="h-10 w-full rounded-[10px] pr-3 pl-[42px] hover:bg-(--sv-hover)"
              />
            </div>
          </>
        )}
        <button
          type="button"
          data-hit
          className={`${HIT} w-full group/b`}
          onClick={() => setClockOn(!clockOn)}
        >
          <span className={`${FACE} ${FACE_HOVER} w-full justify-start px-3 gap-2.5`}>
            {clockMode === 'stopwatch' ? <IconStopwatch size={20} /> : <IconClock size={20} />}
            {clockOn ? 'Hide' : 'Show'} {clockMode === 'stopwatch' ? 'stopwatch' : 'clock'}
          </span>
        </button>
      </div>,
      document.body,
    )

  // Wide screens show the photo button inline; elsewhere it's in ⋯.
  const photoInline = tier === 'wide'
  const inlineExtras = tier === 'wide'
  const extras = (
    <>
      <SoonButton label="Metronome" message="Metronome: coming soon">
        <IconMetronome size={22} />
      </SoonButton>
      <SoonButton label="Theory reference" message="Theory reference: coming soon">
        <IconClef size={22} />
      </SoonButton>
    </>
  )
  const photoButton = (
    <div ref={photoAnchorRef} className="relative">
      <HitButton
        label="Photo filters"
        onClick={() => setMenu(menu === 'photo' ? null : 'photo')}
        faceClassName={menu === 'photo' || photoChanged ? 'bg-accent-soft text-accent' : ''}
      >
        <IconPhotoCog size={22} />
      </HitButton>
    </div>
  )

  // The Sheet Viewer's switch row (design D) for a panel whose other rows
  // have icons: the label lined up with their text.
  function switchRow(
    label: string,
    checked: boolean,
    onChange: (v: boolean) => void,
    disabled?: boolean,
  ) {
    return (
      <div
        data-hit
        className={`${HIT} w-full`}
        onClick={(event) => {
          if (!disabled && event.target === event.currentTarget) onChange(!checked)
        }}
      >
        <Toggle
          row
          checked={checked}
          onChange={onChange}
          label={label}
          disabled={disabled}
          className="h-10 w-full rounded-[10px] pr-3 pl-[42px] hover:bg-(--sv-hover)"
        />
      </div>
    )
  }
  function stepperRow(
    label: string,
    Icon: typeof IconSun,
    value: number,
    onChange: (v: number) => void,
  ) {
    return (
      <div className="flex h-12 items-center">
        <span className="flex min-w-0 flex-1 items-center gap-2.5 pl-3">
          <Icon size={20} className="shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        <HitButton
          label={`Less ${label.toLowerCase()}`}
          onClick={() => onChange(value - PHOTO_STEP)}
          disabled={value <= PHOTO_MIN}
        >
          <IconMinus size={20} />
        </HitButton>
        <span className="w-12 text-center font-clock tabular-nums">{value}%</span>
        <HitButton
          label={`More ${label.toLowerCase()}`}
          onClick={() => onChange(value + PHOTO_STEP)}
          disabled={value >= PHOTO_MAX}
        >
          <IconPlus size={20} />
        </HitButton>
      </div>
    )
  }
  // Under the photo button; under ⋯ on a tablet; on a phone, centered under
  // the whole two-row toolbar so it never covers the page cyclers.
  const photoStyle = useAnchoredPanel(
    tier === 'wide' ? photoAnchorRef : tier === 'phone' ? phoneRow2Ref : moreAnchorRef,
    menu === 'photo',
    'below-center',
    { gap: 6, panelWidth: PHOTO_WIDTH },
  )
  const photoPanel =
    menu === 'photo' &&
    photoStyle &&
    createPortal(
      <div
        style={{ ...photoStyle, width: PHOTO_WIDTH }}
        className="z-50 rounded-xl border border-border bg-paper px-3 pt-3 pb-2 shadow-xl [--sv-hover:var(--color-paper-hover)]"
      >
        {stepperRow('Brightness', IconSun, photo.brightness, (v) => setPhoto({ brightness: v }))}
        {stepperRow('Contrast', IconContrast, photo.contrast, (v) => setPhoto({ contrast: v }))}
        {switchRow('Grayscale', photo.grayscale, (v) => setPhoto({ grayscale: v }))}
        {switchRow(
          'Invert',
          invertHidden ? true : photo.invert,
          (v) => setPhoto({ invert: v }),
          invertHidden,
        )}
        {invertHidden && (
          <p className="-mt-1 pr-3 pb-1 pl-[42px] text-xs text-ink-muted">
            Dark Mode Scores already inverts the pages.
          </p>
        )}
        {/* Phase 5 (option A): the edge margin lives here, not on its own
            toolbar button. */}
        {switchRow('Edge margin', photo.margin, (v) => setPhoto({ margin: v }))}
        <button
          type="button"
          data-hit
          disabled={!photoChanged}
          onClick={() =>
            setPhoto({ brightness: 100, contrast: 100, grayscale: false, invert: false })
          }
          className={`${HIT} w-full group/b disabled:opacity-50`}
        >
          <span className={`${FACE} ${FACE_HOVER} w-full justify-start gap-2.5 px-3`}>
            <IconRefresh size={20} />
            Reset filters
          </span>
        </button>
      </div>,
      document.body,
    )

  const sc = piece
  const credit = sc
    ? [
        ...sc.composer.values.map((p) => p.name),
        ...sc.arranger.values.map((p) => `arr. ${p.name}`),
      ].join(', ')
    : ''

  // A dot on Info whenever the piece has notes and Info is closed (Phase 3).
  const notesDot = (
    <span
      className={`pointer-events-none absolute top-[11px] right-[11px] size-[9px] rounded-full bg-accent-fill ring-2 ${mode === 'annotate' ? 'ring-accent-soft' : 'ring-paper'}`}
    />
  )
  const infoButton = (
    <div ref={infoAnchorRef} className="relative">
      <HitButton
        label="Info"
        onClick={() => openInfo(!infoOpen)}
        // Open, it takes the surface's own "on" look: the tint in Play; in
        // Annotate, whose toolbar is that tint already, a picked tool's fill.
        faceClassName={
          infoOpen
            ? mode === 'annotate'
              ? 'bg-accent-fill text-white'
              : 'bg-accent-soft text-accent'
            : ''
        }
      >
        <IconInfoCircle size={22} />
      </HitButton>
      {notes && !infoOpen && notesDot}
    </div>
  )

  function openInfo(open: boolean) {
    setMenu(open ? 'info' : null)
    setSheetFull(false)
  }
  function startEdit() {
    setDraft(notes)
    setEditing(true)
  }
  function saveEdit() {
    if (activeId === null) return
    setNotesOverride({ ...notesOverride, [activeId]: draft.trim() })
    setEditing(false)
    flash('Notes saved (mockup: nothing is written)')
  }
  function setBar(visible: boolean) {
    if (activeId === null) return
    setBarShown({ ...barShown, [activeId]: visible })
  }
  const sectionLabel = 'text-xs font-semibold tracking-wider text-ink-muted uppercase'
  const details: [string, string][] = piece
    ? (
        [
          ['Opus', piece.workOpusNumber.value],
          ['Keys', piece.keys.map((k) => k.name).join(' › ')],
          ['Sheet type', piece.sheetType.value?.name ?? ''],
          [
            'Book',
            piece.sourceBookTitle
              ? `${piece.sourceBookTitle}${piece.sourcePageStart ? (piece.sourcePageEnd && piece.sourcePageEnd !== piece.sourcePageStart ? ` (pp. ${piece.sourcePageStart}–${piece.sourcePageEnd})` : ` (p. ${piece.sourcePageStart})`) : ''}`
              : '',
          ],
          ['Duration', piece.duration ? formatDuration(piece.duration) : ''],
          ['Pages', String(piece.pageCount)],
        ] as [string, string][]
      ).filter(([, v]) => v)
    : []

  const infoBody = (
    <div className="flex flex-col gap-5 px-5 pt-3 pb-5">
      <section className="flex flex-col gap-2">
        {/* Only as tall as the pencil's face (32px): its 48pt tap area
            hangs 8px over above and below, and 4px past the right edge, so
            the label sits as close to the notes as the other sections'
            labels do and the pencil's face lines up with the content edge.
            The icon stays centered in its tap area. */}
        <div className="flex min-h-8 items-center">
          <h3 className={sectionLabel}>Your notes</h3>
          <span className="flex-1" />
          {notes && !editing && activeId !== null && (
            <div className="-my-2 -mr-1">
              <HitButton label="Edit your notes" onClick={startEdit}>
                <IconPencil size={20} />
              </HitButton>
            </div>
          )}
        </div>
        {editing ? (
          <>
            <textarea
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-label="Your notes"
              className="min-h-40 w-full resize-y rounded-xl border border-accent bg-paper-raised px-4 py-3 text-base leading-relaxed text-ink outline-none select-text"
            />
            <div className="flex items-center">
              <span className="mr-auto text-xs text-ink-muted">
                Markdown and :shortcodes: work here.
              </span>
              <HitButton
                label="Cancel"
                onClick={() => setEditing(false)}
                faceClassName="border border-border bg-paper-raised px-3 font-medium hover:border-accent"
              >
                Cancel
              </HitButton>
              <HitButton
                label="Done"
                onClick={saveEdit}
                faceClassName="bg-accent-fill px-3 font-medium text-white group-hover/b:bg-accent-fill/90"
              >
                <IconCheck size={18} />
                Done
              </HitButton>
            </div>
          </>
        ) : notes ? (
          <>
            <div className="rounded-xl border border-accent/40 bg-paper-raised px-4 py-3 text-base leading-relaxed select-text">
              <MarkdownText>{notes}</MarkdownText>
            </div>
            {notesAreExample && (
              <p className="text-xs text-ink-faint italic">
                Example notes: this piece has none of its own.
              </p>
            )}
            {/* On its own row under the notes (Phase 4 review), in the
                switch-row style: the label lined up with the notes' text
                (the card's 1px border + 16px padding), the switch at the
                card's right edge. */}
            {activeId !== null && (
              <div
                data-hit
                className={`${HIT} -mx-2 -mt-1 -mb-2`}
                onClick={(event) => {
                  if (event.target === event.currentTarget) setBar(!barShown[activeId])
                }}
              >
                <Toggle
                  row
                  checked={!!barShown[activeId]}
                  onChange={setBar}
                  label="Show as banner"
                  className="h-10 w-full rounded-[10px] pr-2 pl-[25px] hover:bg-(--sv-hover)"
                />
              </div>
            )}
          </>
        ) : (
          <>
            <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-ink-muted italic">
              {EMPTY_NOTES}
            </p>
            <div className="-ml-1">
              <HitButton
                label="Add notes"
                onClick={startEdit}
                faceClassName="border border-border bg-paper-raised px-3 font-medium hover:border-accent"
              >
                <IconPlus size={18} />
                Add notes
              </HitButton>
            </div>
          </>
        )}
      </section>
      {/* Phase 7: the real PracticeStatusStrip's design at 48pt — your own
          statuses in practice order (a status with no icon shows its
          initial), raised tiles whose border turns green on hover, the
          current one filled; the label line names the hovered or focused
          status, else the current one. Tap a status to set it, the current
          one again to clear it. */}
      <section className="flex flex-col gap-1" onMouseLeave={() => setHoveredStatus(null)}>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className={sectionLabel}>Practice status</h3>
          <span className="truncate text-sm font-medium">{hoveredStatus ?? status ?? 'None'}</span>
        </div>
        <div className="-mb-1 -ml-1 flex flex-wrap" role="radiogroup" aria-label="Practice status">
          {sortPracticeStatuses(practiceStatuses).map((item) => {
            const isCurrent = status === item.name
            return (
              <button
                key={item.id}
                type="button"
                data-hit
                role="radio"
                aria-checked={isCurrent}
                aria-label={isCurrent ? `${item.name} (tap to clear)` : item.name}
                onMouseEnter={() => setHoveredStatus(item.name)}
                onFocus={() => setHoveredStatus(item.name)}
                onBlur={() => setHoveredStatus(null)}
                onClick={() => {
                  if (activeId === null) return
                  setStatusOverride({ ...statusOverride, [activeId]: isCurrent ? null : item.name })
                }}
                className={`${HIT} group/b`}
              >
                <span
                  className={`${FACE} border text-sm font-medium ${
                    isCurrent
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-border bg-paper-raised text-ink-soft group-hover/b:border-accent group-hover/b:text-ink'
                  }`}
                >
                  {item.iconKey ? (
                    <PracticeStatusKeyIcon iconKey={item.iconKey} size={20} />
                  ) : (
                    item.name.slice(0, 1).toUpperCase()
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </section>
      {piece && (
        <section className="flex flex-col gap-2">
          <h3 className={sectionLabel}>About this piece</h3>
          <div>
            <p className="font-display text-lg leading-snug font-medium">{piece.title}</p>
            {credit && <p className="text-sm text-ink-soft">{credit}</p>}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {details.map(([label, value]) => (
              <Fragment key={label}>
                <dt className="text-ink-muted">{label}</dt>
                <dd>{value}</dd>
              </Fragment>
            ))}
          </dl>
        </section>
      )}
    </div>
  )

  // Phase 3: a card hanging from Info on tablets and desktop, a bottom sheet
  // on phones. Portaled, over the backdrop — so a tap on the score closes
  // Info first rather than turning the page.
  const infoStyle = useAnchoredPanel(infoAnchorRef, infoOpen && tier !== 'phone', 'below-center', {
    gap: 6,
    panelWidth: INFO_WIDTH,
  })
  const infoHeader = (title: ReactNode) => (
    <div className="flex shrink-0 items-center border-b border-border pr-4">
      {title}
      <HitButton label="Close Info" onClick={() => openInfo(false)}>
        <IconX size={20} />
      </HitButton>
    </div>
  )
  const infoPanel =
    infoOpen &&
    (tier === 'phone'
      ? createPortal(
          <div
            className={`fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl border-t border-border bg-paper pb-[env(safe-area-inset-bottom)] shadow-2xl [--sv-hover:var(--color-paper-hover)] ${
              sheetFull ? 'top-[calc(env(safe-area-inset-top)+0.75rem)]' : 'h-[58dvh]'
            }`}
          >
            <span className="pointer-events-none absolute top-1.5 left-1/2 h-[5px] w-10 -translate-x-1/2 rounded-full bg-ink-fainter" />
            {/* The title row is the handle: tap it to take the full height. */}
            {infoHeader(
              <button
                type="button"
                data-hit
                onClick={() => setSheetFull(!sheetFull)}
                aria-label={sheetFull ? 'Shrink Info' : 'Expand Info'}
                className={`${HIT} mt-2 flex-1 justify-start pl-5`}
              >
                <span className="font-display text-base font-medium">Info</span>
              </button>,
            )}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{infoBody}</div>
          </div>,
          document.body,
        )
      : infoStyle &&
        createPortal(
          <div
            style={{ ...infoStyle, width: INFO_WIDTH }}
            className="z-50 flex max-h-[calc(100dvh-5.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-paper shadow-xl [--sv-hover:var(--color-paper-hover)]"
          >
            {infoHeader(<h2 className="flex-1 pl-5 font-display text-base font-medium">Info</h2>)}
            <div className="min-h-0 overflow-y-auto overscroll-contain">{infoBody}</div>
          </div>,
          document.body,
        ))

  // The queue (Phase 6): a card under its button (a bottom sheet on phones),
  // like Info. The Practice List can be reordered and trimmed here; a
  // setlist's queue is jump-only (its order is the real program).
  const editableQueue = sessionKind === 'list'
  const queueStyle = useAnchoredPanel(
    queueAnchorRef,
    menu === 'queue' && tier !== 'phone',
    'below-center',
    { gap: 6, panelWidth: QUEUE_WIDTH },
  )
  const queueList = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (dragIndex === null) return
    document.body.style.cursor = 'grabbing'
    return () => {
      document.body.style.cursor = ''
    }
  }, [dragIndex])
  function endDrag() {
    setDragIndex(null)
    setDragGhost(null)
  }
  function moveDrag(event: React.PointerEvent<HTMLUListElement>) {
    if (dragIndex === null || !queueList.current) return
    if (dragGhost) setDragGhost({ ...dragGhost, x: event.clientX, y: event.clientY })
    const rows = [...queueList.current.querySelectorAll<HTMLElement>('[data-row]')]
    let target = rows.length - 1
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect()
      if (event.clientY < r.top + r.height / 2) {
        target = i
        break
      }
    }
    if (target === dragIndex) return
    const next = [...practiceList]
    const [moved] = next.splice(dragIndex, 1)
    next.splice(target, 0, moved)
    setListOverride(next)
    setDragIndex(target)
  }
  const queuePieces = queueIds.filter((k): k is number => typeof k === 'number')
  // Practiced marks show in the Practice List only: a setlist session
  // still records practice, invisibly, and none of it shows (or is
  // recorded) with tracking off in User Settings.
  const showMarks = trackingOn && sessionKind === 'list'
  const practicedCount = queuePieces.filter((id) => practiced[id] === true).length
  const queueTitle = sessionKind === 'setlist' ? SETLIST_NAME : 'Practice List'
  const queueSub =
    sessionKind === 'setlist'
      ? 'Setlist, in its order for this session'
      : showMarks
        ? `${practicedCount} of ${queueIds.length} practiced today`
        : `${queueIds.length} pieces`
  const queueBody =
    queueIds.length === 0 ? (
      <p className="px-5 pt-3 pb-5 text-sm text-ink-muted italic">
        Your Practice List is empty. Add pieces from a piece’s Play button: Add to Practice List.
      </p>
    ) : (
      <ul
        ref={queueList}
        className="flex flex-col px-3 pt-2 pb-3 select-none"
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        {queueIds.map((id, i) => {
          if (typeof id === 'string') {
            const entry = CUSTOM_ENTRIES[id]
            const current = id === customKey
            return (
              <li
                key={id}
                data-row
                className={`flex items-center rounded-[10px] ${current ? 'bg-accent-soft [--sv-hover:var(--color-accent-soft-hover)]' : ''}`}
              >
                <button
                  type="button"
                  data-hit
                  onClick={() => {
                    goToPiece(id)
                    setMenu(null)
                  }}
                  className={`${HIT} min-w-0 flex-1 justify-start group/b`}
                >
                  <span className={`${FACE} ${FACE_HOVER} h-11 w-full justify-start px-2`}>
                    <span className="flex min-w-0 -translate-y-[0.5px] flex-col text-left">
                      <span className="truncate font-display font-medium italic">{entry.name}</span>
                      <span className="truncate text-xs text-ink-soft">
                        {current ? 'Now open' : entry.role}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            )
          }
          const p = byId.get(id)
          const current = id === activeId && !customKey
          const done = practiced[id] === true
          // Unmarked today: the automatic rule leaves it alone until tomorrow.
          const unmarked = practiced[id] === false
          const who = p
            ? [
                ...p.composer.values.map((x) => x.name),
                ...p.arranger.values.map((x) => `arr. ${x.name}`),
              ].join(', ')
            : ''
          return (
            <li
              key={id}
              data-row
              className={`flex items-center rounded-[10px] ${current ? 'bg-accent-soft [--sv-hover:var(--color-accent-soft-hover)]' : ''} ${dragIndex === i ? 'opacity-40' : ''}`}
            >
              {editableQueue && (
                <span
                  data-hit
                  aria-label={`Drag to reorder ${p?.title ?? ''}`}
                  className={`${HIT} touch-none text-ink-faint ${dragIndex === i ? 'cursor-grabbing!' : 'cursor-grab! active:cursor-grabbing!'}`}
                  onPointerDown={(event) => {
                    // No text selection mid-drag (the card is portaled
                    // outside the viewer's select-none).
                    event.preventDefault()
                    queueList.current?.setPointerCapture(event.pointerId)
                    setDragIndex(i)
                    const row = (event.currentTarget as HTMLElement).closest('[data-row]')
                    const r = row?.getBoundingClientRect()
                    if (r)
                      setDragGhost({
                        x: event.clientX,
                        y: event.clientY,
                        dx: event.clientX - r.left,
                        dy: event.clientY - r.top,
                        width: r.width,
                      })
                  }}
                >
                  <IconGripVertical size={20} />
                </span>
              )}
              <button
                type="button"
                data-hit
                onClick={() => {
                  goToPiece(id)
                  setMenu(null)
                }}
                className={`${HIT} min-w-0 flex-1 justify-start group/b`}
              >
                {/* The same hover fill as the row's other buttons, so the
                    title reads as tappable — 44px in the 48pt row, so the
                    two lines have room and neighbors stay close. The text
                    sits half a pixel high: measured by its ink, the title's
                    leading otherwise leaves the top ~1px roomier. */}
                <span className={`${FACE} ${FACE_HOVER} h-11 w-full justify-start px-2`}>
                  <span className="flex min-w-0 -translate-y-[0.5px] flex-col text-left">
                    <span className="truncate font-display font-medium">{p?.title ?? '…'}</span>
                    <span className="truncate text-xs text-ink-soft">
                      {current ? 'Now open' : who || `${p?.pageCount ?? ''} pp.`}
                    </span>
                  </span>
                </span>
              </button>
              {showMarks && (
                <HitButton
                  label={
                    done
                      ? 'Practiced today: tap to unmark'
                      : unmarked
                        ? 'Unmarked for today: tap to mark as practiced'
                        : 'Mark as practiced today'
                  }
                  onClick={() => setPracticed({ ...practiced, [id]: !done })}
                  faceClassName={`${FACE_HOVER} ${done ? 'text-accent' : unmarked ? 'text-ink-faint' : 'text-ink-fainter'}`}
                >
                  {done ? (
                    <IconCircleCheckFilled size={22} />
                  ) : unmarked ? (
                    <IconCircleOff size={22} />
                  ) : (
                    <IconCircle size={22} />
                  )}
                </HitButton>
              )}
              {editableQueue && (
                <HitButton
                  label={`Remove ${p?.title ?? ''} from the Practice List`}
                  onClick={() => setListOverride(practiceList.filter((x) => x !== id))}
                >
                  <IconX size={18} />
                </HitButton>
              )}
            </li>
          )
        })}
      </ul>
    )
  const queueHeader = (titleEl: ReactNode) => (
    <div className="flex shrink-0 items-center border-b border-border pr-4">
      {titleEl}
      <HitButton label="Close the queue" onClick={() => setMenu(null)}>
        <IconX size={20} />
      </HitButton>
    </div>
  )
  const queueTitleBlock = (
    <span className="flex min-w-0 flex-col">
      <span className="truncate font-display text-base font-medium">{queueTitle}</span>
      {queueIds.length > 0 && <span className="truncate text-xs text-ink-soft">{queueSub}</span>}
    </span>
  )
  const draggedId = dragIndex !== null ? practiceList[dragIndex] : undefined
  const dragged = draggedId !== undefined ? byId.get(draggedId) : undefined
  const ghostCard =
    dragGhost &&
    dragged &&
    createPortal(
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: dragGhost.x - dragGhost.dx,
          top: dragGhost.y - dragGhost.dy,
          width: dragGhost.width,
          pointerEvents: 'none',
          zIndex: 9999,
        }}
        className="flex h-12 items-center rounded-[10px] border border-accent bg-paper-raised font-sans text-ink shadow-xl select-none"
      >
        <span className="flex w-12 shrink-0 justify-center text-ink-faint">
          <IconGripVertical size={20} />
        </span>
        <span className="flex min-w-0 flex-col px-2">
          <span className="truncate font-display font-medium">{dragged.title}</span>
          <span className="truncate text-xs text-ink-soft">
            {[
              ...dragged.composer.values.map((x) => x.name),
              ...dragged.arranger.values.map((x) => `arr. ${x.name}`),
            ].join(', ')}
          </span>
        </span>
      </div>,
      document.body,
    )
  const queuePanel =
    menu === 'queue' &&
    (tier === 'phone'
      ? createPortal(
          <div
            className={`fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl border-t border-border bg-paper pb-[env(safe-area-inset-bottom)] shadow-2xl [--sv-hover:var(--color-paper-hover)] ${
              sheetFull ? 'top-[calc(env(safe-area-inset-top)+0.75rem)]' : 'h-[58dvh]'
            }`}
          >
            <span className="pointer-events-none absolute top-1.5 left-1/2 h-[5px] w-10 -translate-x-1/2 rounded-full bg-ink-fainter" />
            {queueHeader(
              <button
                type="button"
                data-hit
                onClick={() => setSheetFull(!sheetFull)}
                aria-label={sheetFull ? 'Shrink the queue' : 'Expand the queue'}
                className={`${HIT} mt-2 min-w-0 flex-1 justify-start pl-5`}
              >
                {queueTitleBlock}
              </button>,
            )}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{queueBody}</div>
          </div>,
          document.body,
        )
      : queueStyle &&
        createPortal(
          <div
            style={{ ...queueStyle, width: QUEUE_WIDTH }}
            className="z-50 flex max-h-[calc(100dvh-5.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-paper shadow-xl [--sv-hover:var(--color-paper-hover)]"
          >
            {queueHeader(
              <div className="flex min-h-12 min-w-0 flex-1 items-center pl-5">
                {queueTitleBlock}
              </div>,
            )}
            <div className="min-h-0 overflow-y-auto overscroll-contain">{queueBody}</div>
          </div>,
          document.body,
        ))
  const queueButton = sessionKind !== 'piece' && mode !== 'annotate' && (
    <div ref={queueAnchorRef} className="relative">
      <HitButton
        label={sessionKind === 'setlist' ? 'Setlist queue' : 'Practice List'}
        onClick={() => {
          setMenu(menu === 'queue' ? null : 'queue')
          setSheetFull(false)
        }}
        faceClassName={menu === 'queue' ? 'bg-accent-soft text-accent' : ''}
      >
        {sessionKind === 'setlist' ? <IconListNumbers size={22} /> : <IconPlaylist size={22} />}
      </HitButton>
    </div>
  )

  const cyclers = (
    <div className="flex items-center">
      <HitButton
        label="Previous page"
        onClick={() => turn(-1)}
        disabled={page <= 1 && !(queueIndex > 0)}
      >
        <IconChevronLeft size={22} />
      </HitButton>
      <span className="w-[4.5em] text-center text-sm text-ink-soft tabular-nums">
        {page} / {pageCount}
      </span>
      <HitButton
        label="Next page"
        onClick={() => turn(1)}
        disabled={page >= pageCount && !(queueIndex >= 0 && queueIndex < queueIds.length - 1)}
      >
        <IconChevronRight size={22} />
      </HitButton>
    </div>
  )

  const toolsInline = tier === 'wide'
  // Inline (wide screens), Undo and Redo sit beside Done on the right, where
  // the Annotate toolbar has room; the tools fill the left side.
  // Undo and Redo fade (disabled) when there's nothing to undo or redo. The
  // mockup marks nothing yet, so both stay faded until marking (Phase 15)
  // gives them a history.
  const canUndo = false
  const canRedo = false
  const undoRedo = (
    <>
      <HitButton label="Undo" onClick={() => {}} disabled={!canUndo}>
        <IconArrowBackUp size={22} />
      </HitButton>
      <HitButton label="Redo" onClick={() => {}} disabled={!canRedo}>
        <IconArrowForwardUp size={22} />
      </HitButton>
    </>
  )
  const toolButtons = (
    <>
      {TOOLS.map(({ key, label, Icon }) => (
        <HitButton
          key={key}
          label={label}
          onClick={() => pickTool(key)}
          faceClassName={tool === key ? 'bg-accent-fill text-white' : ''}
        >
          <Icon size={22} />
        </HitButton>
      ))}
      <span className="mx-1 h-7 w-px shrink-0 bg-accent/30" />
      {/* Phones fold the palette to one swatch that steps through the
          colors (Phase 0: rows fold, never shrink) — a stand-in until
          Phase 11 designs the real controls. */}
      {(tier === 'phone' ? [COLORS[color]] : COLORS).map((c) => {
        const i = COLORS.indexOf(c)
        return (
          <HitButton
            key={c}
            label={tier === 'phone' ? 'Next color' : `Color ${i + 1}`}
            onClick={() => setColor(tier === 'phone' ? (color + 1) % COLORS.length : i)}
            faceClassName=" "
          >
            <span
              className="size-[22px] rounded-full"
              style={{
                background: c,
                boxShadow:
                  color === i
                    ? '0 0 0 2px var(--color-accent-soft), 0 0 0 4px var(--color-ink)'
                    : undefined,
              }}
            />
          </HitButton>
        )
      })}
      {!toolsInline && undoRedo}
    </>
  )

  const annotating = mode === 'annotate'

  const annotateButton = (
    <HitButton
      label="Annotate"
      onClick={enterAnnotate}
      inset
      faceClassName={
        annotateLabel ? 'border border-border px-3 font-medium hover:border-accent' : ''
      }
    >
      <IconPencil size={20} />
      {annotateLabel && 'Annotate'}
    </HitButton>
  )
  const doneButton = (
    <HitButton
      label="Done annotating"
      onClick={leaveAnnotate}
      inset
      faceClassName={`bg-accent-fill text-white group-hover/b:bg-accent-fill/90 ${annotateLabel ? 'px-3 font-medium' : ''}`}
    >
      <IconCheck size={20} />
      {annotateLabel && 'Done'}
    </HitButton>
  )
  const moreButton = (
    <div ref={moreAnchorRef} className="relative">
      <HitButton label="More" onClick={() => setMenu(menu === 'more' ? null : 'more')}>
        <IconDots size={22} />
      </HitButton>
    </div>
  )

  return (
    <div
      data-hits={showHits}
      className="group/sv fixed inset-0 flex flex-col bg-paper font-sans text-ink select-none"
    >
      <header
        className={`relative z-20 shrink-0 border-b pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] ${
          annotating
            ? 'border-accent/30 bg-accent-soft [--sv-hover:var(--color-accent-soft-hover)]'
            : 'border-border bg-paper [--sv-hover:var(--color-paper-hover)]'
        }`}
      >
        {/* Toolbar rows sit over the menus' backdrop (z-40), so their
            buttons keep working while a menu is open. */}
        <div className="relative z-40">
          {tier === 'phone' ? (
            <>
              {/* Phones take two rows (a letter or A4 page leaves the
                  height to spare): ✕, the title, Info, ⋯ and Annotate/Done,
                  then a row that's the same in Play and Annotate — the
                  clock, and the page cyclers pinned to the right edge — so
                  the cyclers never move between modes or as the clock's
                  width changes. */}
              <div className="flex h-14 items-center px-1">
                {closeButton}
                {queueButton}
                {annotating ? (
                  <span className="min-w-0 flex-1 truncate px-2 text-sm font-medium text-accent">
                    Annotating
                  </span>
                ) : (
                  <div className="flex min-w-0 flex-1 flex-col px-2">
                    <span className={`truncate font-display font-medium ${custom ? 'italic' : ''}`}>
                      {custom ? custom.name : (sc?.title ?? 'Loading…')}
                    </span>
                    {(custom ? custom.role : credit) && (
                      <span className="truncate text-xs text-ink-soft">
                        {custom ? custom.role : credit}
                      </span>
                    )}
                  </div>
                )}
                {!custom && infoButton}
                {moreButton}
                <span
                  className={`mx-1 h-7 w-px shrink-0 ${annotating ? 'bg-accent/30' : 'bg-border'}`}
                />
                {annotating ? doneButton : annotateButton}
              </div>
              <div
                ref={phoneRow2Ref}
                className={`flex h-14 items-center border-t px-1 ${
                  annotating ? 'border-accent/30' : 'border-border'
                }`}
              >
                <div className="flex min-w-0 flex-1 items-center">{clockButton}</div>
                {cyclers}
              </div>
            </>
          ) : (
            /* Three columns, the outer two equal, so the cyclers in the
               middle sit at exactly the same spot in Play and Annotate
               (Phase 1). */
            <div className="grid h-14 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-1">
              <div className="flex min-w-0 items-center">
                {closeButton}
                {queueButton}
                {annotating ? (
                  toolsInline ? (
                    <>
                      <span className="mx-1 h-7 w-px shrink-0 bg-accent/30" />
                      {toolButtons}
                    </>
                  ) : (
                    <span className="truncate px-2 text-sm font-medium text-accent">
                      Annotating
                    </span>
                  )
                ) : (
                  <div className="flex min-w-0 flex-col px-2">
                    <span className={`truncate font-display font-medium ${custom ? 'italic' : ''}`}>
                      {custom ? custom.name : (sc?.title ?? 'Loading…')}
                    </span>
                    {(custom ? custom.role : credit) && (
                      <span className="truncate text-xs text-ink-soft">
                        {custom ? custom.role : credit}
                      </span>
                    )}
                  </div>
                )}
              </div>
              {cyclers}
              <div className="flex min-w-0 items-center justify-end">
                {!annotating && (
                  <>
                    {clockButton}
                    {inlineExtras && extras}
                    {photoInline && photoButton}
                    {!custom && infoButton}
                    {!inlineExtras && moreButton}
                    <span className="mx-1 h-7 w-px shrink-0 bg-border" />
                    {annotateButton}
                  </>
                )}
                {annotating && toolsInline && undoRedo}
                {annotating && doneButton}
              </div>
            </div>
          )}
          {annotating && !toolsInline && (
            <div className="flex items-center border-t border-accent/30 px-1">{toolButtons}</div>
          )}
        </div>

        {menu && (
          <>
            {/* Under the toolbar row (z-40), so its buttons still work —
                tapping the clock or ⋯ again closes its menu — and over the
                score, so a tap there only closes the menu, never turns. */}
            <div className="fixed inset-0 z-30" onPointerDown={() => setMenu(null)} />
            {clockMenu}
            {infoPanel}
            {photoPanel}
            {queuePanel}
            {ghostCard}
            {menu === 'more' && (
              <div className="absolute top-full right-2 z-50 mt-1.5 w-72 rounded-xl border border-border bg-paper p-3 shadow-xl [--sv-hover:var(--color-paper-hover)]">
                <MenuRow
                  icon={<IconMetronome size={20} />}
                  label="Metronome"
                  trailing="Coming soon"
                  soon
                />
                <MenuRow
                  icon={<IconClef size={20} />}
                  label="Theory reference"
                  trailing="Coming soon"
                  soon
                />
                {!photoInline && (
                  <MenuRow
                    icon={<IconPhotoCog size={20} />}
                    label="Photo filters"
                    trailing={photoChanged ? 'On' : undefined}
                    onClick={() => setMenu('photo')}
                  />
                )}
              </div>
            )}
          </>
        )}
      </header>

      <main
        className={`relative min-h-0 flex-1 cursor-default overflow-hidden ${zoomed ? 'touch-manipulation' : 'touch-pinch-zoom'}`}
        onPointerDown={onStagePointerDown}
        onPointerUp={onStagePointerUp}
        onPointerCancel={onStagePointerCancel}
        onLostPointerCapture={onStagePointerCancel}
      >
        {/* Plain white mat (plan: launch default). Its filter is set here,
            not by index.css's score-page rules, so the theme's treatment and
            the user's photo filters compose in one list (see scoreFilter).
            The margin keeps the page clear of the screen's edges. */}
        <div
          style={{ filter: scoreFilter, containerType: 'size' }}
          className={`absolute inset-0 flex items-center justify-center bg-white ${
            photo.margin
              ? 'p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]'
              : 'pb-[env(safe-area-inset-bottom)]'
          }`}
        >
          {custom ? (
            <PlaceholderPage entry={custom} />
          ) : (
            activeId !== null && (
              <img
                key={`${activeId}-${page}`}
                src={getPieceThumbnailUrl(activeId, page)}
                alt={`Page ${page}`}
                draggable={false}
                className="block max-h-full max-w-full object-contain"
              />
            )
          )}
        </div>
        {showZones && (mode === 'play' || !tool) && <ZoneOverlay />}
        {/* The notes bar (Phase 3): your notes' first line over the top of
            the page; tap it for Info, ✕ hides it for this piece (Info's
            "Show as banner" brings it back). Its own taps never turn. */}
        {showBar && activeId !== null && (
          <div
            className="absolute inset-x-0 top-0 z-10 flex items-center border-b border-accent/30 bg-accent-soft pr-1 pl-2 [--sv-hover:var(--color-accent-soft-hover)]"
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              data-hit
              onClick={() => openInfo(true)}
              className={`${HIT} min-w-0 flex-1 justify-start group/b`}
              aria-label="Open your notes"
            >
              <span className={`${FACE} ${FACE_HOVER} min-w-0 flex-1 justify-start gap-2.5 px-2`}>
                <IconNotebook size={18} className="shrink-0 text-accent" />
                {/* The first line through MarkdownText, like the notes
                    everywhere else (bold, italics, music symbols), cut to
                    one line. */}
                <MarkdownText className="min-w-0 truncate text-[15px] [&_p]:inline">
                  {firstLine(notes)}
                </MarkdownText>
              </span>
            </button>
            <HitButton label="Hide the banner for this piece" onClick={() => setBar(false)}>
              <IconX size={18} />
            </HitButton>
          </div>
        )}
        {hint && (
          <div
            key={hint.id}
            className={`pointer-events-none absolute ${showBar ? 'top-16' : 'top-4'} left-1/2 z-10 -translate-x-1/2 rounded-full bg-scrim/90 px-4 py-2 text-sm whitespace-nowrap text-white`}
          >
            {hint.text}
          </div>
        )}
      </main>
      {/* Mockup-only controls, bottom-left and over everything (portaled,
          above the cards), opening upward; outside the score, so they never
          turn a page. */}
      {createPortal(
        <div className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 z-[60] flex flex-col-reverse items-start gap-2">
          <button
            type="button"
            onClick={() => setPanelOpen(!panelOpen)}
            className="flex h-10 cursor-pointer items-center gap-2 rounded-full bg-scrim/85 px-4 text-sm font-medium text-white shadow-lg"
          >
            <IconAdjustmentsHorizontal size={18} />
            Mockup
          </button>
          {panelOpen && (
            <div className="flex w-72 flex-col gap-3 rounded-xl border border-border bg-paper-raised p-3 text-sm shadow-xl">
              <p className="font-display font-medium">Mockup</p>
              <SingleSelect
                size="sm"
                label="Piece"
                options={recent.map((p) => ({
                  value: String(p.id),
                  label: `${p.title} (${p.pageCount} pp.)`,
                }))}
                value={activeId === null ? '' : String(activeId)}
                onChange={(v) => {
                  // Play on a piece: one on your Practice List opens the
                  // list at it; any other opens just that piece (Phase 6).
                  setSessionKind(practiceList.includes(Number(v)) ? 'list' : 'piece')
                  setPieceId(Number(v))
                  setPage(1)
                  setEditing(false)
                }}
              />
              <SingleSelect
                size="sm"
                label="Opened from"
                options={[
                  { value: 'piece', label: 'Play on a piece' },
                  { value: 'list', label: 'The sidebar’s Practice List' },
                  { value: 'setlist', label: 'Play Set (example setlist)' },
                ]}
                value={sessionKind}
                onChange={(v) => openSession(v as SessionKind)}
              />
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={practiceList.length === 0}
                  onChange={(e) => setListOverride(e.target.checked ? [] : null)}
                />
                Empty Practice List
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={fastMinute} onChange={(e) => setFastMinute(e.target.checked)} />
                “Practiced” after 5 s, not 30
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={trackingOn} onChange={(e) => setTrackingOn(e.target.checked)} />
                Practice tracking (User Settings)
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={hasNotes} onChange={(e) => setHasNotes(e.target.checked)} />
                Piece has notes
              </label>
              <SingleSelect
                size="sm"
                label="Theme"
                options={[
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
                value={theme}
                onChange={(v) => setTheme(v as 'light' | 'dark')}
              />
              <label className="flex items-center gap-2">
                <Checkbox checked={darkScores} onChange={(e) => setDarkScores(e.target.checked)} />
                Dark Mode Scores
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={showZones} onChange={(e) => setShowZones(e.target.checked)} />
                Show tap zones
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={showHits} onChange={(e) => setShowHits(e.target.checked)} />
                Show hit areas
              </label>
              <p className="text-xs text-ink-soft">
                Tap the score&rsquo;s sides to turn pages; arrow keys, Space and Page Up/Down act as
                a pedal. The exit arrow needs two taps.
              </p>
              <div className="flex flex-col gap-2 border-t border-border pt-3">
                <p className="font-medium">Turn test</p>
                <p className="text-xs text-ink-soft">
                  Times page turns on this piece&rsquo;s real pages, the old build&rsquo;s way and
                  the current one. About half a minute; don&rsquo;t touch the screen.
                </p>
                <button
                  type="button"
                  disabled={turnTestRunning || !piece || piece.pageCount < 3}
                  onClick={async () => {
                    if (!piece) return
                    setTurnTestRunning(true)
                    setTurnTestCopied(false)
                    const id = piece.id
                    setTurnTestResult(
                      await runTurnTest((p) => getPiecePageUrl(id, p), piece.pageCount),
                    )
                    setTurnTestRunning(false)
                  }}
                  className="h-9 cursor-pointer rounded-lg border border-border bg-paper-raised font-medium text-ink hover:border-accent disabled:opacity-50"
                >
                  {turnTestRunning
                    ? 'Running…'
                    : piece && piece.pageCount < 3
                      ? 'Pick a piece of 3+ pages'
                      : 'Run turn test'}
                </button>
                {turnTestResult && (
                  <>
                    <pre className="max-h-48 overflow-auto rounded-lg bg-paper-sunken p-2 text-xs whitespace-pre-wrap select-text">
                      {turnTestResult}
                    </pre>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () =>
                          setTurnTestCopied(await copyToClipboard(turnTestResult))
                        }
                        className="h-8 flex-1 cursor-pointer rounded-lg border border-border bg-paper-raised text-ink hover:border-accent"
                      >
                        {turnTestCopied ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          clearInterruptedTurnTest()
                          setTurnTestResult(null)
                        }}
                        className="h-8 flex-1 cursor-pointer rounded-lg border border-border bg-paper-raised text-ink hover:border-accent"
                      >
                        Clear
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}

// A custom setlist entry's stand-in page in a setlist session (Phase 6): the
// Setlist PDF's Generated Program Page (SetlistProgramPageMockup.tsx,
// drawProgramPage), drawn the same way at a Letter page's proportions —
// sized in real points against the page's own width (1pt = 100cqw / 612).
const PRINT_INK = '#1c1815'
const PRINT_FAINT = '#5c5349'
const PRINT_FAINTER = '#b3a99e'
const LETTER = { w: 612, h: 792 }
const pt = (n: number) => `calc(${n} * 100cqw / ${LETTER.w})`
function PlaceholderPage({ entry }: { entry: CustomEntry }) {
  const smallCaps = {
    fontSize: pt(11 * 1.08),
    letterSpacing: '0.1em',
    lineHeight: 'normal',
    color: PRINT_FAINT,
  }
  return (
    <div
      className="relative bg-white"
      style={{
        width: `min(100cqw, calc(100cqh * ${LETTER.w} / ${LETTER.h}))`,
        aspectRatio: `${LETTER.w} / ${LETTER.h}`,
        containerType: 'inline-size',
      }}
    >
      {/* Optically centered: 72pt margins, lifted 4% of the page height. */}
      <div
        className="absolute flex flex-col items-center justify-center text-center"
        style={{ inset: `${pt(72)} ${pt(72)} ${pt(72 + 2 * 0.04 * LETTER.h)}` }}
      >
        <div className="flex flex-col items-center" style={{ gap: pt(10) }}>
          <span
            aria-hidden="true"
            style={{
              display: 'block',
              width: pt(6),
              height: pt(6),
              background: PRINT_FAINTER,
              transform: 'rotate(45deg)',
              margin: `${pt(3)} 0 ${pt(11)}`,
            }}
          />
          <span className="font-sans uppercase" style={smallCaps}>
            {entry.role}
          </span>
          <span
            className="font-display italic"
            style={{ fontSize: pt(24), lineHeight: 1.24, color: PRINT_INK, width: pt(288) }}
          >
            {entry.name}
          </span>
          {entry.notes && (
            <>
              <span
                aria-hidden="true"
                style={{
                  height: pt(1),
                  width: pt(24),
                  background: PRINT_FAINTER,
                  margin: `${pt(2)} 0`,
                }}
              />
              <p
                className="font-sans"
                style={{
                  fontSize: pt(12 * 1.08),
                  letterSpacing: '0.02em',
                  lineHeight: 1.4,
                  color: PRINT_FAINT,
                  width: pt(288),
                  margin: 0,
                }}
              >
                {entry.notes}
              </p>
            </>
          )}
          {entry.duration && (
            <span className="font-sans uppercase tabular-nums" style={smallCaps}>
              {entry.duration}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function MenuRow({
  icon,
  label,
  trailing,
  onClick,
  soon,
}: {
  icon: ReactNode
  label: string
  trailing?: ReactNode
  onClick?: () => void
  soon?: boolean
}) {
  return (
    <button
      type="button"
      data-hit
      onClick={onClick}
      aria-disabled={soon || undefined}
      className={`${HIT} w-full group/b ${soon ? 'cursor-default text-ink-fainter' : ''}`}
    >
      <span className={`${FACE} ${soon ? '' : FACE_HOVER} w-full justify-start gap-3 px-3`}>
        {icon}
        {label}
        {trailing && <span className="ml-auto text-xs text-ink-faint">{trailing}</span>}
      </span>
    </button>
  )
}

function ZoneOverlay() {
  const back = 'color-mix(in srgb, var(--color-accent) 16%, transparent)'
  const forward = 'color-mix(in srgb, #2f6fb5 16%, transparent)'
  const label =
    'absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-paper-raised px-2.5 py-1 text-xs font-bold tracking-wider uppercase'
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute inset-y-0 left-0 w-1/3" style={{ background: back }} />
      <div className="absolute top-0 left-1/3 h-1/2 w-1/3" style={{ background: back }} />
      <div className="absolute inset-y-0 right-0 w-1/3" style={{ background: forward }} />
      <div className="absolute bottom-0 left-1/3 h-1/2 w-1/3" style={{ background: forward }} />
      <span className={`${label} top-1/2 left-1/6 text-accent`}>‹ Back</span>
      <span className={`${label} top-1/4 left-1/2 text-accent`}>‹ Back</span>
      <span className={`${label} top-1/2 left-5/6 text-ink`}>Forward ›</span>
      <span className={`${label} top-3/4 left-1/2 text-ink`}>Forward ›</span>
    </div>
  )
}
