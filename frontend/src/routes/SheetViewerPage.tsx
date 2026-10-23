import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  IconArrowLeft,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconClef,
  IconClock,
  IconContrast,
  IconDots,
  IconInfoCircle,
  IconMetronome,
  IconMinus,
  IconNotebook,
  IconPencil,
  IconPhotoCog,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconStopwatch,
  IconSun,
  IconX,
} from '@tabler/icons-react'
import { ApiError } from '../api/client'
import { getConfig } from '../api/config'
import { listPracticeStatuses } from '../api/lookups'
import {
  DEFAULT_PRACTICE_SETTINGS,
  getPiece,
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
import { MarkdownText } from '../components/MarkdownText'
import { PracticeStatusKeyIcon } from '../components/PracticeStatusIcon'
import { Toggle } from '../components/Toggle'
import { useAnchoredPanel } from '../hooks/useAnchorRect'
import { useNoPageScroll } from '../hooks/useNoPageScroll'
import { stageTurn, type StagePoint } from '../lib/sheetViewerGestures'
import { hasPermission, useAuth } from '../lib/AuthContext'
import { useShortcutBlocker } from '../lib/shortcuts'
import { sortPracticeStatuses } from '../lib/practiceStatusOrder'
import { useDarkScoresSync, useThemeSync } from '../lib/theme'
import { usePageTitle } from '../lib/usePageTitle'

// The Sheet Viewer (design doc §13; plan phases in memory): a full-screen
// mode for reading a piece — the score, and a toolbar that's always there.
// Built from /mockup/sheet-viewer (SheetViewerMockup.tsx), which stays the
// design's reference. Phases 9–10 of its plan: real pages, turning (tap
// zones, swipes, pedal keys, debounced), the clock, photo filters and the
// edge margin, and Info — your notes, practice status and the piece's
// details — with the notes bar. Settings are saved: the clock's per account,
// the page's look and the notes bar per piece. Annotate shows as coming soon
// until its phase.
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

/** /pieces/:id/play. The whole viewer needs the `practice` permission;
 * without it (a link followed, a typed address) it goes back to the piece. */
export function SheetViewerPage() {
  const { id } = useParams()
  const me = useAuth()
  const pieceId = Number(id)
  if (!Number.isInteger(pieceId) || pieceId < 1) return <Navigate to="/" replace />
  if (!hasPermission(me, 'practice')) return <Navigate to={`/pieces/${pieceId}`} replace />
  return <SheetViewer key={pieceId} pieceId={pieceId} />
}

function SheetViewer({ pieceId }: { pieceId: number }) {
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
  } = useQuery({ queryKey: ['piece', pieceId], queryFn: () => getPiece(pieceId) })
  const { data: config } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  usePageTitle(piece?.title)
  const pageCount = piece?.pageCount ?? 1
  const pageVersion =
    piece && config ? `${piece.fileHash.slice(0, 16)}.${config.pagesVersion}` : undefined

  // Opening the piece starts rendering all its pages, so the ones ahead are
  // ready before they're turned to. Its failure only means each page
  // renders as it's asked for.
  useEffect(() => {
    preparePiecePages(pieceId).catch(() => {})
  }, [pieceId])

  const [page, setPage] = useState(1)
  // Per page URL: decoded and ready to show; failed to load. A retry bumps
  // attempt, which remounts the failed page.
  const [ready, setReady] = useState<Record<string, boolean>>({})
  const [failed, setFailed] = useState<Record<string, boolean>>({})
  const [attempt, setAttempt] = useState(0)
  const [menu, setMenu] = useState<'clock' | 'more' | 'photo' | 'info' | null>(null)
  const [closeArmed, setCloseArmed] = useState(false)
  const [hint, setHint] = useState<{ text: string; id: number } | null>(null)
  const queryClient = useQueryClient()
  const hintTimer = useRef<number | undefined>(undefined)
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
    queryFn: () => getPracticeSettings(pieceId),
  })
  const pendingPractice = useRef<PracticeSettings | null>(null)
  const practiceTimer = useRef<number | undefined>(undefined)
  const flushPractice = useRef(() => {})
  useEffect(() => {
    flushPractice.current = () => {
      window.clearTimeout(practiceTimer.current)
      const next = pendingPractice.current
      pendingPractice.current = null
      if (next)
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

  const last = useRef({ dir: 0, at: 0 })
  const photoAnchorRef = useRef<HTMLDivElement>(null)
  const phoneRow2Ref = useRef<HTMLDivElement>(null)
  const clockAnchorRef = useRef<HTMLDivElement>(null)
  const moreAnchorRef = useRef<HTMLDivElement>(null)
  const infoAnchorRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  useEffect(
    () => () => {
      window.clearTimeout(closeTimer.current)
      window.clearTimeout(hintTimer.current)
    },
    [],
  )

  function turn(dir: -1 | 1) {
    const t = performance.now()
    const guard = settings?.turnGuardMs ?? TURN_GUARD_DEFAULT
    if (dir === last.current.dir && t - last.current.at < guard) {
      flash('Double-turn ignored')
      return
    }
    last.current = { dir, at: t }
    const next = Math.max(1, Math.min(pageCount, page + dir))
    if (next === page) {
      flash(dir < 0 ? 'First page' : 'Last page')
      return
    }
    setPage(next)
    // Pages leaving the preload window unmount; drop their "ready" so one
    // that comes back shows only once it's decoded again.
    const keep = new Set(
      [next - 1, next, next + 1, next + 2].map((p) => getPiecePageUrl(pieceId, p, pageVersion)),
    )
    setReady((r) => Object.fromEntries(Object.entries(r).filter(([url]) => keep.has(url))))
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
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as Element | null
      if (target?.closest('input, textarea, select, [role="listbox"]')) return
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
  // before stay mounted and decoded, stacked in one place with only the
  // current one visible, so a turn just changes which one shows. Pages
  // further away are let go (iPad Safari drops decoded pages it isn't
  // showing anyway; decoding is what a turn costs).
  const windowPages = [page - 1, page, page + 1, page + 2].filter((p) => p >= 1 && p <= pageCount)
  const pageUrl = (p: number) => getPiecePageUrl(pieceId, p, pageVersion)
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
  // address goes to the piece.
  function exit() {
    if ((window.history.state as { idx?: number } | null)?.idx) navigate(-1)
    else navigate(`/pieces/${pieceId}`, { replace: true })
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
    const end = { x: event.clientX, y: event.clientY, t: performance.now() }
    const dir = stageTurn(start, end, event.currentTarget.getBoundingClientRect())
    if (dir) turn(dir)
  }
  function onStagePointerCancel(event: React.PointerEvent<HTMLDivElement>) {
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
  const titleBlock = (
    <div className="flex min-w-0 flex-1 flex-col px-2">
      <span className="truncate font-display font-medium">{piece?.title ?? 'Loading…'}</span>
      {credit && <span className="truncate text-xs text-ink-soft">{credit}</span>}
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
    mutationFn: (next: string) => setPieceUserNotes(pieceId, next || null),
    onSuccess: (updated) => {
      queryClient.setQueryData(['piece', pieceId], updated)
      setEditing(false)
    },
    onError: () => flash('Couldn’t save your notes'),
  })
  const statusMutation = useMutation({
    mutationFn: (status: string | null) => setPiecePracticeStatus(pieceId, status),
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
  const showBar = notes !== '' && practice.notesBarShown && menu === null

  // A dot on Info whenever the piece has notes and Info is closed.
  const infoButton = (
    <div ref={infoAnchorRef} className="relative">
      <HitButton
        label="Info"
        onClick={() => openInfo(!infoOpen)}
        faceClassName={infoOpen ? 'bg-accent-soft text-accent' : ''}
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
                  setPractice({ notesBarShown: !practice.notesBarShown })
              }}
            >
              <Toggle
                row
                checked={practice.notesBarShown}
                onChange={(v) => setPractice({ notesBarShown: v })}
                label="Show in notes bar"
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
    <SoonButton
      label="Annotate"
      message="Annotate: coming soon"
      inset
      faceClassName={annotateLabel ? 'border border-border px-3 font-medium' : ''}
    >
      <IconPencil size={20} />
      {annotateLabel && 'Annotate'}
    </SoonButton>
  )
  const moreButton = (
    <div ref={moreAnchorRef} className="relative">
      <HitButton label="More" onClick={() => setMenu(menu === 'more' ? null : 'more')}>
        <IconDots size={22} />
      </HitButton>
    </div>
  )

  const cyclers = (
    <div className="flex items-center">
      <HitButton label="Previous page" onClick={() => turn(-1)} disabled={page <= 1}>
        <IconChevronLeft size={22} />
      </HitButton>
      <span className="w-[4.5em] text-center text-sm text-ink-soft tabular-nums">
        {page} / {pageCount}
      </span>
      <HitButton label="Next page" onClick={() => turn(1)} disabled={page >= pageCount}>
        <IconChevronRight size={22} />
      </HitButton>
    </div>
  )

  let stage: ReactNode
  if (pieceError) {
    const missing = pieceError instanceof ApiError && pieceError.status === 404
    stage = (
      <StageMessage>
        <p>{missing ? 'That piece isn’t in the library.' : 'This piece couldn’t be opened.'}</p>
        {!missing && <RetryButton onClick={() => refetchPiece()} />}
      </StageMessage>
    )
  } else if (pageVersion) {
    stage = (
      <div ref={measureStage} className="relative h-full w-full">
        {stageBox &&
          windowPages.map((p) => {
            const url = pageUrl(p)
            if (failed[url]) return null
            return (
              <PageCanvas
                key={`${url}#${attempt}`}
                src={url}
                width={stageBox.w}
                height={stageBox.h}
                label={p === page ? `Page ${p} of ${piece?.title ?? ''}` : undefined}
                onReady={() => setReady((r) => ({ ...r, [url]: true }))}
                onError={() => setFailed((f) => ({ ...f, [url]: true }))}
                className={p === page && ready[url] ? '' : 'opacity-0'}
                sharp={zoomed && p === page}
              />
            )
          })}
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
      <header className="relative z-20 shrink-0 border-b border-border bg-paper pt-[max(env(safe-area-inset-top),var(--titlebar-inset))] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] [--sv-hover:var(--color-paper-hover)]">
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
                {titleBlock}
                {infoButton}
                {moreButton}
                <span className="mx-1 h-7 w-px shrink-0 bg-border" />
                {annotateButton}
              </div>
              <div
                ref={phoneRow2Ref}
                className="flex h-14 items-center border-t border-border px-1"
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
                {titleBlock}
              </div>
              {cyclers}
              <div className="flex min-w-0 items-center justify-end">
                {clockButton}
                {inlineExtras && extras}
                {inlineExtras && photoButton}
                {infoButton}
                {!inlineExtras && moreButton}
                <span className="mx-1 h-7 w-px shrink-0 bg-border" />
                {annotateButton}
              </div>
            </div>
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
        className={`relative min-h-0 flex-1 cursor-default overflow-hidden ${zoomed ? 'touch-manipulation' : 'touch-pinch-zoom'}`}
        onPointerDown={onStagePointerDown}
        onPointerUp={onStagePointerUp}
        onPointerCancel={onStagePointerCancel}
        onLostPointerCapture={onStagePointerCancel}
      >
        {/* A plain white mat. Its filter is set here, not by index.css's
            score-page rules, so the theme's treatment and the photo filters
            compose in one list (scoreFilter). The edge margin keeps the page
            clear of the screen's edges. */}
        <div
          style={{ filter: scoreFilter }}
          className={`absolute inset-0 bg-white ${
            photo.edgeMargin
              ? 'p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]'
              : 'pb-[env(safe-area-inset-bottom)]'
          }`}
        >
          {stage}
        </div>
        {/* The notes bar: your notes' first line over the top of the page;
            tap it for Info, ✕ hides it for this piece (Info's "Show in
            notes bar" brings it back). Its own taps never turn. */}
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
              label="Hide the notes bar for this piece"
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

// One page of the preload window, drawn into a canvas at the screen's own
// size when it loads. A turn then only shows a canvas that's already drawn:
// measured on an iPad, showing a hidden 300ppi <img> cost 230–290ms a turn
// (WebKit draws an opacity-0 image only once it's shown, scaling the full
// page down then), a pre-drawn canvas ~30ms. The decoded image is let go
// once drawn. A resize redraws it from the browser's cache.
//
// Its drawing is shown at exactly its own pixel size, or the screen
// resamples it and fine detail goes soft: so its size is a whole number of
// CSS pixels (iPad Safari rounds a 689.5pt-wide canvas up to 690pt —
// stretching a 1379px drawing over 1380 screen pixels, measured from barline
// positions in an iPad screenshot), and it's placed on whole device pixels
// rather than centered with CSS.
//
// Pinch-zoomed in, the drawing alone would only magnify screen pixels, so
// the current page's full 300ppi image is laid over it in the same spot
// (`sharp`) — transparent until loaded — and let go on zooming out, keeping
// memory and turns as they are unzoomed.
function PageCanvas({
  src,
  width,
  height,
  label,
  onReady,
  onError,
  className,
  sharp,
}: {
  src: string
  width: number
  height: number
  label?: string
  onReady: () => void
  onError: () => void
  className: string
  /** Lay the full page over the drawing (pinch-zoomed in). */
  sharp: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  // Where the drawing sits, for the full page laid over it.
  const [placed, setPlaced] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const callbacks = useRef({ onReady, onError })
  useEffect(() => {
    callbacks.current = { onReady, onError }
  })
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !width || !height) return
    let cancelled = false
    const img = new Image()
    img.src = src
    img
      .decode()
      .then(() => {
        if (cancelled) return
        const dpr = window.devicePixelRatio || 1
        // Fit the score area in whole CSS pixels, never past the page's own
        // 300ppi pixels.
        const scale = Math.min(width / img.naturalWidth, height / img.naturalHeight, 1 / dpr)
        const cssWidth = Math.floor(img.naturalWidth * scale)
        const cssHeight = Math.floor(img.naturalHeight * scale)
        const context = canvas.getContext('2d')
        if (!context) throw new Error('no canvas')
        canvas.width = Math.round(cssWidth * dpr)
        canvas.height = Math.round(cssHeight * dpr)
        context.imageSmoothingQuality = 'high'
        context.drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.style.width = `${cssWidth}px`
        canvas.style.height = `${cssHeight}px`
        const area = canvas.parentElement?.getBoundingClientRect()
        if (area) {
          // Centered, then rounded to a device pixel on the screen itself
          // (the score area may start between pixels too).
          const snap = (start: number, room: number, size: number) =>
            Math.round((start + (room - size / dpr) / 2) * dpr) / dpr - start
          const left = snap(area.left, area.width, canvas.width)
          const top = snap(area.top, area.height, canvas.height)
          canvas.style.left = `${left}px`
          canvas.style.top = `${top}px`
          setPlaced({ left, top, width: cssWidth, height: cssHeight })
        }
        callbacks.current.onReady()
      })
      .catch(() => {
        if (!cancelled) callbacks.current.onError()
      })
      .finally(() => {
        img.src = ''
      })
    return () => {
      cancelled = true
    }
  }, [src, width, height])
  return (
    <>
      <canvas
        ref={ref}
        role={label ? 'img' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        className={`absolute block ${className}`}
      />
      {/* Transparent until it loads, so the drawing shows meanwhile. */}
      {sharp && placed && (
        <img
          src={src}
          alt=""
          aria-hidden
          draggable={false}
          style={placed}
          className={`absolute block ${className}`}
        />
      )}
    </>
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
