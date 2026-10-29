import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowLeft,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCircle,
  IconCircleCheckFilled,
  IconCircleOff,
  IconClef,
  IconClock,
  IconContrast,
  IconDots,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconGripVertical,
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
  IconStack2,
  IconStopwatch,
  IconSun,
  IconX,
} from '@tabler/icons-react'
import {
  getAnnotations,
  savePageAnnotations,
  withAnnotations,
  type AnnotationPages,
} from '../api/annotations'
import { startDownload } from '../lib/download'
import { ApiError } from '../api/client'
import { getConfig } from '../api/config'
import {
  getPracticed,
  getPracticeList,
  removeFromPracticeList,
  reorderPracticeList,
  setPracticed,
  type PracticedState,
  type PracticeListEntry,
} from '../api/practiceList'
import { getSetlist } from '../api/setlists'
import type { SetlistPieceSummary } from '../api/types'
import { listPracticeStatuses } from '../api/lookups'
import {
  DEFAULT_PRACTICE_SETTINGS,
  getPiece,
  getPieceFileUrl,
  getPiecePageUrl,
  getPracticeSettings,
  preparePiecePages,
  savePracticeSettings,
  setPiecePracticeStatus,
  setPieceUserNotes,
  type PracticeSettings,
} from '../api/pieces'
import {
  getUserSettings,
  TURN_GUARD_DEFAULT,
  updateUserSettings,
  type UserSettings,
} from '../api/userSettings'
import { InfoTooltip } from '../components/InfoTooltip'
import { PageMarks, TextMarks } from '../components/SheetViewerAnnotations'
import { MarkdownText } from '../components/MarkdownText'
import { PracticeStatusKeyIcon } from '../components/PracticeStatusIcon'
import { Toggle } from '../components/Toggle'
import { useAnchoredPanel } from '../hooks/useAnchorRect'
import { useNoPageScroll } from '../hooks/useNoPageScroll'
import { useToday } from '../hooks/useToday'
import { stageTurn, type StagePoint } from '../lib/sheetViewerGestures'
import {
  applyChange,
  eraserTouches,
  removedSince,
  strokeTouchesPage,
  TEXT_LINE_HEIGHT,
  type Mark,
  type MarkChange,
  type MarkPoint,
  type PageBox,
  type StrokeMark,
  type TextMark,
} from '../lib/sheetViewerMarks'
import { takeTip } from '../lib/sheetViewerTips'
import {
  describeChange,
  LAYER_COLORS,
  layerColor,
  LIFT_GAP,
  SIZES,
  textBoxStyle,
  TOOL_START,
  TOOLS,
  TOOLS_INLINE_MIN_WIDTH,
  type ColorTool,
  type PageLook,
  type Size,
  type TextEdit,
  type Tool,
} from '../lib/sheetViewerTools'
import { hasPermission, useAuth } from '../lib/AuthContext'
import { useShortcutBlocker } from '../lib/shortcuts'
import { sortPracticeStatuses } from '../lib/practiceStatusOrder'
import { useDarkScoresSync, useThemeSync } from '../lib/theme'
import { usePageTitle } from '../lib/usePageTitle'
import { MarkdownHint } from '../components/MarkdownHint'

// The Sheet Viewer (design doc §13; plan phases in memory): a full-screen
// mode for reading a piece — the score, and a toolbar that's always there.
// Built from /mockup/sheet-viewer (SheetViewerMockup.tsx), which stays the
// design's reference. Phases 9–10 of its plan: real pages, turning (tap
// zones, swipes, pedal keys, debounced), the clock, photo filters and the
// edge margin, and Info — your notes, practice status and the piece's
// details — with the notes bar. Settings are saved: the clock's per account,
// the page's look and the notes bar per piece. Annotate (phase 18): pen,
// highlighter, text and eraser, in six colors that can be hidden per piece,
// with undo across the session, each account's marks saved page by page.
//
// Every control's hit area is 48×48: a 48px button around a smaller drawn
// face. Each carries data-hit for frontend/scripts/check-hit-areas.mjs.

const HIT = 'relative flex h-12 min-w-12 shrink-0 cursor-pointer items-center justify-center'
const FACE =
  'flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-[10px] whitespace-nowrap'
// The hover fill follows the surface: paper-hover on the toolbar and in
// menus. Each surface sets --sv-hover.
const FACE_HOVER = 'group-hover/b:bg-(--sv-hover)'

const PHOTO_WIDTH = 320

// Photo controls: discrete steps, never live-dragged values.
const PHOTO_STEP = 10
const PHOTO_MIN = 50
const PHOTO_MAX = 150
// A burst of changes (stepping brightness) is saved once, this long after
// the last.
const SAVE_DELAY_MS = 400

const INFO_WIDTH = 380
const QUEUE_WIDTH = 380
// A piece counts as practiced today once this long has been spent on it in
// the viewer, across visits in a session.
const PRACTICED_MS = 30_000
// Notes are broad strokes and a practice log; markings on the music belong
// in Annotate.
const EMPTY_NOTES =
  'Nothing yet. Big picture notes go here: what to remember about this piece, or a log of how practice is going. Markings on the music can be made in Annotate mode.'

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  return `${m}:${String(seconds % 60).padStart(2, '0')}`
}
// The notes bar shows the first line, Markdown and all.
function firstLine(markdown: string) {
  return (markdown.split('\n').find((l) => l.trim()) ?? '').trim()
}

// A turn in the same direction within the user's double-turn guard (User
// Settings › Sheet Viewer, 500ms by default) of the last one is ignored — an
// accidental double tap or a bouncing pedal — with a "Double-turn ignored"
// pill, so it's clear the press registered; the opposite direction always
// fires, and every turn resets both.
const CLOSE_CONFIRM_MS = 3000
const HINT_MS = 1800
// How long a page may take before "Preparing page…" shows, so a page that's
// already rendered never flashes it.
const SLOW_PAGE_MS = 300
// An undo or redo of a change on another page turns there first, then
// applies it this long after the page shows, so you see it happen — or
// after UNDO_WAIT_MS if the page never shows.
const UNDO_TURN_MS = 450
// TEMPORARY (turn-speed diagnosis on the iPad): ?turntime shows each turn's
// time from the tap or key to the new page painted; ?nomarks leaves the
// marks layer out; ?parentfilter puts the photo filter back on the page's
// container. Remove once measured.
let lastInputAt = 0
const UNDO_WAIT_MS = 10_000
// Page-turner pedals pair as keyboards sending this fixed set; no remapping.
const BACK_KEYS = ['ArrowLeft', 'ArrowUp', 'PageUp']
const FORWARD_KEYS = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter']

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

// The theme and Dark Mode Scores as <html> has them right now — they can
// change while the viewer is open (a "system" theme following the device).
function subscribeRootAttributes(callback: () => void) {
  const observer = new MutationObserver(callback)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-dark-scores'],
  })
  return () => observer.disconnect()
}
function useRootTheme() {
  const dark = useSyncExternalStore(
    subscribeRootAttributes,
    () => document.documentElement.dataset.theme === 'dark',
  )
  const darkScores = useSyncExternalStore(subscribeRootAttributes, () =>
    document.documentElement.hasAttribute('data-dark-scores'),
  )
  return { dark, darkScores }
}

/** The clock and stopwatch readouts: Atkinson Hyperlegible Next with
 * tabular figures (--font-clock), so the time never shifts as it ticks. Its
 * colons sit on the baseline, so each is raised 0.09em — centered on the
 * figures' height, measured from the font's own outlines. */
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
// The stopwatch always shows seconds — without them it sits at 00:00 for its
// first minute and reads as broken.
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

// No title tooltips on the viewer's controls: once Chrome on the Mac shows
// one, it keeps the plain arrow cursor while tooltip mode lasts, and a
// toolbar of touching buttons never lets it reset — so the hand cursor
// vanished across the whole bar. Each control keeps its aria-label.
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

/** A faint, tappable "coming soon" button — the app's InfoTooltip treatment.
 * Sits where the real control will go, so its place is already familiar. */
function SoonButton({
  label,
  message,
  children,
  faceClassName = '',
  inset,
}: {
  label: string
  message: string
  children: ReactNode
  faceClassName?: string
  /** As HitButton's: a wide face stays 4px inside its tap area. */
  inset?: boolean
}) {
  return (
    <span data-hit className={HIT}>
      <InfoTooltip
        message={message}
        ariaLabel={label}
        showPointerCursor={false}
        triggerClassName={`flex h-12 min-w-12 items-center justify-center text-ink-fainter ${inset ? 'px-1' : ''}`}
      >
        <span className={`${FACE} ${faceClassName}`}>{children}</span>
      </InfoTooltip>
    </span>
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

// The Sheet Viewer's switch row (design D): label first, lined up with the
// icon rows' text (12px padding + 20px icon + 10px gap), the 44×26 switch at
// the right edge; the whole 48pt row flips it.
function SwitchRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
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

function StepperRow({
  label,
  Icon,
  value,
  onChange,
}: {
  label: string
  Icon: typeof IconSun
  value: number
  onChange: (v: number) => void
}) {
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

type ClockMode = 'clock' | 'stopwatch'

// A session: what the viewer plays through. A piece on its own; the
// Practice List (from the sidebar, or Play on a piece that's on it, opened
// at that piece); or a setlist (Play Set), whose custom entries show as
// placeholder pages. The viewer below shows one item at a time, remounted
// per item; what has to carry across items lives here.
type QueueItem =
  | { kind: 'piece'; key: string; id: number; title: string; credit: string; pageCount: number }
  | {
      kind: 'custom'
      key: string
      name: string
      role: string | null
      notes: string | null
      durationSeconds: number | null
    }
// Where an item opens: its first or last page, or a given page (an undo
// that turns back to another piece).
type StartPage = 'first' | 'last' | number

interface Session {
  kind: 'piece' | 'list' | 'setlist'
  /** The queue's title: "Practice List", or the setlist's name. */
  title: string
  items: QueueItem[]
  /** The item showing, or -1 (a piece on its own; an empty list). */
  index: number
  goTo: (index: number, page: StartPage, hint?: string) => void
  /** Where Exit goes when the viewer wasn't opened from inside the app. */
  exitTo: string
  /** Practice List only: each piece's mark for today, and its edits. */
  marks?: Record<number, boolean | null>
  onMark?: (pieceId: number, practiced: boolean) => void
  onRemove?: (pieceId: number) => void
  onReorder?: (pieceIds: number[]) => void
  shared: SessionShared
}

// Kept across items: the stopwatch keeps running, the double-turn guard
// still catches a double tap at a piece's end, and time on a piece adds up
// toward "practiced" across visits.
interface SessionShared {
  swStart: number | null
  swAcc: number
  setSwStart: (v: number | null) => void
  setSwAcc: (v: number) => void
  /** False when a turn repeats the last one's direction within guardMs
   * (the double-turn guard); otherwise records it. */
  allowTurn: (dir: -1 | 1, guardMs: number) => boolean
  /** Time spent on a piece so far this session, and adding to it. */
  spentOn: (pieceId: number) => number
  addSpent: (pieceId: number, ms: number) => void
  hint: string | null
  annotations: AnnotationSession
}

// Annotate's session-long state, which outlives each item's viewer: the
// mode, the picked tool and each tool's color and size, every visited
// piece's marks (as loaded, then as edited), the undo history, and saving.
// A page is saved whole, shortly after its last change, and when the
// viewer closes or the app goes to the background.
interface AnnotationSession {
  mode: 'play' | 'annotate'
  setMode: (mode: 'play' | 'annotate') => void
  tool: Tool | null
  setTool: (tool: Tool | null) => void
  toolStyle: Record<ColorTool, { color: number; size: Size }>
  setToolStyle: (style: Record<ColorTool, { color: number; size: Size }>) => void
  eraserSize: Size
  setEraserSize: (size: Size) => void
  /** Marks by piece id, then page; a piece not loaded yet is missing. */
  pages: Record<number, AnnotationPages>
  load: (pieceId: number) => void
  update: (pieceId: number, page: number, change: (marks: Mark[]) => Mark[]) => void
  history: { done: MarkChange[]; undone: MarkChange[] }
  record: (change: MarkChange) => void
  /** Undoes (or redoes) the last change, wherever it was. */
  apply: (direction: 'undo' | 'redo') => void
  /** A step handed to the item it turns to, applied once its page shows. */
  pending: { key: string; direction: 'undo' | 'redo' } | null
  setPending: (step: { key: string; direction: 'undo' | 'redo' } | null) => void
  /** Where a failed load or save is reported: the item showing. */
  setNotify: (notify: (text: string) => void) => void
  /** Saves every change still waiting, now; true once all of them (and any
   * save already on its way) have landed. */
  saveNow: () => Promise<boolean>
}

function useAnnotationSession(): AnnotationSession {
  const [mode, setMode] = useState<'play' | 'annotate'>('play')
  const [tool, setTool] = useState<Tool | null>(null)
  const [toolStyle, setToolStyle] = useState(TOOL_START)
  const [eraserSize, setEraserSize] = useState<Size>('M')
  const [pages, setPages] = useState<Record<number, AnnotationPages>>({})
  const [history, setHistory] = useState<{ done: MarkChange[]; undone: MarkChange[] }>({
    done: [],
    undone: [],
  })
  const [pending, setPending] = useState<{ key: string; direction: 'undo' | 'redo' } | null>(null)
  // Mirrors of the two states, read by saves and by steps applied from a
  // timer, which mustn't see an older render's copy.
  const pagesRef = useRef(pages)
  const historyRef = useRef(history)
  const loading = useRef(new Set<number>())
  const unsaved = useRef(new Set<string>())
  const saveTimer = useRef<number | undefined>(undefined)
  // The saves on their way, and whether they all landed.
  const inFlight = useRef<Promise<boolean>>(Promise.resolve(true))
  const notify = useRef<(text: string) => void>(() => {})
  function setAllPages(next: Record<number, AnnotationPages>) {
    pagesRef.current = next
    setPages(next)
  }
  function load(pieceId: number) {
    if (pagesRef.current[pieceId] || loading.current.has(pieceId)) return
    loading.current.add(pieceId)
    getAnnotations(pieceId)
      .then((loaded) => setAllPages({ ...pagesRef.current, [pieceId]: loaded }))
      .catch(() => {
        loading.current.delete(pieceId)
        notify.current('Couldn’t load your marks')
      })
  }
  function flush() {
    window.clearTimeout(saveTimer.current)
    const keys = [...unsaved.current]
    unsaved.current.clear()
    const saves = keys.map((key) => {
      const [pieceId, page] = key.split(':').map(Number)
      return savePageAnnotations(pieceId, page, pagesRef.current[pieceId]?.[page] ?? []).then(
        () => true,
        () => {
          notify.current('Couldn’t save your marks')
          return false
        },
      )
    })
    const before = inFlight.current.then(() => true)
    inFlight.current = Promise.all([before, ...saves]).then((done) => done.every(Boolean))
    return inFlight.current
  }
  function update(pieceId: number, page: number, change: (marks: Mark[]) => Mark[]) {
    const piece = pagesRef.current[pieceId] ?? {}
    setAllPages({ ...pagesRef.current, [pieceId]: { ...piece, [page]: change(piece[page] ?? []) } })
    unsaved.current.add(`${pieceId}:${page}`)
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(flush, SAVE_DELAY_MS)
  }
  function setAllHistory(next: { done: MarkChange[]; undone: MarkChange[] }) {
    historyRef.current = next
    setHistory(next)
  }
  function record(change: MarkChange) {
    setAllHistory({ done: [...historyRef.current.done, change], undone: [] })
  }
  function apply(direction: 'undo' | 'redo') {
    const h = historyRef.current
    const change = (direction === 'undo' ? h.done : h.undone).at(-1)
    if (!change) return
    const [pieceId, page] = change.key.split(':').map(Number)
    update(pieceId, page, (marks) => applyChange(marks, change, direction))
    setAllHistory(
      direction === 'undo'
        ? { done: h.done.slice(0, -1), undone: [...h.undone, change] }
        : { done: [...h.done, change], undone: h.undone.slice(0, -1) },
    )
  }
  // Closing the viewer, or the app going to the background, saves at once.
  const flushRef = useRef(flush)
  useEffect(() => {
    flushRef.current = flush
  })
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushRef.current()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      flushRef.current()
    }
  }, [])
  return {
    mode,
    setMode,
    tool,
    setTool,
    toolStyle,
    setToolStyle,
    eraserSize,
    setEraserSize,
    pages,
    load,
    update,
    history,
    record,
    apply,
    pending,
    setPending,
    setNotify: (fn) => {
      notify.current = fn
    },
    saveNow: flush,
  }
}

function useSessionShared(hint: string | null): SessionShared {
  const [swStart, setSwStart] = useState<number | null>(null)
  const [swAcc, setSwAcc] = useState(0)
  const lastTurn = useRef({ dir: 0, at: 0 })
  const spent = useRef(new Map<number, number>())
  function allowTurn(dir: -1 | 1, guardMs: number) {
    const t = performance.now()
    if (dir === lastTurn.current.dir && t - lastTurn.current.at < guardMs) return false
    lastTurn.current = { dir, at: t }
    return true
  }
  function spentOn(pieceId: number) {
    return spent.current.get(pieceId) ?? 0
  }
  function addSpent(pieceId: number, ms: number) {
    spent.current.set(pieceId, spentOn(pieceId) + ms)
  }
  const annotations = useAnnotationSession()
  return { swStart, swAcc, setSwStart, setSwAcc, allowTurn, spentOn, addSpent, hint, annotations }
}

function pieceItem(piece: SetlistPieceSummary, key: string): QueueItem {
  return {
    kind: 'piece',
    key,
    id: piece.id,
    title: piece.title,
    credit: [
      ...piece.composer.map((p) => p.name),
      ...piece.arranger.map((p) => `arr. ${p.name}`),
    ].join(', '),
    pageCount: piece.pageCount,
  }
}

/** /pieces/:id/play. The whole viewer needs the `practice` permission;
 * without it (a link followed, a typed address) it goes back to the piece.
 * A piece on your Practice List opens the list at that piece. */
export function SheetViewerPage() {
  const { id } = useParams()
  const me = useAuth()
  const pieceId = Number(id)
  if (!Number.isInteger(pieceId) || pieceId < 1) return <Navigate to="/" replace />
  if (!hasPermission(me, 'practice')) return <Navigate to={`/pieces/${pieceId}`} replace />
  return <PieceOrListSession key={pieceId} pieceId={pieceId} />
}

/** /practice-list/play — the sidebar's Practice List, from the top. */
export function PracticeListPlayPage() {
  const me = useAuth()
  if (!hasPermission(me, 'practice')) return <Navigate to="/" replace />
  return <ListSession startId={null} exitTo="/" />
}

/** /setlists/:id/play — Play Set: the setlist in its order, for this
 * session only (the Practice List is left alone). */
export function SetlistPlayPage() {
  const { id } = useParams()
  const me = useAuth()
  const setlistId = Number(id)
  if (!Number.isInteger(setlistId) || setlistId < 1) return <Navigate to="/" replace />
  if (!hasPermission(me, 'practice')) return <Navigate to={`/setlists/${setlistId}`} replace />
  return <SetlistSession key={setlistId} setlistId={setlistId} />
}

function PieceOrListSession({ pieceId }: { pieceId: number }) {
  const day = useToday()
  const { data: entries, isError } = useQuery({
    queryKey: ['practice-list', day],
    queryFn: () => getPracticeList(day),
  })
  const [hint, setHint] = useState<string | null>(null)
  const shared = useSessionShared(hint)
  if (!entries && !isError) return <div className="fixed inset-0 bg-paper" />
  if (entries?.some((e) => e.piece.id === pieceId))
    return <ListSession startId={pieceId} exitTo={`/pieces/${pieceId}`} />
  const item: QueueItem = {
    kind: 'piece',
    key: `p:${pieceId}`,
    id: pieceId,
    title: '',
    credit: '',
    pageCount: 1,
  }
  const session: Session = {
    kind: 'piece',
    title: '',
    items: [],
    index: -1,
    goTo: (_index, _page, next) => setHint(next ?? null),
    exitTo: `/pieces/${pieceId}`,
    shared,
  }
  return <SheetViewer key={item.key} item={item} startPage="first" session={session} />
}

function ListSession({ startId, exitTo }: { startId: number | null; exitTo: string }) {
  const day = useToday()
  const queryClient = useQueryClient()
  const listKey = ['practice-list', day]
  const { data: entries, isError } = useQuery({
    queryKey: listKey,
    queryFn: () => getPracticeList(day),
  })
  const [current, setCurrent] = useState<{ id: number | null; page: StartPage }>({
    id: startId,
    page: 'first',
  })
  const [hint, setHint] = useState<string | null>(null)
  const shared = useSessionShared(hint)

  if (!entries && !isError) return <div className="fixed inset-0 bg-paper" />
  const list = entries ?? []
  const items = list.map((e) => pieceItem(e.piece, `p:${e.piece.id}`))
  // The sidebar's entry starts at the top; a piece taken off the list while
  // showing gives way to the top too.
  let index = items.findIndex((i) => i.kind === 'piece' && i.id === current.id)
  if (index < 0 && items.length) index = 0

  function updateList(change: (entries: PracticeListEntry[]) => PracticeListEntry[]) {
    queryClient.setQueryData<PracticeListEntry[]>(listKey, (old) => change(old ?? []))
  }
  function failed(message: string) {
    setHint(message)
    queryClient.invalidateQueries({ queryKey: ['practice-list'] })
  }
  const session: Session = {
    kind: 'list',
    title: 'Practice List',
    items,
    index,
    goTo: (i, page, next) => {
      const item = items[i]
      if (item?.kind !== 'piece') return
      setCurrent({ id: item.id, page })
      setHint(next ?? null)
    },
    exitTo,
    marks: Object.fromEntries(list.map((e) => [e.piece.id, e.practiced])),
    onMark: (pieceId, practiced) => {
      updateList((old) => old.map((e) => (e.piece.id === pieceId ? { ...e, practiced } : e)))
      queryClient.setQueryData<PracticedState>(['practiced', pieceId, day], (old) => ({
        practiced,
        lastPracticed: practiced ? day : (old?.lastPracticed ?? null),
      }))
      setPracticed(pieceId, day, practiced)
        .then(() => queryClient.invalidateQueries({ queryKey: ['practiced', pieceId] }))
        .catch(() => failed('Couldn’t save the mark'))
    },
    onRemove: (pieceId) => {
      updateList((old) => old.filter((e) => e.piece.id !== pieceId))
      removeFromPracticeList(pieceId).catch(() => failed('Couldn’t remove that piece'))
    },
    onReorder: (pieceIds) => {
      updateList((old) => pieceIds.flatMap((id) => old.filter((e) => e.piece.id === id)))
      reorderPracticeList(pieceIds).catch(() => failed('Couldn’t save the new order'))
    },
    shared,
  }
  const item = index >= 0 ? items[index] : null
  return (
    <SheetViewer
      key={item?.key ?? 'empty'}
      item={item}
      startPage={current.page}
      session={session}
    />
  )
}

function SetlistSession({ setlistId }: { setlistId: number }) {
  const { data: setlist, error } = useQuery({
    queryKey: ['setlist', setlistId],
    queryFn: () => getSetlist(setlistId),
  })
  const [current, setCurrent] = useState<{ index: number; page: StartPage }>({
    index: 0,
    page: 'first',
  })
  const [hint, setHint] = useState<string | null>(null)
  const shared = useSessionShared(hint)
  if (!setlist && !error) return <div className="fixed inset-0 bg-paper" />
  const items: QueueItem[] = (setlist?.entries ?? []).map((e) =>
    e.kind === 'piece' && e.piece
      ? pieceItem(e.piece, `e:${e.id}`)
      : {
          kind: 'custom',
          key: `e:${e.id}`,
          name: e.customName ?? '',
          role: e.role,
          notes: e.customNotes ?? null,
          durationSeconds: e.customDurationSeconds ?? null,
        },
  )
  const index = items.length ? Math.min(current.index, items.length - 1) : -1
  const session: Session = {
    kind: 'setlist',
    title: setlist?.name ?? 'Setlist',
    items,
    index,
    goTo: (i, page, next) => {
      setCurrent({ index: i, page })
      setHint(next ?? null)
    },
    exitTo: `/setlists/${setlistId}`,
    shared,
  }
  const item = index >= 0 ? items[index] : null
  return (
    <SheetViewer
      key={item?.key ?? 'empty'}
      item={item}
      startPage={current.page}
      session={session}
    />
  )
}

function SheetViewer({
  item,
  startPage,
  session,
}: {
  item: QueueItem | null
  startPage: StartPage
  session: Session
}) {
  const pieceId = item?.kind === 'piece' ? item.id : null
  const custom = item?.kind === 'custom' ? item : null
  // Page shortcuts (letters, numbers, the shortcut help) stay off while the
  // viewer is up; it has its own keys — the pedal set.
  useShortcutBlocker(true)
  // Nothing here scrolls: no page bounce, no browser pull-to-refresh.
  useNoPageScroll()
  const navigate = useNavigate()
  const width = useWindowWidth()
  // Pinch-zoomed in, the score pans instead of turning: taps and swipes
  // on it do nothing (the pedal keys and the toolbar still turn).
  // The current page's full 300ppi image also lies over its screen-size
  // drawing then, so zoomed detail stays sharp.
  const zoomed = usePinchZoomed()
  const tier = width >= 1100 ? 'wide' : width >= 640 ? 'mid' : 'phone'
  // Below 900px a labeled Annotate button doesn't fit, so it's an icon.
  const annotateLabel = width >= 900

  // Outside AppShell, so the viewer keeps the theme in step itself.
  const { data: settings } = useQuery({ queryKey: ['user-settings'], queryFn: getUserSettings })
  useThemeSync(settings?.themePreference)
  useDarkScoresSync(settings?.darkModeScores)
  const { dark, darkScores } = useRootTheme()

  const {
    data: piece,
    error: pieceError,
    refetch: refetchPiece,
  } = useQuery({
    queryKey: ['piece', pieceId],
    queryFn: () => getPiece(pieceId as number),
    enabled: pieceId !== null,
  })
  const { data: config } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  usePageTitle(custom ? custom.name : piece?.title)
  const pageCount = custom ? 1 : (piece?.pageCount ?? 1)
  const pageVersion =
    piece && config ? `${piece.fileHash.slice(0, 16)}.${config.pagesVersion}` : undefined

  // Opening the piece starts rendering all its pages, so the ones ahead are
  // ready before they're turned to. Its failure only means each page
  // renders as it's asked for.
  useEffect(() => {
    if (pieceId !== null) preparePiecePages(pieceId).catch(() => {})
  }, [pieceId])

  // Arriving backward from the next item starts on this one's last page,
  // known once the piece has loaded.
  const [pageState, setPage] = useState<number | 'last'>(
    startPage === 'last' ? 'last' : startPage === 'first' ? 1 : startPage,
  )
  const page = pageState === 'last' ? pageCount : pageState
  // Per page URL: its finished drawing (PageDrawing); failed to load. A
  // retry bumps attempt, which remounts the failed page.
  const [ready, setReady] = useState<Record<string, HTMLCanvasElement>>({})
  const [failed, setFailed] = useState<Record<string, boolean>>({})
  const [attempt, setAttempt] = useState(0)
  // An empty Practice List opens with its queue showing what to do.
  const [menu, setMenu] = useState<
    'clock' | 'more' | 'photo' | 'info' | 'queue' | 'layers' | 'tool' | null
  >(session.kind === 'list' && !item ? 'queue' : null)
  const [closeArmed, setCloseArmed] = useState(false)
  // A pill the session handed over (moving to the next item shows its
  // name), shown on arrival.
  const [hint, setHint] = useState<{ text: string; id: number } | null>(() =>
    session.shared.hint ? { text: session.shared.hint, id: 1 } : null,
  )
  const queryClient = useQueryClient()
  const hintTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    hintTimer.current = window.setTimeout(() => setHint(null), HINT_MS)
  }, [])
  // A short-lived pill over the page (a guarded turn, a failed save).
  function flash(text: string) {
    window.clearTimeout(hintTimer.current)
    // A new id each time, so a pill replacing one still showing restarts.
    setHint((current) => ({ text, id: (current?.id ?? 0) + 1 }))
    hintTimer.current = window.setTimeout(() => setHint(null), HINT_MS)
  }

  // The clock's settings follow the user to every piece (user_settings),
  // saved as they change.
  const clockOn = settings?.clockShown ?? true
  const clockMode: ClockMode = settings?.clockMode ?? 'clock'
  const showSeconds = settings?.clockSeconds ?? false
  function setClock(
    change: Partial<Pick<UserSettings, 'clockShown' | 'clockMode' | 'clockSeconds'>>,
  ) {
    if (!settings) return
    const next = { ...settings, ...change }
    queryClient.setQueryData(['user-settings'], next)
    updateUserSettings(next).catch(() => {
      flash('Couldn’t save the clock setting')
      queryClient.invalidateQueries({ queryKey: ['user-settings'] })
    })
  }
  const setClockOn = (clockShown: boolean) => setClock({ clockShown })
  const setClockMode = (mode: ClockMode) => setClock({ clockMode: mode })
  const setShowSeconds = (clockSeconds: boolean) => setClock({ clockSeconds })

  // The page's look and the notes bar are kept per piece: shown at once,
  // saved shortly after the last change. Its own cache key, outside
  // ['piece', id], so a refresh of the piece never overwrites a change
  // that's still waiting to be saved.
  const practiceKey = ['practice-settings', pieceId]
  const { data: practice = DEFAULT_PRACTICE_SETTINGS } = useQuery({
    queryKey: practiceKey,
    queryFn: () => getPracticeSettings(pieceId as number),
    enabled: pieceId !== null,
  })
  // A piece whose banner the user hasn't set follows User Settings' "Show
  // practice notes as banner"; switching it here sets it for this piece.
  const notesBarShown = practice.notesBarShown ?? settings?.notesBarDefault ?? false
  const pendingPractice = useRef<PracticeSettings | null>(null)
  const practiceTimer = useRef<number | undefined>(undefined)
  const flushPractice = useRef(() => {})
  useEffect(() => {
    flushPractice.current = () => {
      window.clearTimeout(practiceTimer.current)
      const next = pendingPractice.current
      pendingPractice.current = null
      if (next && pieceId !== null)
        savePracticeSettings(pieceId, next).catch(() => {
          flash('Couldn’t save this piece’s settings')
          queryClient.invalidateQueries({ queryKey: ['practice-settings', pieceId] })
        })
    }
  })
  // Leaving the viewer saves anything still waiting.
  useEffect(() => () => flushPractice.current(), [])
  function setPractice(change: Partial<PracticeSettings>) {
    const next = { ...practice, ...change }
    queryClient.setQueryData(practiceKey, next)
    pendingPractice.current = next
    window.clearTimeout(practiceTimer.current)
    practiceTimer.current = window.setTimeout(() => flushPractice.current(), SAVE_DELAY_MS)
  }
  const photo = practice
  // The stopwatch belongs to the session, so it keeps running across items.
  const { swStart, swAcc, setSwStart, setSwAcc } = session.shared
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(t)
  }, [])
  const readout =
    clockMode === 'stopwatch'
      ? stopwatchText(swAcc + (swStart !== null ? Math.max(0, now - swStart) : 0))
      : (showSeconds ? clockFormatSeconds : clockFormat).format(now)

  const setPhoto = setPractice
  // With Dark Mode Scores on, the page is already inverted, so Invert shows
  // as on and locked, and the user's own invert is set aside (not cleared)
  // until Dark Mode Scores is off again.
  const invertLocked = dark && darkScores
  // The theme's own treatment sits underneath, never shown as a setting: the
  // dark theme's 85% dim, or Dark Mode Scores' invert — then the user's
  // filters on top, so their values stay relative to the theme. On the page
  // and its mat together, so an invert doesn't leave a white frame.
  const scoreFilter =
    [
      dark ? (darkScores ? 'invert(0.95) hue-rotate(180deg)' : 'brightness(0.85)') : '',
      photo.brightness !== 100 ? `brightness(${photo.brightness / 100})` : '',
      photo.contrast !== 100 ? `contrast(${photo.contrast / 100})` : '',
      photo.grayscale ? 'grayscale(1)' : '',
      // A full invert, deliberately unlike Dark Mode Scores' invert(0.95):
      // a light-theme Invert reaches true black, where Dark Mode Scores
      // stops at near-black (#0d0d0d). Matching the two is an open question.
      photo.invert && !invertLocked ? 'invert(1) hue-rotate(180deg)' : '',
    ]
      .filter(Boolean)
      .join(' ') || 'none'
  const photoChanged =
    photo.brightness !== 100 || photo.contrast !== 100 || photo.grayscale || photo.invert

  // Shows a page of this item (a turn, or an undo turning back).
  function showPage(next: number) {
    setPage(next)
    if (pieceId === null) return
    // Pages leaving the preload window unmount; drop their "ready" so one
    // that comes back shows only once it's decoded again.
    const keep = new Set(
      [next - 1, next, next + 1, next + 2].map((p) => getPiecePageUrl(pieceId, p, pageVersion)),
    )
    setReady((r) => Object.fromEntries(Object.entries(r).filter(([url]) => keep.has(url))))
  }

  // Annotate (plan phases 11–18, built from the mockup). The mode, the
  // tools and the undo history belong to the session (useAnnotationSession),
  // so they carry on into the next item. Marks are the account's own, saved
  // a page at a time; hidden colors are kept per piece. A custom setlist
  // entry has nothing to annotate.
  const annot = session.shared.annotations
  const annotating = annot.mode === 'annotate' && !custom
  const { tool, toolStyle, eraserSize, setToolStyle, setEraserSize } = annot
  const eraserRadius = SIZES.eraser[eraserSize] / 200
  const hiddenLayers = LAYER_COLORS.map((_, i) => i).filter((i) => practice.hiddenColors & (1 << i))
  function setHiddenLayers(layers: number[]) {
    setPractice({ hiddenColors: layers.reduce((mask, l) => mask | (1 << l), 0) })
  }
  const ghostsOn = settings?.ghostMarks ?? true
  // The page's look, for the colors: inverted (Dark Mode Scores or the
  // photo panel's Invert), the dark theme's dimmed page, or white.
  const pageLook: PageLook = invertLocked || photo.invert ? 'dark' : dark ? 'dim' : 'light'
  useEffect(() => {
    if (pieceId !== null) annot.load(pieceId)
  }, [pieceId, annot])
  useEffect(() => {
    annot.setNotify(flash)
  })
  const loadedPages = pieceId !== null ? annot.pages[pieceId] : undefined
  // Info's Download PDF + Annotations (title bar, beside Close): the piece's
  // PDF with these marks as real annotations, hidden colors left out. It
  // saves any change still waiting first, so a mark just drawn is in it.
  // Faded, with its reason on a tap, when there's nothing to export;
  // hidden without the download permission.
  const canDownload = hasPermission(useAuth(), 'download')
  const pieceMarks = Object.values(loadedPages ?? {}).flat()
  const exportHidden = pieceMarks.filter((m) => hiddenLayers.includes(m.layer)).length
  const exportShown = pieceMarks.length - exportHidden
  const exportBlocked = !loadedPages
    ? 'Still loading your marks'
    : exportShown > 0
      ? null
      : exportHidden > 0
        ? 'Your marks here are all in hidden colors'
        : 'No annotations on this piece yet'
  async function downloadAnnotated() {
    if (pieceId === null) return
    if (exportBlocked) {
      flash(exportBlocked)
      return
    }
    if (!(await annot.saveNow())) return
    startDownload(withAnnotations(getPieceFileUrl(pieceId)))
    flash(
      exportHidden ? 'Downloading, hidden colors left out' : 'Downloading with your annotations',
    )
  }
  const pageKey = `${pieceId}:${page}`
  const pageMarks = loadedPages?.[page] ?? []
  const marksFor = (key: string) => {
    const [pid, pg] = key.split(':').map(Number)
    return annot.pages[pid]?.[pg] ?? []
  }
  const updateKey = (key: string, change: (marks: Mark[]) => Mark[]) => {
    const [pid, pg] = key.split(':').map(Number)
    annot.update(pid, pg, change)
  }

  function tip(id: string, text: string) {
    if (takeTip(id)) flash(text)
  }
  function enterAnnotate() {
    annot.setMode('annotate')
    annot.setTool(null)
    setMenu(null)
    tip('annotate', 'Annotate: pick a tool to mark; until then taps turn pages')
  }
  function leaveAnnotate() {
    finishText()
    annot.setMode('play')
    annot.setTool(null)
    setMenu(null)
    tip('play', 'Play: taps turn pages')
  }
  // Tapping the picked tool again opens its color and size (the eraser's,
  // its size); tapping it once more, options showing, puts it down, so taps
  // turn pages again.
  function pickTool(key: Tool) {
    if (tool !== key) {
      finishText()
      annot.setTool(key)
      setMenu(null)
      tip(
        `tool-${key}`,
        key === 'text'
          ? 'Text: tap the page to write; tap text to edit it, or drag it to move it'
          : `${TOOLS.find((t) => t.key === key)?.label}: taps mark the page`,
      )
    } else if (menu !== 'tool') {
      setMenu('tool')
    } else {
      finishText()
      annot.setTool(null)
      setMenu(null)
      tip('no-tool', 'No tool: taps turn pages')
    }
  }

  // Marking. Strokes go through perfect-freehand (lib/sheetViewerMarks.ts)
  // with an Apple Pencil's real pressure, or pressure simulated from speed
  // for a finger or mouse. Every point is a share of the page.
  const pageBoxRef = useRef<HTMLDivElement>(null)
  // The page showing's drawing, once it's ready: its shape is the page's.
  const drawingNow = ready[getPiecePageUrl(pieceId ?? 0, page, pageVersion)]
  const pageAspect = drawingNow
    ? Number(drawingNow.dataset.cssWidth) / Number(drawingNow.dataset.cssHeight)
    : 8.5 / 11
  const [live, setLive] = useState<StrokeMark | null>(null)
  const [eraserAt, setEraserAt] = useState<[number, number] | null>(null)
  const marking = useRef<{ id: number; type: string } | null>(null)
  const liveRef = useRef<StrokeMark | null>(null)
  const erasing = useRef<{
    key: string
    before: Mark[]
    removed: Set<string>
    last: [number, number]
    textBoxes: Map<string, PageBox>
  } | null>(null)
  // Marks are only made once the page's saved marks are in, so a load can't
  // replace them.
  function markTool() {
    if (!annotating || pieceId === null || !loadedPages || !drawingNow) return null
    return tool === 'pen' || tool === 'highlighter' || tool === 'eraser' ? tool : null
  }
  function pagePoint(event: { clientX: number; clientY: number }): [number, number] | null {
    const box = pageBoxRef.current?.getBoundingClientRect()
    if (!box?.width) return null
    return [(event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height]
  }
  // A new mark's id: unique on the page, and across devices editing it.
  // getRandomValues, not randomUUID: randomUUID only exists over HTTPS, and
  // Sonneck is usually reached over plain HTTP on the local network.
  function newMarkId() {
    return Array.from(crypto.getRandomValues(new Uint32Array(3)), (n) => n.toString(36)).join('')
  }
  function startMark(event: React.PointerEvent<HTMLDivElement>) {
    const current = marking.current
    if (current && current.id !== event.pointerId) {
      // A palm that landed before the Pencil: drop its mark, take the Pencil.
      // A finger while the Pencil draws: ignored. A second finger: a pinch,
      // so the mark it would have left is dropped.
      if (current.type === 'pen' && event.pointerType !== 'pen') return
      cancelMark()
      if (event.pointerType !== 'pen') return
    }
    if (event.button !== 0) return
    const p = pagePoint(event)
    const t = markTool()
    if (!p || !t) return
    event.currentTarget.setPointerCapture(event.pointerId)
    marking.current = { id: event.pointerId, type: event.pointerType }
    if (t === 'eraser') {
      erasing.current = {
        key: pageKey,
        before: pageMarks,
        removed: new Set(),
        last: p,
        textBoxes: drawnTextBoxes(),
      }
      eraseTo(p)
      return
    }
    const style = toolStyle[t]
    // Drawing in a hidden color shows that layer again.
    if (hiddenLayers.includes(style.color)) {
      setHiddenLayers(hiddenLayers.filter((l) => l !== style.color))
      flash(`${LAYER_COLORS[style.color].name} unhidden`)
    }
    const mark: StrokeMark = {
      id: newMarkId(),
      kind: 'stroke',
      tool: t,
      layer: style.color,
      size: SIZES[t][style.size],
      pressure: event.pointerType === 'pen',
      points: [[p[0], p[1], event.pressure || 0.5]],
    }
    liveRef.current = mark
    setLive(mark)
  }
  function onStagePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (marking.current?.id !== event.pointerId) return
    // A Pencil reports far more often than the screen draws; take every
    // point it sent since the last frame.
    const events = event.nativeEvent.getCoalescedEvents?.() ?? []
    const all = events.length ? events : [event.nativeEvent]
    if (erasing.current) {
      for (const e of all) {
        const p = pagePoint(e)
        if (p) eraseTo(p)
      }
      return
    }
    const mark = liveRef.current
    if (!mark) return
    const added: MarkPoint[] = []
    for (const e of all) {
      const p = pagePoint(e)
      if (p) added.push([p[0], p[1], e.pressure || 0.5])
    }
    const next = { ...mark, points: [...mark.points, ...added] }
    liveRef.current = next
    setLive(next)
  }
  // The eraser removes every visible mark it touches, any color, text too,
  // whole marks only; a hidden color's marks are never erased.
  function eraseTo(p: [number, number]) {
    const e = erasing.current
    if (!e) return
    const from = e.last
    e.last = p
    setEraserAt(p)
    const hit = e.before.filter(
      (m) =>
        !e.removed.has(m.id) &&
        !hiddenLayers.includes(m.layer) &&
        eraserTouches(m, from, p, eraserRadius, pageAspect, e.textBoxes.get(m.id)),
    )
    if (!hit.length) return
    const ids = new Set(hit.map((m) => m.id))
    for (const id of ids) e.removed.add(id)
    updateKey(e.key, (marks) => marks.filter((m) => !ids.has(m.id)))
  }
  function finishMark(event: React.PointerEvent<HTMLDivElement>) {
    if (marking.current?.id !== event.pointerId) return false
    marking.current = null
    const e = erasing.current
    if (e) {
      erasing.current = null
      setEraserAt(null)
      const removed = removedSince(e.before, e.removed)
      if (removed.length) annot.record({ key: e.key, added: [], removed })
      return true
    }
    const mark = liveRef.current
    liveRef.current = null
    setLive(null)
    // A stroke that never touched the page isn't kept.
    if (mark && strokeTouchesPage(mark)) {
      updateKey(pageKey, (marks) => [...marks, mark])
      annot.record({ key: pageKey, added: [mark], removed: [] })
    }
    return true
  }
  function cancelMark() {
    marking.current = null
    liveRef.current = null
    setLive(null)
    const e = erasing.current
    if (e) {
      erasing.current = null
      setEraserAt(null)
      updateKey(e.key, () => e.before)
    }
  }

  // Text marks. One text field stays mounted while the Text tool is picked,
  // so a tap can move it into place and focus it inside the tap itself:
  // iPad Safari raises the keyboard only for a focus made in the user's own
  // gesture. Return starts a new line; a tap anywhere else, another tool or
  // a page turn finishes the box; finished empty, it adds nothing (or
  // removes the mark it edited). Each finished box is one undo step.
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null)
  const [lift, setLift] = useState(0)
  const [textDrag, setTextDrag] = useState<{ id: string; dx: number; dy: number } | null>(null)
  const textFieldRef = useRef<HTMLTextAreaElement>(null)
  const textWrapRef = useRef<HTMLDivElement>(null)
  function openTextBox(edit: TextEdit) {
    const wrap = textWrapRef.current
    const field = textFieldRef.current
    if (!wrap || !field) return
    Object.assign(wrap.style, textBoxStyle(edit), { visibility: 'visible' })
    wrap.dataset.value = edit.text
    field.value = edit.text
    // The page lifts itself clear of the keyboard; Safari mustn't scroll too.
    field.focus({ preventScroll: true })
    const end = edit.text.length
    field.setSelectionRange(end, end)
    // A touch's own click follows the tap into the field just opened and
    // would put the cursor where the finger was: for a moment, put it back
    // at the end. (A deliberate tap in the box later still moves it.)
    const keepEnd = () => field.setSelectionRange(end, end)
    field.addEventListener('click', keepEnd, { once: true })
    window.setTimeout(() => field.removeEventListener('click', keepEnd), 400)
    setTextEdit(edit)
  }
  function startTextBox(p: [number, number]) {
    if (!loadedPages) return
    const style = toolStyle.text
    const size = SIZES.text[style.size]
    // The first line's middle sits on the tap: its baseline 3/8 of a line
    // below it (the line is 1.25 sizes, its baseline 1 size down).
    const em = (size / 100) * pageAspect
    if (hiddenLayers.includes(style.color)) {
      setHiddenLayers(hiddenLayers.filter((l) => l !== style.color))
      flash(`${LAYER_COLORS[style.color].name} unhidden`)
    }
    openTextBox({
      key: pageKey,
      x: Math.min(p[0], 0.9),
      // Its baseline stays on the page, however low the tap.
      y: Math.min(1, p[1] + em * (1 - TEXT_LINE_HEIGHT / 2)),
      layer: style.color,
      size,
      text: '',
      original: null,
    })
  }
  function editText(m: TextMark) {
    finishText()
    openTextBox({ ...m, key: pageKey, original: m })
  }
  // Put a finished box's change in place of the mark it edits (same id, same
  // depth), or add it.
  function placeText(key: string, original: TextMark | null, mark: TextMark | null) {
    const list = marksFor(key)
    const index = original ? list.findIndex((m) => m.id === original.id) : -1
    const removed = original && index >= 0 ? [{ mark: original, index }] : []
    updateKey(key, (prev) => {
      const next = [...prev]
      const at = original ? next.findIndex((m) => m.id === original.id) : -1
      if (at >= 0) {
        if (mark) next[at] = mark
        else next.splice(at, 1)
      } else if (mark) next.push(mark)
      return next
    })
    if (removed.length || mark) annot.record({ key, added: mark ? [mark] : [], removed })
  }
  function finishText() {
    const edit = textEdit
    if (!edit) return
    closeTextBox()
    const text = edit.text.replace(/\s+$/, '')
    const { key, original } = edit
    if (!text.trim()) {
      if (original) placeText(key, original, null)
      return
    }
    if (
      original &&
      text === original.text &&
      edit.layer === original.layer &&
      edit.size === original.size
    )
      return
    if (hiddenLayers.includes(edit.layer)) {
      setHiddenLayers(hiddenLayers.filter((l) => l !== edit.layer))
      flash(`${LAYER_COLORS[edit.layer].name} unhidden`)
    }
    placeText(key, original, {
      id: original?.id ?? newMarkId(),
      kind: 'text',
      layer: edit.layer,
      x: edit.x,
      y: edit.y,
      size: edit.size,
      text,
      italic: original?.italic,
    })
  }
  // Closes the box without keeping what's in it (Undo while typing).
  function closeTextBox() {
    textFieldRef.current?.blur()
    setTextEdit(null)
    setLift(0)
  }
  // A text mark dragged with the Text tool: dx, dy as shares of the page.
  function moveText(m: TextMark, dx: number, dy: number) {
    const em = (m.size / 100) * pageAspect
    placeText(pageKey, m, {
      ...m,
      x: Math.max(0, Math.min(0.95, m.x + dx)),
      y: Math.max(em, Math.min(1, m.y + dy)),
    })
  }
  // Every drawn text mark's box on this page, as shares of the page (text
  // wraps, so its size is only known from the page).
  function drawnTextBoxes() {
    const boxes = new Map<string, PageBox>()
    const box = pageBoxRef.current?.getBoundingClientRect()
    if (!pageBoxRef.current || !box?.width) return boxes
    pageBoxRef.current.querySelectorAll<HTMLElement>('[data-text-mark]').forEach((el) => {
      const r = el.getBoundingClientRect()
      boxes.set(el.dataset.textMark ?? '', {
        left: (r.left - box.left) / box.width,
        right: (r.right - box.left) / box.width,
        top: (r.top - box.top) / box.height,
        bottom: (r.bottom - box.top) / box.height,
      })
    })
    return boxes
  }
  // While a box is open, the page lifts just enough to keep it above the
  // keyboard (the visual viewport's bottom), never past the box's own top,
  // and settles back when it closes.
  useEffect(() => {
    if (!textEdit) return
    function measure() {
      const field = textWrapRef.current
      const page = pageBoxRef.current
      const area = page?.parentElement
      if (!field || !page || !area) return
      const applied = new DOMMatrixReadOnly(getComputedStyle(page).transform).m42
      const r = field.getBoundingClientRect()
      const top = r.top - applied
      const bottom = r.bottom - applied
      const vv = window.visualViewport
      const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight
      const room = Math.max(0, top - area.getBoundingClientRect().top - LIFT_GAP)
      setLift(Math.min(room, Math.max(0, bottom + LIFT_GAP - visibleBottom)))
    }
    const raf = requestAnimationFrame(measure)
    const vv = window.visualViewport
    vv?.addEventListener('resize', measure)
    vv?.addEventListener('scroll', measure)
    return () => {
      cancelAnimationFrame(raf)
      vv?.removeEventListener('resize', measure)
      vv?.removeEventListener('scroll', measure)
    }
  }, [textEdit])

  // Undo and Redo: the whole session's history, marking, erasing and text
  // edits (never hide/show). A change on another page, or another piece in
  // the queue, turns there first, then visibly applies once the page shows
  // (UNDO_TURN_MS) — or after UNDO_WAIT_MS if it never does. Every press
  // shows a pill naming what it did.
  const [awaiting, setAwaiting] = useState<{ key: string; direction: 'undo' | 'redo' } | null>(null)
  const handedOver =
    annot.pending && pieceId !== null && annot.pending.key.startsWith(`${pieceId}:`)
      ? annot.pending
      : null
  const waiting = awaiting ?? handedOver
  useEffect(() => {
    if (!waiting) return
    const shown = waiting.key === pageKey && !!drawingNow
    const t = window.setTimeout(
      () => {
        annot.apply(waiting.direction)
        setAwaiting(null)
        annot.setPending(null)
      },
      shown ? UNDO_TURN_MS : UNDO_WAIT_MS,
    )
    return () => window.clearTimeout(t)
  }, [waiting, pageKey, drawingNow, annot])
  function stepHistory(direction: 'undo' | 'redo') {
    // While typing, Undo drops what's in the box (an edited mark stays as
    // it was); Redo does nothing until the box closes.
    if (textEdit) {
      if (direction === 'undo') {
        closeTextBox()
        flash('Undo: typing')
      }
      return
    }
    if (!annotating || waiting || marking.current) return
    const h = annot.history
    const change = (direction === 'undo' ? h.done : h.undone).at(-1)
    if (!change) return
    const [pid, pg] = change.key.split(':').map(Number)
    const elsewhere = session.items.find((i) => i.kind === 'piece' && i.id === pid)
    const where =
      pid !== pieceId
        ? `, ${elsewhere?.kind === 'piece' ? elsewhere.title : 'another piece'}`
        : pg !== page
          ? `, page ${pg}`
          : ''
    const pillText = `${direction === 'undo' ? 'Undo' : 'Redo'}: ${describeChange(change)}${where}`
    flash(pillText)
    if (pid === pieceId && pg === page) {
      annot.apply(direction)
      return
    }
    if (pid === pieceId) {
      showPage(pg)
      setAwaiting({ key: change.key, direction })
      return
    }
    const index = session.items.findIndex((i) => i.kind === 'piece' && i.id === pid)
    if (index < 0) {
      annot.apply(direction)
      return
    }
    annot.setPending({ key: change.key, direction })
    // The pill goes with it: the next item's viewer shows it on arrival.
    session.goTo(index, pg, pillText)
  }
  const stepHistoryRef = useRef(stepHistory)
  useEffect(() => {
    stepHistoryRef.current = stepHistory
  })

  function toggleLayer(layer: number) {
    setHiddenLayers(
      hiddenLayers.includes(layer)
        ? hiddenLayers.filter((l) => l !== layer)
        : [...hiddenLayers, layer],
    )
  }
  // Tapping a ghost mark unhides its layer, and says so.
  function unhideFromGhost(layer: number) {
    setHiddenLayers(hiddenLayers.filter((l) => l !== layer))
    flash(`${LAYER_COLORS[layer].name} unhidden`)
  }

  const photoAnchorRef = useRef<HTMLDivElement>(null)
  const phoneRow2Ref = useRef<HTMLDivElement>(null)
  const clockAnchorRef = useRef<HTMLDivElement>(null)
  const moreAnchorRef = useRef<HTMLDivElement>(null)
  const infoAnchorRef = useRef<HTMLDivElement>(null)
  const queueAnchorRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  useEffect(
    () => () => {
      window.clearTimeout(closeTimer.current)
      window.clearTimeout(hintTimer.current)
    },
    [],
  )

  function turn(dir: -1 | 1) {
    finishText()
    if (!session.shared.allowTurn(dir, settings?.turnGuardMs ?? TURN_GUARD_DEFAULT)) {
      flash('Double-turn ignored')
      return
    }
    const next = Math.max(1, Math.min(pageCount, page + dir))
    if (next === page) {
      // In a queue, turning past an item's end goes on to the next item;
      // back from its start, to the previous one's last page.
      const neighbor = session.index >= 0 ? session.items[session.index + dir] : undefined
      if (neighbor) {
        const name = neighbor.kind === 'piece' ? neighbor.title : neighbor.name
        session.goTo(
          session.index + dir,
          dir > 0 ? 'first' : 'last',
          `${dir > 0 ? 'Next' : 'Previous'}: ${name}`,
        )
        return
      }
      flash(
        dir < 0
          ? 'First page'
          : session.kind === 'piece'
            ? 'Last page'
            : session.kind === 'list'
              ? 'End of the list'
              : 'End of the setlist',
      )
      return
    }
    showPage(next)
  }
  const turnRef = useRef(turn)
  useEffect(() => {
    turnRef.current = turn
  })

  // The pedal keys. Space/Enter would also press whichever toolbar button
  // last took focus, so the viewer claims them (capture phase).
  const menuOpen = menu !== null
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Typing in a field (a text mark, the notes): its own keys, ⌘Z too.
      const target = event.target as Element | null
      if (target?.closest('input, textarea, select, [role="listbox"]')) return
      // ⌘Z / ⇧⌘Z (Ctrl elsewhere), with a keyboard attached.
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (!event.repeat) stepHistoryRef.current(event.shiftKey ? 'redo' : 'undo')
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'Escape') {
        setMenu(null)
        return
      }
      if (menuOpen) return
      if (BACK_KEYS.includes(event.key)) {
        event.preventDefault()
        if (!event.repeat) turnRef.current(-1)
      } else if (FORWARD_KEYS.includes(event.key)) {
        event.preventDefault()
        if (!event.repeat) turnRef.current(1)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [menuOpen])

  // The score area's size, for drawing each page at screen size. Measured
  // whole pixels, so a redraw only follows a real change (rotation, the edge
  // margin).
  const [stageBox, setStageBox] = useState<{ w: number; h: number } | null>(null)
  function measureStage(el: HTMLDivElement | null) {
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width)
      const h = Math.round(entry.contentRect.height)
      setStageBox((box) => (box && box.w === w && box.h === h ? box : { w, h }))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }

  // The preload window: the page showing, the two after it and the one
  // before stay drawn, off screen, so a turn just copies the next one onto
  // the screen (ShownPage). Pages further away are let go (decoding is what
  // a turn would otherwise cost).
  const windowPages = [page - 1, page, page + 1, page + 2].filter((p) => p >= 1 && p <= pageCount)
  const pageUrl = (p: number) => getPiecePageUrl(pieceId ?? 0, p, pageVersion)
  const currentUrl = pageUrl(page)
  const currentReady = !!ready[currentUrl]
  const currentFailed = !!failed[currentUrl]
  const [slowUrl, setSlowUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!pageVersion || currentReady) return
    const t = window.setTimeout(() => setSlowUrl(currentUrl), SLOW_PAGE_MS)
    return () => window.clearTimeout(t)
  }, [currentUrl, currentReady, pageVersion])

  function pressClose() {
    finishText()
    window.clearTimeout(closeTimer.current)
    if (closeArmed) {
      setCloseArmed(false)
      exit()
      return
    }
    setCloseArmed(true)
    closeTimer.current = window.setTimeout(() => setCloseArmed(false), CLOSE_CONFIRM_MS)
  }
  // Back where the viewer was opened from; a viewer opened straight from an
  // address goes to the piece (or the setlist, or home for the list).
  function exit() {
    if ((window.history.state as { idx?: number } | null)?.idx) navigate(-1)
    else navigate(session.exitTo, { replace: true })
  }

  // One finger on the score: a tap turns by where it lands, a swipe by which
  // way it goes (lib/sheetViewerGestures.ts). A second finger (a pinch)
  // cancels it.
  const down = useRef<StagePoint | null>(null)
  const fingers = useRef(new Set<number>())
  function onStagePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // A tap anywhere while a text box is open finishes it, and only that.
    if (textEdit) {
      finishText()
      down.current = null
      return
    }
    // Pen, highlighter or eraser picked: the pointer marks the page, zoomed
    // in or not (two fingers still pinch and pan).
    if (markTool()) {
      startMark(event)
      return
    }
    // Zoomed in, a drag pans the page; leave it to the browser.
    if (zoomed) return
    fingers.current.add(event.pointerId)
    // Its lift always reaches the score, even over the toolbar, so a
    // finger is never left counted as down.
    event.currentTarget.setPointerCapture(event.pointerId)
    if (fingers.current.size > 1) down.current = null
    else if (event.button === 0)
      down.current = { x: event.clientX, y: event.clientY, t: event.timeStamp }
  }
  function onStagePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (finishMark(event)) return
    fingers.current.delete(event.pointerId)
    const start = down.current
    down.current = null
    if (!start) return
    if (annotating && tool) {
      // The Text tool: a tap on the page opens a text box there.
      if (tool === 'text') {
        const p = pagePoint({ clientX: start.x, clientY: start.y })
        const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y)
        if (p && moved < 10 && p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1) startTextBox(p)
      }
      return
    }
    const end = { x: event.clientX, y: event.clientY, t: event.timeStamp }
    const dir = stageTurn(start, end, event.currentTarget.getBoundingClientRect())
    if (dir) turn(dir)
  }
  function onStagePointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    if (marking.current?.id === event.pointerId) cancelMark()
    fingers.current.delete(event.pointerId)
    down.current = null
  }

  // Exit: the back arrow — the app's "go back", which is where exiting takes
  // you. Two taps, the first arming it for 3 seconds. A fixed width (picked
  // from a side-by-side, https://claude.ai/artifact/AGotxhczR6JhLquY1YMJBB):
  // the arrow and the armed "Exit?" share one grid cell, so the face is
  // always as wide as "Exit?" and the toolbar never shifts when it's tapped.
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
        className="z-50 w-72 rounded-xl border border-border bg-paper px-3 pt-3 pb-2 font-sans text-ink shadow-xl select-none [--sv-hover:var(--color-paper-hover)]"
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
              <span className={`${FACE} ${FACE_HOVER} w-full justify-start gap-2.5 px-3`}>
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
              <span className={`${FACE} ${FACE_HOVER} w-full justify-start gap-2.5 px-3`}>
                <IconRefresh size={20} />
                Reset
              </span>
            </button>
          </div>
        )}
        {/* Clock mode only: the stopwatch always shows seconds. */}
        {clockMode === 'clock' && (
          <SwitchRow label="Show seconds" checked={showSeconds} onChange={setShowSeconds} />
        )}
        <button
          type="button"
          data-hit
          className={`${HIT} w-full group/b`}
          onClick={() => setClockOn(!clockOn)}
        >
          <span className={`${FACE} ${FACE_HOVER} w-full justify-start gap-2.5 px-3`}>
            {clockMode === 'stopwatch' ? <IconStopwatch size={20} /> : <IconClock size={20} />}
            {clockOn ? 'Hide' : 'Show'} {clockMode === 'stopwatch' ? 'stopwatch' : 'clock'}
          </span>
        </button>
      </div>,
      document.body,
    )

  // Wide screens show the extras and the photo button inline; elsewhere
  // they're in ⋯.
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
        className="z-50 rounded-xl border border-border bg-paper px-3 pt-3 pb-2 font-sans text-ink shadow-xl select-none [--sv-hover:var(--color-paper-hover)]"
      >
        <StepperRow
          label="Brightness"
          Icon={IconSun}
          value={photo.brightness}
          onChange={(v) => setPhoto({ brightness: v })}
        />
        <StepperRow
          label="Contrast"
          Icon={IconContrast}
          value={photo.contrast}
          onChange={(v) => setPhoto({ contrast: v })}
        />
        <SwitchRow
          label="Grayscale"
          checked={photo.grayscale}
          onChange={(v) => setPhoto({ grayscale: v })}
        />
        <SwitchRow
          label="Invert"
          checked={invertLocked ? true : photo.invert}
          onChange={(v) => setPhoto({ invert: v })}
          disabled={invertLocked}
        />
        {invertLocked && (
          <p className="-mt-1 pr-3 pb-1 pl-[42px] text-xs text-ink-muted">
            Dark Mode Scores already inverts the pages.
          </p>
        )}
        <SwitchRow
          label="Edge margin"
          checked={photo.edgeMargin}
          onChange={(v) => setPhoto({ edgeMargin: v })}
        />
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

  const credit = piece
    ? [
        ...piece.composer.values.map((p) => p.name),
        ...piece.arranger.values.map((p) => `arr. ${p.name}`),
      ].join(', ')
    : ''
  // A custom setlist entry shows its name in italics (as the setlist's
  // program does) and its role.
  const subtitle = custom ? custom.role : credit
  const titleBlock = (
    <div className="flex min-w-0 flex-1 flex-col px-2">
      <span className={`truncate font-display font-medium ${custom ? 'italic' : ''}`}>
        {custom ? custom.name : item ? (piece?.title ?? 'Loading…') : session.title}
      </span>
      {subtitle && <span className="truncate text-xs text-ink-soft">{subtitle}</span>}
    </div>
  )

  // Info: your notes (edited in place), your practice status and the
  // piece's details — a card under the Info button on tablets and desktop,
  // a bottom sheet on phones. It shares the menus' backdrop, so a tap on the
  // score closes it first rather than turning the page.
  const notes = piece?.userNotes ?? ''
  const infoOpen = menu === 'info'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [sheetFull, setSheetFull] = useState(false)
  const [hoveredStatus, setHoveredStatus] = useState<string | null>(null)
  const { data: practiceStatuses = [] } = useQuery({
    queryKey: ['practice-statuses'],
    queryFn: listPracticeStatuses,
  })
  const notesMutation = useMutation({
    mutationFn: (next: string) => setPieceUserNotes(pieceId as number, next || null),
    onSuccess: (updated) => {
      queryClient.setQueryData(['piece', pieceId], updated)
      setEditing(false)
    },
    onError: () => flash('Couldn’t save your notes'),
  })
  const statusMutation = useMutation({
    mutationFn: (status: string | null) => setPiecePracticeStatus(pieceId as number, status),
    onSuccess: (updated) => {
      queryClient.setQueryData(['piece', pieceId], updated)
      queryClient.invalidateQueries({ queryKey: ['pieces'] })
      queryClient.invalidateQueries({ queryKey: ['pieceFacets'] })
    },
    onError: () => flash('Couldn’t save the practice status'),
  })
  // Shown at once while it saves, then the saved piece's.
  const status = statusMutation.isPending
    ? (statusMutation.variables ?? null)
    : (piece?.practiceStatus ?? null)

  function openInfo(open: boolean) {
    setMenu(open ? 'info' : null)
    setSheetFull(false)
  }
  function startEdit() {
    setDraft(notes)
    setEditing(true)
  }
  // Hidden while any menu or Info is open, so nothing stacks over it.
  const showBar = !custom && notes !== '' && notesBarShown && menu === null

  // A dot on Info whenever the piece has notes and Info is closed.
  const infoButton = (
    <div ref={infoAnchorRef} className="relative">
      <HitButton
        label="Info"
        onClick={() => openInfo(!infoOpen)}
        // Annotate's toolbar is already the tint Play uses for "open", so
        // there an open Info takes a picked tool's look.
        faceClassName={
          infoOpen ? (annotating ? 'bg-accent-fill text-white' : 'bg-accent-soft text-accent') : ''
        }
      >
        <IconInfoCircle size={22} />
      </HitButton>
      {notes && !infoOpen && (
        <span className="pointer-events-none absolute top-[11px] right-[11px] size-[9px] rounded-full bg-accent-fill ring-2 ring-paper" />
      )}
    </div>
  )

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
            labels do and the pencil's face lines up with the content edge. */}
        <div className="flex min-h-8 items-center">
          <h3 className={sectionLabel}>Your notes</h3>
          <span className="flex-1" />
          {notes && !editing && (
            <div className="-my-2 -mr-1">
              <HitButton label="Edit your notes" onClick={startEdit}>
                <IconPencil size={20} />
              </HitButton>
            </div>
          )}
        </div>
        {editing ? (
          <>
            {/* The Markdown hint sits in the box's bottom corner, in its own
                strip under the text (MarkdownHint), so text never runs
                beneath it. The box keeps its accent edge and no focus ring. */}
            <MarkdownHint
              boxClassName="rounded-xl border border-accent bg-paper-raised focus-within:outline-none"
              hintClassName="px-4 pb-2.5"
            >
              <textarea
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                aria-label="Your notes"
                className="block min-h-40 w-full resize-y bg-transparent px-4 pt-3 pb-1 text-base leading-relaxed text-ink outline-none select-text focus-visible:outline-none"
              />
            </MarkdownHint>
            {/* The buttons sit 4px inside their tap areas, so their faces keep
                8px apart; the row reaches 4px past the box so Done still
                lines up with its edge. */}
            <div className="-mr-1 flex items-center justify-end">
              <HitButton
                label="Cancel"
                inset
                onClick={() => setEditing(false)}
                faceClassName="border border-border bg-paper-raised px-3 font-medium hover:border-accent"
              >
                Cancel
              </HitButton>
              <HitButton
                label="Done"
                inset
                onClick={() => notesMutation.mutate(draft.trim())}
                disabled={notesMutation.isPending}
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
            {/* The switch row: the label lined up with the notes' text (the
                card's 1px border + 16px padding), the switch at the card's
                right edge. */}
            <div
              data-hit
              className={`${HIT} -mx-2 -mt-1 -mb-2`}
              onClick={(event) => {
                if (event.target === event.currentTarget)
                  setPractice({ notesBarShown: !notesBarShown })
              }}
            >
              <Toggle
                row
                checked={notesBarShown}
                onChange={(v) => setPractice({ notesBarShown: v })}
                label="Show practice notes as banner"
                className="h-10 w-full rounded-[10px] pr-2 pl-[25px] hover:bg-(--sv-hover)"
              />
            </div>
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
      {/* The piece menu's practice status strip at 48pt: your own statuses
          in practice order (one with no icon shows its initial), the
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
                onClick={() => statusMutation.mutate(isCurrent ? null : item.name)}
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

  const infoStyle = useAnchoredPanel(infoAnchorRef, infoOpen && tier !== 'phone', 'below-center', {
    gap: 6,
    panelWidth: INFO_WIDTH,
  })
  const infoHeader = (title: ReactNode) => (
    <div className="flex shrink-0 items-center border-b border-border pr-4">
      {title}
      {piece && canDownload && (
        <HitButton
          label={
            exportBlocked
              ? `Download PDF + Annotations (${exportBlocked.toLowerCase()})`
              : 'Download PDF + Annotations'
          }
          onClick={downloadAnnotated}
          faceClassName={exportBlocked ? 'opacity-50' : ''}
        >
          <IconDownload size={20} />
        </HitButton>
      )}
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
            className={`fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl border-t border-border bg-paper pb-[env(safe-area-inset-bottom)] font-sans text-ink shadow-2xl select-none [--sv-hover:var(--color-paper-hover)] ${
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
            className="z-50 flex max-h-[calc(100dvh-5.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-paper font-sans text-ink shadow-xl select-none [--sv-hover:var(--color-paper-hover)]"
          >
            {infoHeader(<h2 className="flex-1 pl-5 font-display text-base font-medium">Info</h2>)}
            <div className="min-h-0 overflow-y-auto overscroll-contain">{infoBody}</div>
          </div>,
          document.body,
        ))
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
  // From 720px (every iPad, portrait included) the tools share the one
  // toolbar row: the tools left of the page cyclers, Layers, Undo and Redo
  // beside Done on the right. Narrower, they take a second row.
  const toolsInline = width >= TOOLS_INLINE_MIN_WIDTH
  // Undo and Redo fade (disabled) when there's nothing to undo or redo.
  const undoRedo = (
    <>
      <HitButton
        label="Undo"
        onClick={() => stepHistory('undo')}
        disabled={!annot.history.done.length && !textEdit}
      >
        <IconArrowBackUp size={22} />
      </HitButton>
      <HitButton
        label="Redo"
        onClick={() => stepHistory('redo')}
        disabled={!annot.history.undone.length}
      >
        <IconArrowForwardUp size={22} />
      </HitButton>
    </>
  )
  const layersAnchorRef = useRef<HTMLDivElement>(null)
  const toolAnchorRef = useRef<HTMLDivElement>(null)
  const layersStyle = useAnchoredPanel(layersAnchorRef, menu === 'layers', 'below-center', {
    gap: 6,
    panelWidth: 232,
  })
  // The Layers menu: no color names — each row is the color, its marks on
  // this page and its eye (the name stays as the row's label for screen
  // readers). A hidden color shows as a crossed-out circle in its color.
  const layersPanel =
    menu === 'layers' &&
    layersStyle &&
    createPortal(
      <div
        style={{ ...layersStyle, width: 232 }}
        className="z-50 rounded-xl border border-border bg-paper px-3 pt-3 pb-2 font-sans text-ink shadow-xl select-none [--sv-hover:var(--color-paper-hover)]"
      >
        <p className="px-1 pb-1 text-xs font-semibold tracking-wider text-ink-muted uppercase">
          Layers
        </p>
        {LAYER_COLORS.map((c, i) => {
          const hidden = hiddenLayers.includes(i)
          const n = pageMarks.filter((m) => m.layer === i).length
          return (
            <div key={c.name} aria-label={c.name} className="flex h-12 items-center pl-2.5">
              <span className="flex size-6 items-center justify-center">
                <ColorDot layer={i} hidden={hidden} look={pageLook} />
              </span>
              <span className="flex-1 pl-3 text-sm text-ink-muted tabular-nums">
                {n} {n === 1 ? 'mark' : 'marks'}
              </span>
              <HitButton
                label={hidden ? `Show ${c.name}` : `Hide ${c.name}`}
                onClick={() => toggleLayer(i)}
                faceClassName={`${FACE_HOVER} ${hidden ? 'text-ink-faint' : ''}`}
              >
                {hidden ? <IconEyeOff size={22} /> : <IconEye size={22} />}
              </HitButton>
            </div>
          )
        })}
      </div>,
      document.body,
    )
  const layersButton = (
    <div ref={layersAnchorRef} className="relative">
      <HitButton
        label="Layers"
        onClick={() => setMenu(menu === 'layers' ? null : 'layers')}
        faceClassName={menu === 'layers' ? 'bg-accent-fill text-white' : ''}
      >
        <IconStack2 size={22} />
      </HitButton>
    </div>
  )
  // The picked tool's options: its six colors and S / M / L (the eraser:
  // just S / M / L). Picking a hidden color is allowed — it shows again as
  // soon as you mark with it. An open text box takes either change too.
  const optionsStyle = tool
    ? tool === 'eraser'
      ? { color: null, size: eraserSize }
      : toolStyle[tool]
    : null
  function setOptionsSize(size: Size) {
    if (tool === 'eraser') setEraserSize(size)
    else if (tool) setToolStyle({ ...toolStyle, [tool]: { ...toolStyle[tool], size } })
    if (tool === 'text' && textEdit) setTextEdit({ ...textEdit, size: SIZES.text[size] })
  }
  function setOptionsColor(color: number) {
    if (!tool || tool === 'eraser') return
    setToolStyle({ ...toolStyle, [tool]: { ...toolStyle[tool], color } })
    if (tool === 'text' && textEdit) setTextEdit({ ...textEdit, layer: color })
  }
  const toolOptionsStyle = useAnchoredPanel(toolAnchorRef, menu === 'tool', 'below-center', {
    gap: 6,
    panelWidth: 312,
  })
  const toolOptionsPanel =
    menu === 'tool' &&
    tool &&
    optionsStyle &&
    toolOptionsStyle &&
    createPortal(
      <div
        style={{ ...toolOptionsStyle, width: 312 }}
        // Picking a color or size keeps the text box's keyboard up.
        onMouseDown={(event) => textEdit && event.preventDefault()}
        className="z-50 rounded-xl border border-border bg-paper px-3 pt-3 pb-3 font-sans text-ink shadow-xl select-none [--sv-hover:var(--color-paper-hover)]"
      >
        {tool !== 'eraser' && (
          <>
            <p className="px-1 pb-1 text-xs font-semibold tracking-wider text-ink-muted uppercase">
              {TOOLS.find((t) => t.key === tool)?.label} color
            </p>
            <div className="flex">
              {LAYER_COLORS.map((c, i) => (
                <HitButton
                  key={c.name}
                  label={`${c.name}${hiddenLayers.includes(i) ? ' (hidden)' : ''}`}
                  onClick={() => setOptionsColor(i)}
                  faceClassName={FACE_HOVER}
                >
                  <ColorDot
                    layer={i}
                    hidden={hiddenLayers.includes(i)}
                    picked={optionsStyle.color === i}
                    look={pageLook}
                  />
                </HitButton>
              ))}
            </div>
          </>
        )}
        <p
          className={`px-1 pb-1 text-xs font-semibold tracking-wider text-ink-muted uppercase ${tool === 'eraser' ? '' : 'pt-2'}`}
        >
          {tool === 'eraser' ? 'Eraser size' : 'Size'}
        </p>
        <div className="flex rounded-[13px] bg-paper-sunken px-1">
          {(['S', 'M', 'L'] as const).map((sz) => (
            <button
              key={sz}
              type="button"
              data-hit
              aria-label={{ S: 'Small', M: 'Medium', L: 'Large' }[sz]}
              onClick={() => setOptionsSize(sz)}
              className={`${HIT} flex-1 group/b`}
            >
              <span
                className={`${FACE} w-full font-medium ${
                  optionsStyle.size === sz
                    ? 'bg-paper-raised shadow-sm'
                    : `text-ink-soft ${FACE_HOVER}`
                }`}
              >
                {sz}
              </span>
            </button>
          ))}
        </div>
      </div>,
      document.body,
    )
  const toolButtons = (
    <>
      {TOOLS.map(({ key, label, Icon }) => {
        const picked = tool === key
        // Pen, highlighter and text carry a bar of their own color under
        // the icon; the eraser has none.
        const own = key !== 'eraser' ? toolStyle[key] : null
        return (
          <div
            key={key}
            ref={picked ? toolAnchorRef : undefined}
            onMouseDown={(event) => key === 'text' && textEdit && event.preventDefault()}
            className="relative"
          >
            <HitButton
              label={picked ? `${label}: ${key === 'eraser' ? 'size' : 'color and size'}` : label}
              onClick={() => pickTool(key)}
              faceClassName={picked ? 'bg-accent-fill text-white' : ''}
            >
              <Icon size={22} />
              {own && (
                <span
                  className="pointer-events-none absolute bottom-[9px] left-1/2 h-[3px] w-3.5 -translate-x-1/2 rounded-full"
                  style={{
                    background: layerColor(own.color, pageLook),
                    boxShadow: picked ? '0 0 0 1.5px white' : undefined,
                  }}
                />
              )}
            </HitButton>
          </div>
        )
      })}
      <span className="mx-1 h-7 w-px shrink-0 bg-accent/30" />
      {!toolsInline && layersButton}
      {!toolsInline && undoRedo}
    </>
  )
  const [turnDebug] = useState(() => new URLSearchParams(window.location.search))
  useEffect(() => {
    if (!turnDebug.has('turntime')) return
    const mark = (event: Event) => {
      lastInputAt = event.timeStamp
    }
    window.addEventListener('pointerup', mark, true)
    window.addEventListener('keydown', mark, true)
    return () => {
      window.removeEventListener('pointerup', mark, true)
      window.removeEventListener('keydown', mark, true)
    }
  }, [turnDebug])
  const drawingTool = markTool() !== null
  // The stage's inset from the screen's edges: the edge margin, else just
  // the home indicator. The marks layer takes the same, so it lines up.
  const stageInset = photo.edgeMargin
    ? 'p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]'
    : 'pb-[env(safe-area-inset-bottom)]'
  // Text marks take the pointer (tap to edit, drag to move) with the Text
  // tool picked, once the page's marks are in.
  const textTool = annotating && tool === 'text' && !!loadedPages
  const moreButton = (
    <div ref={moreAnchorRef} className="relative">
      <HitButton label="More" onClick={() => setMenu(menu === 'more' ? null : 'more')}>
        <IconDots size={22} />
      </HitButton>
    </div>
  )

  // Practiced today (Track practice on, User Settings): time on a piece
  // adds up while it shows, across visits in the session; once its last
  // page has been reached too, it's marked — unless it already has a mark
  // for today, practiced or explicitly unmarked. A setlist session records
  // it too, just without showing marks.
  const day = useToday()
  const tracking = settings?.trackPractice !== false
  const { data: practicedToday } = useQuery({
    queryKey: ['practiced', pieceId, day],
    queryFn: () => getPracticed(pieceId as number, day),
    enabled: pieceId !== null && tracking,
  })
  const trackState = useRef({ marked: false, ready: false, since: 0 })
  useEffect(() => {
    trackState.current.ready = tracking && practicedToday !== undefined
    if (practicedToday?.practiced != null) trackState.current.marked = true
  })
  useEffect(() => {
    if (pieceId === null) return
    const { spentOn, addSpent } = session.shared
    const state = trackState.current
    state.since = Date.now()
    const t = window.setInterval(() => {
      if (!state.ready || state.marked) return
      if (spentOn(pieceId) + Date.now() - state.since < PRACTICED_MS) return
      state.marked = true
      queryClient.setQueryData<PracticedState>(['practiced', pieceId, day], {
        practiced: true,
        lastPracticed: day,
      })
      queryClient.setQueryData<PracticeListEntry[]>(['practice-list', day], (old) =>
        old?.map((e) => (e.piece.id === pieceId ? { ...e, practiced: true } : e)),
      )
      setPracticed(pieceId, day, true).catch(() => {
        state.marked = false
        queryClient.invalidateQueries({ queryKey: ['practiced', pieceId] })
      })
    }, 1000)
    return () => {
      window.clearInterval(t)
      addSpent(pieceId, Date.now() - state.since)
    }
  }, [pieceId, day, queryClient, session.shared])

  // The next piece in the queue loads ahead from this piece's last pages,
  // so moving on to it shows its first page at once.
  const nextItem = session.index >= 0 ? session.items[session.index + 1] : undefined
  const nextPieceId = nextItem?.kind === 'piece' ? nextItem.id : null
  const nearEnd = item !== null && page >= pageCount - 1
  useEffect(() => {
    if (!nearEnd || nextPieceId === null || !config) return
    preparePiecePages(nextPieceId).catch(() => {})
    queryClient
      .fetchQuery({ queryKey: ['piece', nextPieceId], queryFn: () => getPiece(nextPieceId) })
      .then((next) => {
        new Image().src = getPiecePageUrl(
          nextPieceId,
          1,
          `${next.fileHash.slice(0, 16)}.${config.pagesVersion}`,
        )
      })
      .catch(() => {})
  }, [nearEnd, nextPieceId, config, queryClient])

  // The queue: a card under its button (a bottom sheet on phones), like
  // Info. The Practice List can be reordered and trimmed here; a setlist's
  // queue is jump-only (its order is the real program, edited on Setlist
  // Details). Marks show in the Practice List only, with tracking on.
  const editableQueue = session.kind === 'list'
  const showMarks = tracking && session.kind === 'list'
  const marks = session.marks ?? {}
  // While dragging, the order shown; saved whole on the drop.
  const [dragOrder, setDragOrder] = useState<number[] | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragGhost, setDragGhost] = useState<{
    x: number
    y: number
    dx: number
    dy: number
    width: number
  } | null>(null)
  const queueItems: QueueItem[] = dragOrder
    ? dragOrder.flatMap((id) => session.items.filter((q) => q.kind === 'piece' && q.id === id))
    : session.items
  const queueList = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (dragIndex === null) return
    document.body.style.cursor = 'grabbing'
    return () => {
      document.body.style.cursor = ''
    }
  }, [dragIndex])
  function endDrag() {
    if (dragOrder) session.onReorder?.(dragOrder)
    setDragOrder(null)
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
    const next = queueItems.flatMap((q) => (q.kind === 'piece' ? [q.id] : []))
    const [moved] = next.splice(dragIndex, 1)
    next.splice(target, 0, moved)
    setDragOrder(next)
    setDragIndex(target)
  }
  function jump(i: number) {
    setMenu(null)
    if (i !== session.index) session.goTo(i, 'first')
  }
  const queuePieceIds = session.items.flatMap((q) => (q.kind === 'piece' ? [q.id] : []))
  const practicedCount = queuePieceIds.filter((id) => marks[id] === true).length
  const queueSub =
    session.kind === 'setlist'
      ? 'Setlist, in its order for this session'
      : showMarks
        ? `${practicedCount} of ${session.items.length} practiced today`
        : `${session.items.length} ${session.items.length === 1 ? 'piece' : 'pieces'}`
  const queueBody =
    session.items.length === 0 ? (
      <p className="px-5 pt-3 pb-5 text-sm text-ink-muted italic">
        {session.kind === 'list'
          ? 'Your Practice List is empty. Add pieces from a piece’s Play button: Add to Practice List.'
          : 'This setlist has nothing in it yet.'}
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
        {queueItems.map((q, i) => {
          const current = q.key === item?.key
          const index = session.items.indexOf(q)
          if (q.kind === 'custom')
            return (
              <li
                key={q.key}
                data-row
                className={`flex items-center rounded-[10px] ${current ? 'bg-accent-soft [--sv-hover:var(--color-accent-soft-hover)]' : ''}`}
              >
                <button
                  type="button"
                  data-hit
                  onClick={() => jump(index)}
                  className={`${HIT} min-w-0 flex-1 justify-start group/b`}
                >
                  <span className={`${FACE} ${FACE_HOVER} h-11 w-full justify-start px-2`}>
                    <span className="flex min-w-0 -translate-y-[0.5px] flex-col text-left">
                      <span className="truncate font-display font-medium italic">{q.name}</span>
                      <span className="truncate text-xs text-ink-soft">
                        {current ? 'Now open' : q.role}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            )
          const mark = marks[q.id]
          const done = mark === true
          // Unmarked today: the automatic rule leaves it alone until tomorrow.
          const unmarked = mark === false
          return (
            <li
              key={q.key}
              data-row
              className={`flex items-center rounded-[10px] ${current ? 'bg-accent-soft [--sv-hover:var(--color-accent-soft-hover)]' : ''} ${dragIndex === i ? 'opacity-40' : ''}`}
            >
              {editableQueue && (
                <span
                  data-hit
                  aria-label={`Drag to reorder ${q.title}`}
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
                onClick={() => jump(index)}
                className={`${HIT} min-w-0 flex-1 justify-start group/b`}
              >
                {/* The same hover fill as the row's other buttons, 44px in
                    the 48pt row. The text sits half a pixel high: measured
                    by its ink, the title's leading otherwise leaves the top
                    ~1px roomier. */}
                <span className={`${FACE} ${FACE_HOVER} h-11 w-full justify-start px-2`}>
                  <span className="flex min-w-0 -translate-y-[0.5px] flex-col text-left">
                    <span className="truncate font-display font-medium">{q.title}</span>
                    <span className="truncate text-xs text-ink-soft">
                      {current ? 'Now open' : q.credit || `${q.pageCount} pp.`}
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
                  onClick={() => session.onMark?.(q.id, !done)}
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
                  label={`Remove ${q.title} from the Practice List`}
                  onClick={() => session.onRemove?.(q.id)}
                >
                  <IconX size={18} />
                </HitButton>
              )}
            </li>
          )
        })}
      </ul>
    )
  const queueStyle = useAnchoredPanel(
    queueAnchorRef,
    menu === 'queue' && tier !== 'phone',
    'below-center',
    { gap: 6, panelWidth: QUEUE_WIDTH },
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
      <span className="truncate font-display text-base font-medium">{session.title}</span>
      {session.items.length > 0 && (
        <span className="truncate text-xs text-ink-soft">{queueSub}</span>
      )}
    </span>
  )
  const dragged = dragIndex !== null ? queueItems[dragIndex] : undefined
  const ghostCard =
    dragGhost &&
    dragged?.kind === 'piece' &&
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
          <span className="truncate text-xs text-ink-soft">{dragged.credit}</span>
        </span>
      </div>,
      document.body,
    )
  const queuePanel =
    menu === 'queue' &&
    (tier === 'phone'
      ? createPortal(
          <div
            className={`fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl border-t border-border bg-paper pb-[env(safe-area-inset-bottom)] font-sans text-ink shadow-2xl select-none [--sv-hover:var(--color-paper-hover)] ${
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
            {ghostCard}
          </div>,
          document.body,
        )
      : queueStyle &&
        createPortal(
          <div
            style={{ ...queueStyle, width: QUEUE_WIDTH }}
            className="z-50 flex max-h-[calc(100dvh-5.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-paper font-sans text-ink shadow-xl select-none [--sv-hover:var(--color-paper-hover)]"
          >
            {queueHeader(
              <div className="flex min-h-12 min-w-0 flex-1 items-center pl-5">
                {queueTitleBlock}
              </div>,
            )}
            <div className="min-h-0 overflow-y-auto overscroll-contain">{queueBody}</div>
            {ghostCard}
          </div>,
          document.body,
        ))
  // Only in a queue: the Practice List's playlist, a setlist's numbered list.
  const queueButton = session.kind !== 'piece' && !annotating && (
    <div ref={queueAnchorRef} className="relative">
      <HitButton
        label={session.kind === 'setlist' ? 'Setlist queue' : 'Practice List'}
        onClick={() => {
          setMenu(menu === 'queue' ? null : 'queue')
          setSheetFull(false)
        }}
        faceClassName={menu === 'queue' ? 'bg-accent-soft text-accent' : ''}
      >
        {session.kind === 'setlist' ? <IconListNumbers size={22} /> : <IconPlaylist size={22} />}
      </HitButton>
    </div>
  )

  const cyclers = (
    <div className="flex items-center">
      <HitButton
        label="Previous page"
        onClick={() => turn(-1)}
        disabled={!item || (page <= 1 && !(session.index > 0))}
      >
        <IconChevronLeft size={22} />
      </HitButton>
      <span className="w-[4.5em] text-center text-sm text-ink-soft tabular-nums">
        {item ? `${page} / ${pageCount}` : ''}
      </span>
      <HitButton
        label="Next page"
        onClick={() => turn(1)}
        disabled={
          !item ||
          (page >= pageCount && !(session.index >= 0 && session.index < session.items.length - 1))
        }
      >
        <IconChevronRight size={22} />
      </HitButton>
    </div>
  )

  let stage: ReactNode
  // The marks, in their own layer over the page (outside the filtered
  // stage, so an invert never recolors them), kept on the page's exact box
  // by ShownPage.
  let marksLayer: ReactNode = null
  if (!item) {
    // An empty Practice List explains itself in its queue, open from the
    // start; the page stays blank.
    stage =
      session.kind === 'setlist' ? (
        <StageMessage>
          <p>This setlist has nothing in it yet.</p>
        </StageMessage>
      ) : null
  } else if (custom) {
    stage = (
      <div
        className="flex h-full w-full items-center justify-center"
        style={{ containerType: 'size' }}
      >
        <PlaceholderPage entry={custom} />
      </div>
    )
  } else if (pieceError) {
    const missing = pieceError instanceof ApiError && pieceError.status === 404
    stage = (
      <StageMessage>
        <p>{missing ? 'That piece isn’t in the library.' : 'This piece couldn’t be opened.'}</p>
        {!missing && <RetryButton onClick={() => refetchPiece()} />}
      </StageMessage>
    )
  } else if (pageVersion) {
    if (ready[currentUrl] && !currentFailed && !turnDebug.has('nomarks'))
      marksLayer = (
        <div
          ref={pageBoxRef}
          className="absolute transition-transform duration-200 ease-out motion-reduce:transition-none"
          style={{ transform: lift ? `translateY(${-lift}px)` : undefined }}
        >
          <PageMarks
            marks={pageMarks}
            live={live}
            eraserAt={eraserAt}
            eraserRadius={eraserRadius}
            hidden={hiddenLayers}
            ghosts={ghostsOn}
            aspect={pageAspect}
            look={pageLook}
            // In Annotate with no tool, a faint mark brings its layer
            // back; with a tool picked, a touch there marks.
            onShowLayer={annotating && !tool ? unhideFromGhost : undefined}
          />
          <TextMarks
            marks={pageMarks.filter(
              (m): m is TextMark => m.kind === 'text' && m.id !== textEdit?.original?.id,
            )}
            hidden={hiddenLayers}
            ghosts={ghostsOn}
            look={pageLook}
            drag={textDrag}
            onDragStart={textTool ? () => finishText() : undefined}
            onDragMove={textTool ? (id, dx, dy) => setTextDrag({ id, dx, dy }) : undefined}
            onDragEnd={
              textTool
                ? (m, dx, dy, moved) => {
                    setTextDrag(null)
                    if (moved) moveText(m, dx, dy)
                    else editText(m)
                  }
                : undefined
            }
            onDragCancel={textTool ? () => setTextDrag(null) : undefined}
          >
            {/* The text box: mounted while the Text tool is picked (see
                    openTextBox), shown while one is open. It sizes itself to
                    what's typed (the grid's ::after copy), up to the page's
                    right edge, where it wraps. */}
            {annotating && tool === 'text' && (
              <div
                ref={textWrapRef}
                data-value={textEdit?.text ?? ''}
                onPointerDown={(event) => event.stopPropagation()}
                onPointerUp={(event) => event.stopPropagation()}
                className="pointer-events-auto absolute inline-grid w-max font-hand after:invisible after:whitespace-pre-wrap after:content-[attr(data-value)_'_'] after:[grid-area:1/1] after:[overflow-wrap:anywhere]"
                style={{
                  ...(textEdit ? textBoxStyle(textEdit) : { left: 0, top: 0 }),
                  visibility: textEdit ? 'visible' : 'hidden',
                  lineHeight: TEXT_LINE_HEIGHT,
                  outline: `1.5px dashed ${textEdit ? layerColor(textEdit.layer, pageLook) : 'transparent'}`,
                  outlineOffset: '0.25em',
                  borderRadius: '0.15em',
                }}
              >
                <textarea
                  ref={textFieldRef}
                  rows={1}
                  value={textEdit?.text ?? ''}
                  onChange={(event) =>
                    textEdit && setTextEdit({ ...textEdit, text: event.target.value })
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      finishText()
                    }
                  }}
                  aria-label="Text mark"
                  spellCheck={false}
                  autoCapitalize="off"
                  className="min-w-[0.6em] resize-none overflow-hidden border-0 bg-transparent p-0 whitespace-pre-wrap outline-none [font:inherit] [grid-area:1/1] [overflow-wrap:anywhere]"
                  style={{
                    color: textEdit ? layerColor(textEdit.layer, pageLook) : undefined,
                    fontStyle: textEdit?.italic ? 'italic' : undefined,
                  }}
                />
              </div>
            )}
          </TextMarks>
        </div>
      )
    stage = (
      <div ref={measureStage} className="relative h-full w-full">
        {stageBox &&
          windowPages.map((p) => {
            const url = pageUrl(p)
            if (failed[url]) return null
            return (
              <PageDrawing
                key={`${url}#${attempt}`}
                src={url}
                width={stageBox.w}
                height={stageBox.h}
                onReady={(drawing) => setReady((r) => ({ ...r, [url]: drawing }))}
                onError={() => setFailed((f) => ({ ...f, [url]: true }))}
              />
            )
          })}
        {ready[currentUrl] && !currentFailed && (
          <ShownPage
            drawing={ready[currentUrl]}
            src={currentUrl}
            label={`Page ${page} of ${piece?.title ?? ''}`}
            sharp={zoomed}
            lift={lift}
            mirror={pageBoxRef}
            onPainted={
              turnDebug.has('turntime') ? (ms) => flash(`Turn ${Math.round(ms)} ms`) : undefined
            }
          />
        )}
        {currentFailed ? (
          <StageMessage>
            <p>Page {page} couldn’t be prepared.</p>
            <RetryButton
              onClick={() => {
                setFailed((f) => ({ ...f, [currentUrl]: false }))
                setAttempt(attempt + 1)
              }}
            />
          </StageMessage>
        ) : (
          !currentReady &&
          slowUrl === currentUrl && (
            <StageMessage>
              <p>Preparing page {page}…</p>
            </StageMessage>
          )
        )}
      </div>
    )
  }

  return (
    <div className="group/sv fixed inset-0 flex flex-col bg-paper font-sans text-ink select-none">
      <header
        className={`relative z-20 shrink-0 border-b pt-[max(env(safe-area-inset-top),var(--titlebar-inset))] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] ${
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
                  height to spare): exit, the title, Info, ⋯ and Annotate,
                  then the clock and the page cyclers pinned to the right
                  edge, so they never move as the clock's width changes. */}
              <div className="flex h-14 items-center px-1">
                {closeButton}
                {queueButton}
                {annotating ? (
                  <span className="min-w-0 flex-1 truncate px-2 text-sm font-medium text-accent">
                    Annotating
                  </span>
                ) : (
                  titleBlock
                )}
                {pieceId !== null && infoButton}
                {moreButton}
                <span
                  className={`mx-1 h-7 w-px shrink-0 ${annotating ? 'bg-accent/30' : 'bg-border'}`}
                />
                {annotating ? doneButton : custom ? null : annotateButton}
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
            /* Three columns, the outer two equal, so the cyclers sit dead
               center — and in the same spot once Annotate swaps in its own
               toolbar. */
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
                  titleBlock
                )}
              </div>
              {cyclers}
              <div className="flex min-w-0 items-center justify-end">
                {!annotating && (
                  <>
                    {clockButton}
                    {inlineExtras && extras}
                    {inlineExtras && photoButton}
                    {pieceId !== null && infoButton}
                    {!inlineExtras && moreButton}
                    {!custom && (
                      <>
                        <span className="mx-1 h-7 w-px shrink-0 bg-border" />
                        {annotateButton}
                      </>
                    )}
                  </>
                )}
                {/* Inline, Layers joins Undo and Redo on the right: the
                    tools already fill the left side. */}
                {annotating && toolsInline && layersButton}
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
            {photoPanel}
            {infoPanel}
            {queuePanel}
            {layersPanel}
            {toolOptionsPanel}
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
                {!inlineExtras && (
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
        className={`relative min-h-0 flex-1 cursor-default overflow-hidden ${zoomed && !drawingTool ? 'touch-manipulation' : 'touch-pinch-zoom'} ${drawingTool ? 'select-none [-webkit-touch-callout:none]' : ''}`}
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerUp}
        onPointerCancel={onStagePointerCancel}
        onLostPointerCapture={onStagePointerCancel}
      >
        {/* A plain white mat. Its filter is set here, not by index.css's
            score-page rules, so the theme's treatment and the photo filters
            compose in one list (scoreFilter). The edge margin keeps the page
            clear of the screen's edges. */}
        {/* The filter is on the mat and the stage, never the marks laid
            over the page (their own layer below): an invert mustn't recolor
            annotations. Measured on an iPad, a filter on the page's canvas
            itself made turns slower (25–60ms, spikes past 100) than on the
            stage around it (under 40ms). */}
        <div style={{ filter: scoreFilter }} className="absolute inset-0 bg-white" />
        <div style={{ filter: scoreFilter }} className={`absolute inset-0 ${stageInset}`}>
          {stage}
        </div>
        {/* The marks, laid over the page from outside the filtered stage
            (same inset, so the same box). Only their own controls take the
            pointer; everything else reaches the stage underneath. */}
        {marksLayer && (
          <div className={`pointer-events-none absolute inset-0 ${stageInset}`}>
            <div className="relative h-full w-full">{marksLayer}</div>
          </div>
        )}
        {/* The notes bar: your notes' first line over the top of the page;
            tap it for Info, ✕ hides it for this piece (Info's "Show as
            banner" brings it back). Its own taps never turn. */}
        {showBar && (
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
                    everywhere else, cut to one line. */}
                <MarkdownText className="min-w-0 truncate text-[15px] [&_p]:inline">
                  {firstLine(notes)}
                </MarkdownText>
              </span>
            </button>
            <HitButton
              label="Hide the banner for this piece"
              onClick={() => setPractice({ notesBarShown: false })}
            >
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
    </div>
  )
}

// An annotation color's dot: filled, or (hidden) the crossed-out circle in
// its color; ringed when it's the picked tool's.
function ColorDot({
  layer,
  hidden,
  picked = false,
  look,
}: {
  layer: number
  hidden: boolean
  picked?: boolean
  look: PageLook
}) {
  return hidden ? (
    <IconCircleOff size={24} stroke={2.2} style={{ color: layerColor(layer, look) }} />
  ) : (
    <span
      className="size-[22px] shrink-0 rounded-full"
      style={{
        background: layerColor(layer, look),
        boxShadow: picked
          ? '0 0 0 2px var(--color-paper), 0 0 0 4px var(--color-ink)'
          : 'inset 0 0 0 1px rgb(0 0 0 / 0.08)',
      }}
    />
  )
}

// One page of the preload window, drawn at the screen's own size when it
// loads, into a canvas kept off screen; the page on screen is a copy of it
// (ShownPage). A turn then only copies a finished drawing: measured on an
// iPad, showing a hidden 300ppi <img> cost 230–290ms a turn (WebKit draws an
// opacity-0 image only once it's shown, scaling the full page down then); a
// copy, 12–46ms.
//
// Why off screen rather than stacked canvases hidden at opacity 0 (14–33ms):
// on the iPad a canvas drawn while hidden could show softer than a
// half-resolution copy once revealed, though it held the full drawing
// (measured from device screenshots), until something made Safari redraw it,
// like a pinch-zoom. The visible canvas is drawn while it shows, every turn.
//
// The page is decoded from its downloaded file (createImageBitmap) and let
// go once drawn. A resize draws it again from the browser's cache.
function PageDrawing({
  src,
  width,
  height,
  onReady,
  onError,
}: {
  src: string
  width: number
  height: number
  onReady: (drawing: HTMLCanvasElement) => void
  onError: () => void
}) {
  const callbacks = useRef({ onReady, onError })
  useEffect(() => {
    callbacks.current = { onReady, onError }
  })
  useEffect(() => {
    if (!width || !height) return
    let cancelled = false
    let drawn: HTMLCanvasElement | null = null
    fetch(src)
      .then((response) => {
        if (!response.ok) throw new Error(`page ${response.status}`)
        return response.blob()
      })
      .then((blob) => createImageBitmap(blob))
      .then((img) => {
        if (cancelled) {
          img.close()
          return
        }
        const dpr = window.devicePixelRatio || 1
        // Fit the score area in whole CSS pixels, never past the page's own
        // 300ppi pixels.
        const scale = Math.min(width / img.width, height / img.height, 1 / dpr)
        const cssWidth = Math.floor(img.width * scale)
        const cssHeight = Math.floor(img.height * scale)
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')
        if (!context) throw new Error('no canvas')
        canvas.width = Math.round(cssWidth * dpr)
        canvas.height = Math.round(cssHeight * dpr)
        context.imageSmoothingQuality = 'high'
        context.drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.dataset.cssWidth = String(cssWidth)
        canvas.dataset.cssHeight = String(cssHeight)
        canvas.dataset.areaWidth = String(width)
        canvas.dataset.areaHeight = String(height)
        img.close()
        drawn = canvas
        callbacks.current.onReady(canvas)
      })
      .catch(() => {
        if (!cancelled) callbacks.current.onError()
      })
    return () => {
      cancelled = true
      // Free its memory at once (iPad Safari caps what all canvases may
      // hold); the screen keeps its own copy.
      if (drawn) {
        drawn.width = 0
        drawn.height = 0
      }
    }
  }, [src, width, height])
  return null
}

// The page on screen: the current page's drawing copied onto the one
// visible canvas, before the frame is painted.
//
// It's shown at exactly its own pixel size, or the screen resamples it and
// fine detail goes soft: so its size is a whole number of CSS pixels (iPad
// Safari rounds a 689.5pt-wide canvas up to 690pt — stretching a 1379px
// drawing over 1380 screen pixels, measured from barline positions in an
// iPad screenshot), and it's placed on whole device pixels rather than
// centered with CSS.
//
// Pinch-zoomed in, the drawing alone would only magnify screen pixels, so
// the page's full 300ppi image is laid over it in the same spot (`sharp`) —
// transparent until loaded — and let go on zooming out, keeping memory and
// turns as they are unzoomed.
function ShownPage({
  drawing,
  src,
  label,
  sharp,
  lift,
  mirror,
  onPainted,
}: {
  drawing: HTMLCanvasElement
  src: string
  label: string
  sharp: boolean
  // How far the page lifts to keep an open text box above the keyboard.
  lift: number
  // The marks layer's box, kept on exactly the page's size and place.
  mirror: React.RefObject<HTMLDivElement | null>
  // TEMPORARY: told how long after the last tap or key the page painted.
  onPainted?: (ms: number) => void
}) {
  const painted = useRef(onPainted)
  useEffect(() => {
    painted.current = onPainted
  })
  useEffect(() => {
    if (!painted.current || !lastInputAt) return
    let timer = 0
    const frame = requestAnimationFrame(() => {
      timer = window.setTimeout(() => painted.current?.(performance.now() - lastInputAt), 0)
    })
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [drawing])
  const wrapRef = useRef<HTMLDivElement>(null)
  const ref = useRef<HTMLCanvasElement>(null)
  // The drawing's pixels, copied in. A drawing freed by a resize, its
  // replacement still on the way, is skipped: what's showing stays.
  useLayoutEffect(() => {
    const canvas = ref.current
    if (!canvas || !drawing.width) return
    canvas.width = drawing.width
    canvas.height = drawing.height
    canvas.getContext('2d')?.drawImage(drawing, 0, 0)
  }, [drawing])
  // Its size and place. Drawn for this score area, at exactly its own size;
  // after a resize (rotation, the edge margin), the drawing it has is
  // stretched to fit the new area, centered, until the new one lands a
  // moment later — softer for that moment, but never out of place. Placed
  // from the score area's own resize observer, in the same frame as the
  // resize, never a frame behind it.
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const parent = wrap?.parentElement
    if (!wrap || !parent) return
    const place = () => {
      const area = parent.getBoundingClientRect()
      if (!area.width || !area.height) return
      const dpr = window.devicePixelRatio || 1
      let width = Number(drawing.dataset.cssWidth)
      let height = Number(drawing.dataset.cssHeight)
      const drawnFor =
        Number(drawing.dataset.areaWidth) === Math.round(area.width) &&
        Number(drawing.dataset.areaHeight) === Math.round(area.height)
      if (!drawnFor) {
        const scale = Math.min(area.width / width, area.height / height)
        width = Math.floor(width * scale)
        height = Math.floor(height * scale)
      }
      // Centered, then rounded to a device pixel on the screen itself (the
      // score area may start between pixels too).
      const snap = (start: number, room: number, size: number) =>
        Math.round((start + (room - size) / 2) * dpr) / dpr - start
      for (const box of [wrap, mirror.current]) {
        if (!box) continue
        box.style.width = `${width}px`
        box.style.height = `${height}px`
        box.style.left = `${snap(area.left, area.width, width)}px`
        box.style.top = `${snap(area.top, area.height, height)}px`
      }
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [drawing])
  return (
    <div
      ref={wrapRef}
      className="absolute transition-transform duration-200 ease-out motion-reduce:transition-none"
      style={{ transform: lift ? `translateY(${-lift}px)` : undefined }}
    >
      <canvas ref={ref} role="img" aria-label={label} className="block h-full w-full" />
      {/* Transparent until it loads, so the drawing shows meanwhile. */}
      {sharp && (
        <img
          src={src}
          alt=""
          aria-hidden
          draggable={false}
          className="absolute inset-0 block h-full w-full"
        />
      )}
    </div>
  )
}

// A custom setlist entry's stand-in page in a setlist session: the Setlist
// PDF's Generated Program Page (drawProgramPage, internal/setlistpdf),
// drawn the same way at a Letter page's proportions — sized in real points
// against the page's own width (1pt = 100cqw / 612). From the mockup.
const PRINT_INK = '#1c1815'
const PRINT_FAINT = '#5c5349'
const PRINT_FAINTER = '#b3a99e'
const LETTER = { w: 612, h: 792 }
const pt = (n: number) => `calc(${n} * 100cqw / ${LETTER.w})`
// On screen it's drawn half again as large as the printed page (picked from
// a side-by-side, https://claude.ai/artifact/WRq89mAWk6oVYk4N595MGS, option
// B): print size read small on a stand. Margins and the optical lift stay
// the page's; the column widens to 400pt. The Setlist PDF is unchanged.
const PLACEHOLDER_SCALE = 1.5
const PLACEHOLDER_COLUMN = 400
const ps = (n: number) => pt(n * PLACEHOLDER_SCALE)
function PlaceholderPage({ entry }: { entry: Extract<QueueItem, { kind: 'custom' }> }) {
  const smallCaps = {
    fontSize: ps(11 * 1.08),
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
        <div className="flex flex-col items-center" style={{ gap: ps(10) }}>
          <span
            aria-hidden="true"
            style={{
              display: 'block',
              width: ps(6),
              height: ps(6),
              background: PRINT_FAINTER,
              transform: 'rotate(45deg)',
              margin: `${ps(3)} 0 ${ps(11)}`,
            }}
          />
          {entry.role && (
            <span className="font-sans uppercase" style={smallCaps}>
              {entry.role}
            </span>
          )}
          <span
            className="font-display italic"
            style={{
              fontSize: ps(24),
              lineHeight: 1.24,
              color: PRINT_INK,
              width: pt(PLACEHOLDER_COLUMN),
            }}
          >
            {entry.name}
          </span>
          {entry.notes && (
            <>
              <span
                aria-hidden="true"
                style={{
                  height: ps(1),
                  width: ps(24),
                  background: PRINT_FAINTER,
                  margin: `${ps(2)} 0`,
                }}
              />
              <div
                className="font-sans"
                style={{
                  fontSize: ps(12 * 1.08),
                  letterSpacing: '0.02em',
                  lineHeight: 1.4,
                  color: PRINT_FAINT,
                  width: pt(PLACEHOLDER_COLUMN),
                }}
              >
                <MarkdownText>{entry.notes}</MarkdownText>
              </div>
            </>
          )}
          {entry.durationSeconds != null && (
            <span className="font-sans uppercase tabular-nums" style={smallCaps}>
              {formatDuration(entry.durationSeconds)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// A line on the mat (loading, or an error with its way out), drawn in print
// colors, since the mat is white in every theme and carries the theme's
// filter.
function StageMessage({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-[#5c5349] italic">
      {children}
    </div>
  )
}

// Its own taps never reach the stage, so trying again doesn't also turn.
function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={onClick}
      className="cursor-pointer font-medium text-[#3f5c3f] not-italic underline underline-offset-2"
    >
      Try again
    </button>
  )
}
