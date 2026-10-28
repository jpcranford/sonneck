import {
  Fragment,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react'
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
  IconEye,
  IconEyeOff,
  IconStack2,
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
import { resetTips, takeTip } from '../lib/sheetViewerTips'
import {
  applyChange,
  eraserTouches,
  markAnchor,
  removedSince,
  strokePath,
  TEXT_LINE_HEIGHT,
  type Mark,
  type MarkChange,
  type MarkPoint,
  type PageBox,
  type StrokeMark,
  type TextMark,
} from '../lib/sheetViewerMarks'
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
  { key: 'text', label: 'Text', Icon: IconTypography },
  // Last, after the three tools that draw in a color.
  { key: 'eraser', label: 'Eraser', Icon: IconEraser },
] as const
type Tool = (typeof TOOLS)[number]['key']
// See toolsInline.
const TOOLS_INLINE_MIN_WIDTH = 720
// The annotation palette (Phases 11–13): six colors, each its own layer.
// Each is tuned so a mark reads as well where it crosses a note as on blank
// paper, which lands on nearly the same value on a white page and on Dark
// Mode Scores — one set for both — and a little deeper on the dark theme's
// dimmed page. Ink is the exception: it's for correcting the print, so it
// stays close to (not quite) the printed ink, and on an inverted page it's
// that ink as the page's own invert shows it. Yellow is the highlighter's;
// it sits behind the notes, multiplied on light pages and screened on dark
// ones.
const LAYER_COLORS: { name: string; light: string; dim: string; dark: string }[] = [
  { name: 'Red', light: '#d73d2d', dim: '#c43426', dark: '#d63a2a' },
  { name: 'Yellow', light: '#f2c12e', dim: '#f2c12e', dark: '#f2c12e' },
  { name: 'Blue', light: '#2c71e2', dim: '#1d64d8', dark: '#2a70e2' },
  { name: 'Green', light: '#1b8749', dim: '#187941', dark: '#1a8548' },
  { name: 'Purple', light: '#8e5fc3', dim: '#8350bd', dark: '#8d5ec3' },
  { name: 'Ink', light: '#2b2622', dim: '#2b2622', dark: '#d3cfcb' },
]
// How the page currently looks: white, the dark theme's dimmed page, or
// inverted (Dark Mode Scores, or the photo panel's Invert).
type PageLook = 'light' | 'dim' | 'dark'
const layerColor = (layer: number, look: PageLook) => LAYER_COLORS[layer][look]
// The tools' sizes, as a share of the page's width (picked in the size
// playground; the pen's retuned on the iPad), so a mark keeps its weight at
// any screen size. The eraser's is the width of its reach; M is about 28pt
// across on an iPad in landscape.
type Size = 'S' | 'M' | 'L'
const SIZES: Record<Tool, Record<Size, number>> = {
  pen: { S: 0.25, M: 0.39, L: 0.58 },
  highlighter: { S: 1.2, M: 2, L: 3 },
  text: { S: 1.4, M: 1.8, L: 2.4 },
  eraser: { S: 3, M: 5, L: 8 },
}
// Each tool remembers its own color and size; these are where they start:
// the pen in Ink, the highlighter in Yellow, text in Blue.
type ColorTool = 'pen' | 'highlighter' | 'text'
const TOOL_START: Record<ColorTool, { color: number; size: Size }> = {
  pen: { color: 5, size: 'M' },
  highlighter: { color: 1, size: 'M' },
  text: { color: 2, size: 'M' },
}

// Sample marks the pages start with, so the layers have something to hide
// before anything is drawn. Each is in fractions of the page — x of its width, y
// of its height — so it lands in the same place on any page, and drawn at
// the tools' medium sizes. Page 1 has a mark on every color, page 2 on two,
// the rest on one.
type SampleMark =
  | { layer: number; kind: 'ring'; x: number; y: number; rx: number; ry: number }
  | { layer: number; kind: 'line'; points: [number, number][]; highlight?: boolean }
  | { layer: number; kind: 'text'; x: number; y: number; text: string; italic?: boolean }
const SAMPLE_MARKS: SampleMark[][] = [
  [
    { layer: 0, kind: 'ring', x: 0.5, y: 0.3, rx: 0.07, ry: 0.035 },
    { layer: 2, kind: 'text', x: 0.62, y: 0.22, text: '2' },
    { layer: 2, kind: 'text', x: 0.67, y: 0.22, text: '1' },
    { layer: 2, kind: 'text', x: 0.72, y: 0.22, text: '3' },
    {
      layer: 1,
      kind: 'line',
      points: [
        [0.3, 0.45],
        [0.55, 0.45],
      ],
      highlight: true,
    },
    {
      layer: 3,
      kind: 'line',
      points: [
        [0.18, 0.62],
        [0.25, 0.6],
        [0.32, 0.62],
      ],
    },
    {
      layer: 4,
      kind: 'line',
      points: [
        [0.42, 0.7],
        [0.28, 0.715],
        [0.42, 0.73],
      ],
    },
    { layer: 5, kind: 'text', x: 0.12, y: 0.85, text: 'cresc.', italic: true },
  ],
  [
    { layer: 0, kind: 'ring', x: 0.35, y: 0.5, rx: 0.06, ry: 0.03 },
    { layer: 5, kind: 'text', x: 0.7, y: 0.35, text: 'p sub.', italic: true },
  ],
  [{ layer: 2, kind: 'text', x: 0.4, y: 0.3, text: '4' }],
]
// A page's starting marks as real marks (lib/sheetViewerMarks.ts), so they
// can be erased and their erasing undone like anything drawn. A ring becomes
// a pen stroke around it.
function seedMarks(page: number): Mark[] {
  return SAMPLE_MARKS[Math.min(page, SAMPLE_MARKS.length) - 1].map((m, i): Mark => {
    const id = `s${page}-${i}`
    if (m.kind === 'text')
      return {
        id,
        kind: 'text',
        layer: m.layer,
        x: m.x,
        y: m.y,
        size: SIZES.text.M,
        text: m.text,
        italic: m.italic,
      }
    const tool = m.kind === 'line' && m.highlight ? 'highlighter' : 'pen'
    const points: MarkPoint[] =
      m.kind === 'ring'
        ? Array.from({ length: 49 }, (_, k) => {
            const t = (k / 48) * 2 * Math.PI
            return [m.x + m.rx * Math.cos(t), m.y + m.ry * Math.sin(t), 0.5]
          })
        : m.points.map(([x, y]) => [x, y, 0.5])
    return {
      id,
      kind: 'stroke',
      tool,
      layer: m.layer,
      size: SIZES[tool].M,
      points,
      // An even pressure: their few far-apart points would read as a fast,
      // thin stroke if it were simulated from speed.
      pressure: true,
    }
  })
}
// An undo or redo of a change on another page turns there first, then
// applies it after this long, so you see it happen.
const UNDO_TURN_MS = 450
const UNDO_WAIT_MS = 10_000

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
// A piece counts as practiced today once at least this long has been spent
// on it (30s; no longer also needing its last page reached, user 2026-10-27).
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
  // User Settings' "Show hidden colors faintly" (on by default): off, a
  // hidden color's marks don't show at all.
  const [ghostsOn, setGhostsOn] = useState(true)
  // User Settings' "Show practice notes as banner" (off by default): the
  // banner for a piece whose own switch hasn't been set.
  const [barDefault, setBarDefault] = useState(false)
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
  // Each tool's own color and size (B2: a tool remembers what it last used).
  const [toolStyle, setToolStyle] = useState(TOOL_START)
  // The eraser has a size but no color.
  const [eraserSize, setEraserSize] = useState<Size>('M')
  const eraserRadius = SIZES.eraser[eraserSize] / 200
  const [menu, setMenu] = useState<
    'clock' | 'more' | 'info' | 'photo' | 'queue' | 'layers' | 'tool' | null
  >(null)
  // Phase 11 trial: color layers hidden (kept per piece in the real thing),
  // and the page image's shape, so the marks can be laid over it.
  const [hiddenLayers, setHiddenLayers] = useState<number[]>([])
  const [pageAspect, setPageAspect] = useState(8.5 / 11)
  // Phase 15: every page's marks, by "pieceId:page" (a page not yet touched
  // shows its sample marks), the stroke being drawn, where the eraser is,
  // and the session's undo history.
  const [marksByPage, setMarksByPage] = useState<Record<string, Mark[]>>({})
  const [live, setLive] = useState<StrokeMark | null>(null)
  const [eraserAt, setEraserAt] = useState<[number, number] | null>(null)
  // Phase 17: the text box open for typing, how far the page is lifted to
  // keep it clear of the keyboard, and a text mark being dragged.
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null)
  const [lift, setLift] = useState(0)
  const [textDrag, setTextDrag] = useState<{ id: string; dx: number; dy: number } | null>(null)
  // Mockup panel: pretend an on-screen keyboard covers the bottom 40%, for
  // trying the lift without an iPad.
  const [fakeKeyboard, setFakeKeyboard] = useState(false)
  const [history, setHistory] = useState<{ done: MarkChange[]; undone: MarkChange[] }>({
    done: [],
    undone: [],
  })
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
  // Each piece's own banner choice; a piece without one follows barDefault.
  const [barShown, setBarShown] = useState<Record<number, boolean>>({})
  const barOn = activeId !== null && (barShown[activeId] ?? barDefault)
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
  const showBar = notes !== '' && barOn && menu === null && !customKey

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
  const layersAnchorRef = useRef<HTMLDivElement>(null)
  const toolAnchorRef = useRef<HTMLDivElement>(null)
  const phoneRow2Ref = useRef<HTMLDivElement>(null)
  const infoAnchorRef = useRef<HTMLDivElement>(null)
  const clockAnchorRef = useRef<HTMLDivElement>(null)
  const moreAnchorRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  const hintTimer = useRef<number | undefined>(undefined)
  const undoTimer = useRef<number | undefined>(undefined)
  const pageBoxRef = useRef<HTMLDivElement>(null)
  useEffect(
    () => () => {
      window.clearTimeout(closeTimer.current)
      window.clearTimeout(hintTimer.current)
      window.clearTimeout(undoTimer.current)
    },
    [],
  )

  // An instruction pill: a tip, shown only its first few times
  // (lib/sheetViewerTips.ts).
  function tip(id: string, text: string) {
    if (takeTip(id)) flash(text)
  }
  function flash(text: string) {
    window.clearTimeout(hintTimer.current)
    setHint({ text, id: Date.now() })
    hintTimer.current = window.setTimeout(() => setHint(null), HINT_MS)
  }

  function turn(dir: -1 | 1) {
    finishText()
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
  const stepHistoryRef = useRef(stepHistory)
  useEffect(() => {
    turnRef.current = turn
    stepHistoryRef.current = stepHistory
  })

  // Page-turner pedals pair as keyboards sending this fixed set (plan:
  // hardcoded, no remapping). Space/Enter would also press whichever
  // toolbar button last took focus, so the viewer claims them.
  // Pedals keep turning while Info is open (only taps close it first).
  const menuOpen = menu === 'clock' || menu === 'more'
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

  // Practiced today: time on each piece adds up while it's showing; past
  // PRACTICED_MS, it's marked.
  // A custom entry isn't a piece: nothing to mark.
  const viewId = customKey ? null : activeId
  const spent = useRef(new Map<number, number>())
  const viewing = useRef<{ id: number | null; since: number }>({ id: null, since: 0 })
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
    const t = window.setInterval(() => {
      const { id, since } = viewing.current
      // User Settings' practice-tracking switch off: nothing is recorded.
      if (!tracking.current || id === null) return
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
    tip('annotate', 'Annotate: pick a tool to mark; until then taps turn pages')
  }
  function leaveAnnotate() {
    finishText()
    setMode('play')
    setTool(null)
    tip('play', 'Play: taps turn pages')
  }
  // B2: tapping the picked tool again opens its color and size (the
  // eraser's, its size); tapping it once more, options showing, puts it
  // down, so taps turn pages again.
  function pickTool(key: Tool) {
    if (tool !== key) {
      finishText()
      setTool(key)
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
      setTool(null)
      setMenu(null)
      tip('no-tool', 'No tool: taps turn pages')
    }
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
      down.current = { x: event.clientX, y: event.clientY, t: performance.now() }
  }
  function onStagePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (finishMark(event)) return
    fingers.current.delete(event.pointerId)
    const start = down.current
    down.current = null
    if (!start) return
    if (mode === 'annotate' && tool) {
      // The Text tool: a tap on the page opens a text box there.
      if (tool === 'text' && !custom && activeId !== null) {
        const p = pagePoint({ clientX: start.x, clientY: start.y })
        const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y)
        if (p && moved < 10 && p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1) startTextBox(p)
      }
      return
    }
    const end = { x: event.clientX, y: event.clientY, t: performance.now() }
    const dir = stageTurn(start, end, event.currentTarget.getBoundingClientRect())
    if (dir) turn(dir)
  }
  function onStagePointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    if (marking.current?.id === event.pointerId) cancelMark()
    fingers.current.delete(event.pointerId)
    down.current = null
  }

  // Marking (Phase 15). Strokes go through perfect-freehand
  // (lib/sheetViewerMarks.ts) with an Apple Pencil's real pressure, or
  // pressure simulated from speed for a finger or mouse. Every point is a
  // share of the page, so marks keep their place at any size.
  const pageKey = `${activeId}:${page}`
  const marksFor = (key: string) => marksByPage[key] ?? seedMarks(Number(key.split(':')[1]))
  const marking = useRef<{ id: number; type: string } | null>(null)
  const liveRef = useRef<StrokeMark | null>(null)
  const erasing = useRef<{
    key: string
    before: Mark[]
    removed: Set<string>
    last: [number, number]
    // Each text mark's drawn box: text wraps, so its size is only known
    // from the page.
    textBoxes: Map<string, PageBox>
  } | null>(null)
  const markCount = useRef(0)
  function markTool() {
    if (mode !== 'annotate' || custom || activeId === null) return null
    return tool === 'pen' || tool === 'highlighter' || tool === 'eraser' ? tool : null
  }
  function pagePoint(event: { clientX: number; clientY: number }): [number, number] | null {
    const box = pageBoxRef.current?.getBoundingClientRect()
    if (!box?.width) return null
    return [(event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height]
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
        before: marksFor(pageKey),
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
    markCount.current += 1
    const mark: StrokeMark = {
      id: `m${markCount.current}`,
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
  // whole marks only; a hidden layer's marks are never erased.
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
    const key = e.key
    setMarksByPage((prev) => ({
      ...prev,
      [key]: (prev[key] ?? e.before).filter((m) => !ids.has(m.id)),
    }))
  }
  function finishMark(event: React.PointerEvent<HTMLDivElement>) {
    if (marking.current?.id !== event.pointerId) return false
    marking.current = null
    const e = erasing.current
    if (e) {
      erasing.current = null
      setEraserAt(null)
      const removed = removedSince(e.before, e.removed)
      if (removed.length) record({ key: e.key, added: [], removed })
      return true
    }
    const mark = liveRef.current
    liveRef.current = null
    setLive(null)
    if (mark) {
      const key = pageKey
      setMarksByPage((prev) => ({ ...prev, [key]: [...(prev[key] ?? marksFor(key)), mark] }))
      record({ key, added: [mark], removed: [] })
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
      setMarksByPage((prev) => ({ ...prev, [e.key]: e.before }))
    }
  }

  // Text marks (Phase 17). One text field stays mounted while the Text tool
  // is picked, so a tap can move it into place and focus it inside the tap
  // itself: iPad Safari raises the keyboard only for a focus made in the
  // user's own gesture. Return starts a new line; a tap anywhere else, or
  // another tool, finishes the box; a box finished empty adds nothing (or,
  // when editing, removes the mark). Each finished box is one undo step.
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
      y: p[1] + em * (1 - TEXT_LINE_HEIGHT / 2),
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
    setMarksByPage((prev) => {
      const next = [...(prev[key] ?? list)]
      if (index >= 0) {
        if (mark) next[index] = mark
        else next.splice(index, 1)
      } else if (mark) next.push(mark)
      return { ...prev, [key]: next }
    })
    if (removed.length || mark) record({ key, added: mark ? [mark] : [], removed })
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
    if (!original) markCount.current += 1
    placeText(key, original, {
      id: original?.id ?? `t${markCount.current}`,
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
  // Every drawn text mark's box on this page, as shares of the page.
  function drawnTextBoxes() {
    const boxes = new Map<string, PageBox>()
    const page = pageBoxRef.current
    const box = page?.getBoundingClientRect()
    if (!page || !box?.width) return boxes
    page.querySelectorAll<HTMLElement>('[data-text-mark]').forEach((el) => {
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
  // keyboard (the visual viewport's bottom), never past its own top, and
  // settles back when it closes.
  useEffect(() => {
    if (!textEdit) return
    function measure() {
      const wrap = textWrapRef.current
      const page = pageBoxRef.current
      const stage = page?.parentElement
      if (!wrap || !page || !stage) return
      const applied = new DOMMatrixReadOnly(getComputedStyle(page).transform).m42
      const r = wrap.getBoundingClientRect()
      const top = r.top - applied
      const bottom = r.bottom - applied
      const vv = window.visualViewport
      const visibleBottom = fakeKeyboard
        ? window.innerHeight * 0.6
        : vv
          ? vv.offsetTop + vv.height
          : window.innerHeight
      const room = Math.max(0, top - stage.getBoundingClientRect().top - LIFT_GAP)
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
  }, [textEdit, fakeKeyboard])
  // Undo and Redo (plan: marking, erasing and text edits, never hide/show;
  // the whole session's history). A change on another page — or another
  // piece in the queue — turns there first, then visibly applies.
  function record(change: MarkChange) {
    setHistory((h) => ({ done: [...h.done, change], undone: [] }))
  }
  const undoPending = useRef(false)
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
    if (mode !== 'annotate' || undoPending.current || marking.current) return
    const change = (direction === 'undo' ? history.done : history.undone).at(-1)
    if (!change) return
    // A pill names what's undone or redone, so a press always shows; one
    // elsewhere says where, since the view turns there first.
    const [changePiece, changePage] = change.key.split(':').map(Number)
    const where =
      change.key === pageKey && !custom
        ? ''
        : changePiece === activeId && !custom
          ? `, page ${changePage}`
          : `, ${byId.get(changePiece)?.title ?? 'another piece'}`
    flash(`${direction === 'undo' ? 'Undo' : 'Redo'}: ${describeChange(change)}${where}`)
    const apply = () => {
      setMarksByPage((prev) => ({
        ...prev,
        [change.key]: applyChange(prev[change.key] ?? marksFor(change.key), change, direction),
      }))
      setHistory((h) =>
        direction === 'undo'
          ? { done: h.done.slice(0, -1), undone: [...h.undone, change] }
          : { done: [...h.done, change], undone: h.undone.slice(0, -1) },
      )
    }
    if (change.key === pageKey && !custom) {
      apply()
      return
    }
    const [pid, pg] = change.key.split(':').map(Number)
    if (pid !== activeId || custom) goToPiece(pid, pg)
    else setPage(pg)
    // A page far away (or in another piece) may not be loaded yet: the
    // change waits for it to show (pageShown), then UNDO_TURN_MS, so it's
    // never applied to a page still loading. If it never shows, it applies
    // anyway after UNDO_WAIT_MS.
    undoPending.current = true
    awaitingPage.current = { key: change.key, apply }
    window.clearTimeout(undoTimer.current)
    undoTimer.current = window.setTimeout(() => finishPendingStep(), UNDO_WAIT_MS)
  }
  const awaitingPage = useRef<{ key: string; apply: () => void } | null>(null)
  function finishPendingStep() {
    const pending = awaitingPage.current
    awaitingPage.current = null
    undoPending.current = false
    pending?.apply()
  }
  // The page image for `key` has loaded.
  function pageShown(key: string) {
    if (awaitingPage.current?.key !== key) return
    window.clearTimeout(undoTimer.current)
    undoTimer.current = window.setTimeout(() => finishPendingStep(), UNDO_TURN_MS)
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
            {/* The Markdown hint sits inside the box, in its bottom corner
                beside the resize grip, the text kept clear of it. */}
            <div className="relative">
              <textarea
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                aria-label="Your notes"
                className="block min-h-40 w-full resize-y rounded-xl border border-accent bg-paper-raised px-4 pt-3 pb-8 text-base leading-relaxed text-ink outline-none select-text"
              />
              <span className="pointer-events-none absolute right-6 bottom-2.5 text-xs text-ink-muted italic">
                Markdown and :shortcodes: supported
              </span>
            </div>
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
                  if (event.target === event.currentTarget) setBar(!barOn)
                }}
              >
                <Toggle
                  row
                  checked={barOn}
                  onChange={setBar}
                  label="Show practice notes as banner"
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

  // From 720px (every iPad, portrait included) the Annotate tools share the
  // one toolbar row: the tools left of the page cyclers, Layers, Undo and
  // Redo beside Done on the right, since all of them don't fit on one side.
  // Narrower, they take a second row. The tools' side first fits at 712px.
  const toolsInline = width >= TOOLS_INLINE_MIN_WIDTH
  // Undo and Redo fade (disabled) when there's nothing to undo or redo.
  const canUndo = history.done.length > 0
  const canRedo = history.undone.length > 0
  const undoRedo = (
    <>
      <HitButton label="Undo" onClick={() => stepHistory('undo')} disabled={!canUndo}>
        <IconArrowBackUp size={22} />
      </HitButton>
      <HitButton label="Redo" onClick={() => stepHistory('redo')} disabled={!canRedo}>
        <IconArrowForwardUp size={22} />
      </HitButton>
    </>
  )
  // The page's look, for the layer colors: inverted (Dark Mode Scores or
  // the photo panel's Invert), the dark theme's dimmed page, or white.
  const pageLook: PageLook =
    invertHidden || photo.invert ? 'dark' : theme === 'dark' ? 'dim' : 'light'
  // The marks on this page. A custom setlist entry has none.
  const pageMarks = custom || activeId === null ? [] : marksFor(pageKey)
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
  // A color's dot: filled, or (hidden) the crossed-out circle in its color.
  const colorDot = (layer: number, hidden: boolean, picked = false) =>
    hidden ? (
      <IconCircleOff size={24} stroke={2.2} style={{ color: layerColor(layer, pageLook) }} />
    ) : (
      <span
        className="size-[22px] shrink-0 rounded-full"
        style={{
          background: layerColor(layer, pageLook),
          boxShadow: picked
            ? '0 0 0 2px var(--color-paper), 0 0 0 4px var(--color-ink)'
            : 'inset 0 0 0 1px rgb(0 0 0 / 0.08)',
        }}
      />
    )
  const layersStyle = useAnchoredPanel(layersAnchorRef, menu === 'layers', 'below-center', {
    gap: 6,
    panelWidth: 232,
  })
  // The Layers menu (B2): no color names — each row is the color, its marks
  // on this page and its eye (the name stays as the row's label for screen
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
              <span className="flex size-6 items-center justify-center">{colorDot(i, hidden)}</span>
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
  // soon as you mark with it.
  const optionsTool = tool
  const optionsStyle = optionsTool
    ? optionsTool === 'eraser'
      ? { color: null, size: eraserSize }
      : toolStyle[optionsTool]
    : null
  function setOptionsSize(size: Size) {
    if (optionsTool === 'eraser') setEraserSize(size)
    else if (optionsTool)
      setToolStyle({ ...toolStyle, [optionsTool]: { ...toolStyle[optionsTool], size } })
    // An open text box takes the new size too.
    if (optionsTool === 'text' && textEdit) setTextEdit({ ...textEdit, size: SIZES.text[size] })
  }
  const toolOptionsStyle = useAnchoredPanel(toolAnchorRef, menu === 'tool', 'below-center', {
    gap: 6,
    panelWidth: 312,
  })
  const toolOptionsPanel =
    menu === 'tool' &&
    optionsTool &&
    optionsStyle &&
    toolOptionsStyle &&
    createPortal(
      <div
        style={{ ...toolOptionsStyle, width: 312 }}
        // Picking a color or size keeps the text box's keyboard up.
        onMouseDown={(event) => textEdit && event.preventDefault()}
        className="z-50 rounded-xl border border-border bg-paper px-3 pt-3 pb-3 font-sans text-ink shadow-xl select-none [--sv-hover:var(--color-paper-hover)]"
      >
        {optionsTool !== 'eraser' && (
          <>
            <p className="px-1 pb-1 text-xs font-semibold tracking-wider text-ink-muted uppercase">
              {TOOLS.find((t) => t.key === optionsTool)?.label} color
            </p>
            <div className="flex">
              {LAYER_COLORS.map((c, i) => (
                <HitButton
                  key={c.name}
                  label={`${c.name}${hiddenLayers.includes(i) ? ' (hidden)' : ''}`}
                  onClick={() => {
                    setToolStyle({
                      ...toolStyle,
                      [optionsTool]: { ...toolStyle[optionsTool], color: i },
                    })
                    // An open text box takes the new color too.
                    if (optionsTool === 'text' && textEdit) setTextEdit({ ...textEdit, layer: i })
                  }}
                  faceClassName={FACE_HOVER}
                >
                  {colorDot(i, hiddenLayers.includes(i), optionsStyle.color === i)}
                </HitButton>
              ))}
            </div>
          </>
        )}
        <p
          className={`px-1 pb-1 text-xs font-semibold tracking-wider text-ink-muted uppercase ${optionsTool === 'eraser' ? '' : 'pt-2'}`}
        >
          {optionsTool === 'eraser' ? 'Eraser size' : 'Size'}
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

  const annotating = mode === 'annotate'
  const drawing = markTool() !== null

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
                {/* Inline (wide), Layers joins Undo and Redo on the right:
                    the tools and swatches already fill the left side. */}
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
            {infoPanel}
            {photoPanel}
            {queuePanel}
            {layersPanel}
            {toolOptionsPanel}
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
        className={`relative min-h-0 flex-1 cursor-default overflow-hidden ${zoomed && !drawing ? 'touch-manipulation' : 'touch-pinch-zoom'} ${drawing ? 'select-none [-webkit-touch-callout:none]' : ''}`}
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerUp}
        onPointerCancel={onStagePointerCancel}
        onLostPointerCapture={onStagePointerCancel}
      >
        {/* Plain white mat (plan: launch default). Its filter is set here,
            not by index.css's score-page rules, so the theme's treatment and
            the user's photo filters compose in one list (see scoreFilter).
            The margin keeps the page clear of the screen's edges. */}
        {/* The filter is on the mat and the page image, never the marks
            laid over them (plan: an invert mustn't recolor annotations). */}
        <div style={{ filter: scoreFilter }} className="absolute inset-0 bg-white" />
        <div
          style={{ containerType: 'size' }}
          className={`absolute inset-0 flex items-center justify-center ${
            photo.margin
              ? 'p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]'
              : 'pb-[env(safe-area-inset-bottom)]'
          }`}
        >
          {custom ? (
            <div style={{ filter: scoreFilter }}>
              <PlaceholderPage entry={custom} />
            </div>
          ) : (
            activeId !== null && (
              // The page, fitted to the stage at its own shape, with the
              // marks over it in the same box.
              <div
                ref={pageBoxRef}
                className="relative transition-transform duration-200 ease-out motion-reduce:transition-none"
                style={{
                  width: `min(100cqw, calc(100cqh * ${pageAspect}))`,
                  aspectRatio: pageAspect,
                  transform: lift ? `translateY(${-lift}px)` : undefined,
                }}
              >
                <img
                  key={`${activeId}-${page}`}
                  src={getPieceThumbnailUrl(activeId, page)}
                  alt={`Page ${page}`}
                  draggable={false}
                  onLoad={(event) => {
                    const img = event.currentTarget
                    if (img.naturalWidth) setPageAspect(img.naturalWidth / img.naturalHeight)
                    pageShown(pageKey)
                  }}
                  onError={() => pageShown(pageKey)}
                  style={{ filter: scoreFilter }}
                  className="block h-full w-full"
                />
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
                  // back (I); with a tool picked, a touch there marks.
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
                  onDrag={
                    annotating && tool === 'text'
                      ? {
                          start: () => finishText(),
                          move: (id, dx, dy) => setTextDrag({ id, dx, dy }),
                          end: (m, dx, dy, moved) => {
                            setTextDrag(null)
                            if (moved) moveText(m, dx, dy)
                            else editText(m)
                          },
                          cancel: () => setTextDrag(null),
                        }
                      : undefined
                  }
                >
                  {/* The text box: mounted while the Text tool is picked (see
                      openTextBox), shown while one is open. It sizes itself
                      to what's typed (the grid's ::after copy), up to the
                      page's right edge, where it wraps. */}
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
          )}
        </div>
        {showZones && (mode === 'play' || !tool) && <ZoneOverlay />}
        {/* The notes bar (Phase 3): your notes' first line over the top of
            the page; tap it for Info, ✕ hides it for this piece (Info's
            "Show practice notes as banner" brings it back). Its own taps never turn. */}
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
              <button
                type="button"
                onClick={() => {
                  resetTips()
                  flash('Tips will show again')
                }}
                className="cursor-pointer self-start rounded-lg border border-border bg-paper-raised px-3 py-1.5 font-medium hover:border-accent"
              >
                Show tips again
              </button>
              <label className="flex items-center gap-2">
                <Checkbox checked={fastMinute} onChange={(e) => setFastMinute(e.target.checked)} />
                “Practiced” after 5 s, not 30
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={trackingOn} onChange={(e) => setTrackingOn(e.target.checked)} />
                Practice tracking (User Settings)
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={ghostsOn} onChange={(e) => setGhostsOn(e.target.checked)} />
                Hidden colors shown faintly (User Settings)
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={fakeKeyboard}
                  onChange={(e) => setFakeKeyboard(e.target.checked)}
                />
                Pretend a keyboard covers the bottom 40% while typing
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={barDefault} onChange={(e) => setBarDefault(e.target.checked)} />
                Notes banner by default (User Settings)
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
// What an undo step did, for its pill: marks added, erased, or a text mark
// edited or moved (one replaced by another).
function describeChange(change: MarkChange) {
  const added = change.added[0]
  if (change.added.length && change.removed.length) return 'text edit'
  if (!added)
    return change.removed.length > 1
      ? 'erase'
      : change.removed[0]?.mark.kind === 'text'
        ? 'text removed'
        : 'erase'
  if (added.kind === 'text') return 'text'
  return added.tool === 'highlighter' ? 'highlight' : 'pen stroke'
}

// An open text box (Phase 17): a new one (original null) or an existing
// text mark being edited, which is hidden while its box is open.
type TextEdit = {
  key: string
  x: number
  y: number
  layer: number
  size: number
  italic?: boolean
  text: string
  original: TextMark | null
}
// Where a text mark (or its box) sits: its left edge at x, its first line's
// box one size above the baseline, at its size (a percent of the page's
// width, so cqw on the page-wide text layer), wrapping at the page's edge.
function textBoxStyle(m: { x: number; y: number; size: number }): CSSProperties {
  return {
    left: `${m.x * 100}%`,
    top: `calc(${m.y * 100}% - ${m.size}cqw)`,
    fontSize: `${m.size}cqw`,
    maxWidth: `calc(${(1 - m.x) * 100}% - 1cqw)`,
    // Not the app's Cabin tracking (body's 0.02em, inherited as a fixed
    // 0.32px), which would set a note tighter or looser with the screen and
    // so wrap it differently: plain Quintessential, as annotated PDFs draw it.
    letterSpacing: 'normal',
  }
}
// How far above the keyboard an open text box stays, in px.
const LIFT_GAP = 16

// The page's text marks, as real text over it (plan: DOM elements, through
// MarkdownText with the :shortcode: symbols), in Quintessential. Hidden
// colors' text shows as a ghost like any mark. With the Text tool picked
// (onDrag), a text mark takes the pointer: a tap edits it, a drag moves it.
// Children (the open text box) share its page-wide container.
function TextMarks({
  marks,
  hidden,
  ghosts,
  look,
  drag,
  onDrag,
  children,
}: {
  marks: TextMark[]
  hidden: number[]
  ghosts: boolean
  look: PageLook
  drag: { id: string; dx: number; dy: number } | null
  onDrag?: {
    start: () => void
    move: (id: string, dx: number, dy: number) => void
    end: (m: TextMark, dx: number, dy: number, moved: boolean) => void
    cancel: () => void
  }
  children?: ReactNode
}) {
  const press = useRef<{ x: number; y: number; moved: boolean; dx: number; dy: number } | null>(
    null,
  )
  const shown = ghosts ? marks : marks.filter((m) => !hidden.includes(m.layer))
  return (
    <div className="pointer-events-none absolute inset-0" style={{ containerType: 'inline-size' }}>
      {shown.map((m) => {
        const ghost = hidden.includes(m.layer)
        const live = onDrag && !ghost
        const at = drag?.id === m.id ? { ...m, x: m.x + drag.dx, y: m.y + drag.dy } : m
        return (
          <div
            key={m.id}
            data-text-mark={m.id}
            className={`absolute w-max [overflow-wrap:anywhere] ${
              live ? 'pointer-events-auto cursor-move touch-none' : ''
            }`}
            style={{
              ...textBoxStyle(at),
              lineHeight: TEXT_LINE_HEIGHT,
              color: ghost ? '#7a746e' : layerColor(m.layer, look),
              opacity: ghost ? GHOST_OPACITY : 1,
              fontStyle: m.italic ? 'italic' : undefined,
            }}
            onPointerDown={
              live
                ? (event) => {
                    event.stopPropagation()
                    if (event.button !== 0) return
                    onDrag.start()
                    event.currentTarget.setPointerCapture(event.pointerId)
                    press.current = {
                      x: event.clientX,
                      y: event.clientY,
                      moved: false,
                      dx: 0,
                      dy: 0,
                    }
                  }
                : undefined
            }
            onPointerMove={
              live
                ? (event) => {
                    const p = press.current
                    const page = event.currentTarget.parentElement?.getBoundingClientRect()
                    if (!p || !page?.width) return
                    const mx = event.clientX - p.x
                    const my = event.clientY - p.y
                    if (!p.moved && Math.hypot(mx, my) < 8) return
                    p.moved = true
                    p.dx = mx / page.width
                    p.dy = my / page.height
                    onDrag.move(m.id, p.dx, p.dy)
                  }
                : undefined
            }
            onPointerUp={
              live
                ? (event) => {
                    event.stopPropagation()
                    const p = press.current
                    press.current = null
                    if (p) onDrag.end(m, p.dx, p.dy, p.moved)
                  }
                : undefined
            }
            onPointerCancel={
              live
                ? () => {
                    press.current = null
                    onDrag.cancel()
                  }
                : undefined
            }
          >
            {/* Paragraphs (a blank line) sit 0.5em apart — MarkdownText's
                0.5rem, at the mark's own size, so the gap scales with the
                text on every screen, as annotated PDFs draw it. */}
            <MarkdownText className="font-hand! [&_:is(p,ul,ol)]:mb-[0.5em]">{m.text}</MarkdownText>
          </div>
        )
      })}
      {children}
    </div>
  )
}

// The page's marks over it, in each layer's color for the page's look. A
// hidden layer's marks stay as a faint gray ghost (H2) in Play and
// Annotate, so hiding never reads as "nothing here"; in Annotate each ghost
// is a 48pt tap area that shows its layer again (I). Those taps never turn
// the page. The stroke being drawn, and the eraser's reach while it's down,
// draw on top.
function PageMarks({
  marks,
  live,
  eraserAt,
  eraserRadius,
  hidden,
  ghosts,
  aspect,
  look,
  onShowLayer,
}: {
  marks: Mark[]
  live: StrokeMark | null
  eraserAt: [number, number] | null
  eraserRadius: number
  hidden: number[]
  // Hidden colors' marks as faint ghosts; off (User Settings), not at all.
  ghosts: boolean
  aspect: number
  look: PageLook
  onShowLayer?: (layer: number) => void
}) {
  const w = MARKS_W
  const h = w / aspect
  const shown = ghosts ? marks : marks.filter((m) => !hidden.includes(m.layer))
  return (
    <>
      {/* Strokes only; text marks are real text (TextMarks). */}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        {shown.map(
          (m) =>
            m.kind === 'stroke' && (
              <MarkShape
                key={m.id}
                mark={m}
                ghost={hidden.includes(m.layer)}
                look={look}
                aspect={aspect}
              />
            ),
        )}
        {live && (
          <MarkShape
            mark={live}
            ghost={hidden.includes(live.layer)}
            look={look}
            aspect={aspect}
            live
          />
        )}
        {eraserAt && (
          <circle
            cx={eraserAt[0] * w}
            cy={eraserAt[1] * h}
            r={eraserRadius * w}
            fill="rgb(122 116 110 / 0.12)"
            stroke="#7a746e"
            strokeWidth={1.5}
          />
        )}
      </svg>
      {onShowLayer &&
        shown.map((m) => {
          if (!hidden.includes(m.layer)) return null
          const [x, y] = markAnchor(m)
          return (
            <button
              key={m.id}
              type="button"
              data-hit
              aria-label={`Show ${LAYER_COLORS[m.layer].name}`}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
              onClick={() => onShowLayer(m.layer)}
              className="absolute size-12 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full hover:bg-ink/5"
              style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
            />
          )
        })}
    </>
  )
}

// One mark. Its own component, so a finished stroke's outline is worked
// out once (the compiler keeps it) rather than again on every frame of the
// stroke being drawn.
const MARKS_W = 1000
// Ghost marks: warm grey at 12% on every page look (tuned in the ghost
// playground, https://claude.ai/artifact/Sjh9udhJz2mLTLuZf2CrSS).
const GHOST_OPACITY = 0.12
function MarkShape({
  mark: m,
  ghost,
  look,
  aspect,
  live = false,
}: {
  mark: Mark
  ghost: boolean
  look: PageLook
  aspect: number
  live?: boolean
}) {
  const w = MARKS_W
  const color = ghost ? '#7a746e' : layerColor(m.layer, look)
  if (m.kind === 'text') return null
  const highlight = m.tool === 'highlighter'
  return (
    <path
      d={strokePath(m, w, aspect, !live)}
      fill={color}
      opacity={ghost ? GHOST_OPACITY : highlight ? (look === 'dark' ? 0.55 : 0.42) : 1}
      // Highlighter: multiplied on light pages, screened on dark ones.
      style={
        highlight && !ghost ? { mixBlendMode: look === 'dark' ? 'screen' : 'multiply' } : undefined
      }
    />
  )
}

// On screen it's drawn half again as large as the printed page (picked from
// a side-by-side, https://claude.ai/artifact/WRq89mAWk6oVYk4N595MGS, option
// B): print size read small on a stand. Margins and the optical lift stay
// the page's; the column widens to 400pt. The Setlist PDF is unchanged.
const PLACEHOLDER_SCALE = 1.5
const PLACEHOLDER_COLUMN = 400
const ps = (n: number) => pt(n * PLACEHOLDER_SCALE)
function PlaceholderPage({ entry }: { entry: CustomEntry }) {
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
          <span className="font-sans uppercase" style={smallCaps}>
            {entry.role}
          </span>
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
              <p
                className="font-sans"
                style={{
                  fontSize: ps(12 * 1.08),
                  letterSpacing: '0.02em',
                  lineHeight: 1.4,
                  color: PRINT_FAINT,
                  width: pt(PLACEHOLDER_COLUMN),
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
