import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  IconArrowLeft,
  IconChevronLeft,
  IconChevronRight,
  IconClef,
  IconClock,
  IconClockOff,
  IconContrast,
  IconDots,
  IconInfoCircle,
  IconMetronome,
  IconMinus,
  IconPencil,
  IconPhotoCog,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconStopwatch,
  IconSun,
} from '@tabler/icons-react'
import { ApiError } from '../api/client'
import { getConfig } from '../api/config'
import { getPiece, getPiecePageUrl, preparePiecePages } from '../api/pieces'
import { getUserSettings } from '../api/userSettings'
import { InfoTooltip } from '../components/InfoTooltip'
import { Toggle } from '../components/Toggle'
import { useAnchoredPanel } from '../hooks/useAnchorRect'
import { hasPermission, useAuth } from '../lib/AuthContext'
import { useShortcutBlocker } from '../lib/shortcuts'
import { useDarkScoresSync, useThemeSync } from '../lib/theme'
import { usePageTitle } from '../lib/usePageTitle'

// The Sheet Viewer (design doc §13; plan phases in memory): a full-screen
// mode for reading a piece — the score, and a toolbar that's always there.
// Built from /mockup/sheet-viewer (SheetViewerMockup.tsx), which stays the
// design's reference. Phase 9 of its plan: real pages, turning (tap zones,
// pedal keys, debounced), the clock, photo filters and the edge margin.
// Info and Annotate show as coming soon until their phases; nothing here is
// saved yet (practice settings arrive with Phase 10).
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

// A turn in the same direction within this long of the last one is ignored
// (an accidental double tap or a bouncing pedal); the opposite direction
// always fires, and every turn resets both.
const DEBOUNCE_MS = 500
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
function useWindowWidth() {
  return useSyncExternalStore(subscribeResize, () => window.innerWidth)
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
function stopwatchText(ms: number) {
  const s = Math.floor(ms / 1000)
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
  const navigate = useNavigate()
  const width = useWindowWidth()
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
  const [menu, setMenu] = useState<'clock' | 'more' | 'photo' | null>(null)
  const [photo, setPhotoState] = useState<Photo>(PHOTO_DEFAULT)
  const [closeArmed, setCloseArmed] = useState(false)
  const [hint, setHint] = useState<{ text: string; id: number } | null>(null)

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
      ? stopwatchText(swAcc + (swStart !== null ? now - swStart : 0))
      : (showSeconds ? clockFormatSeconds : clockFormat).format(now)

  function setPhoto(change: Partial<Photo>) {
    setPhotoState({ ...photo, ...change })
  }
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
    if (dir === last.current.dir && t - last.current.at < DEBOUNCE_MS) return
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

  const down = useRef<{ x: number; y: number } | null>(null)
  function onStagePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const start = down.current
    down.current = null
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) return
    // Side thirds: left third back, right third forward; the middle column
    // splits top (back) from bottom (forward).
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    turn(x < 1 / 3 ? -1 : x > 2 / 3 ? 1 : y < 0.5 ? -1 : 1)
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

  const ClockIcon = !clockOn ? IconClockOff : clockMode === 'stopwatch' ? IconStopwatch : IconClock
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
        {clockMode === 'clock' && switchRow('Show seconds', showSeconds, setShowSeconds)}
        <button
          type="button"
          data-hit
          className={`${HIT} w-full group/b`}
          onClick={() => setClockOn(!clockOn)}
        >
          <span className={`${FACE} ${FACE_HOVER} w-full justify-start gap-2.5 px-3`}>
            {clockOn ? <IconClockOff size={20} /> : <IconClock size={20} />}
            {clockOn ? 'Hide clock' : 'Show clock'}
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

  // The Sheet Viewer's switch row (design D): label first, lined up with
  // the icon rows' text (12px padding + 20px icon + 10px gap), the 44×26
  // switch at the right edge; the whole 48pt row flips it.
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
        className="z-50 rounded-xl border border-border bg-paper px-3 pt-3 pb-2 font-sans text-ink shadow-xl select-none [--sv-hover:var(--color-paper-hover)]"
      >
        {stepperRow('Brightness', IconSun, photo.brightness, (v) => setPhoto({ brightness: v }))}
        {stepperRow('Contrast', IconContrast, photo.contrast, (v) => setPhoto({ contrast: v }))}
        {switchRow('Grayscale', photo.grayscale, (v) => setPhoto({ grayscale: v }))}
        {switchRow(
          'Invert',
          invertLocked ? true : photo.invert,
          (v) => setPhoto({ invert: v }),
          invertLocked,
        )}
        {invertLocked && (
          <p className="-mt-1 pr-3 pb-1 pl-[42px] text-xs text-ink-muted">
            Dark Mode Scores already inverts the pages.
          </p>
        )}
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

  const infoButton = (
    <SoonButton label="Info" message="Info (your notes, practice status and details): coming soon">
      <IconInfoCircle size={22} />
    </SoonButton>
  )
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
      <div className="relative h-full w-full">
        {windowPages.map((p) => {
          const url = pageUrl(p)
          if (failed[url]) return null
          return (
            <img
              key={`${url}#${attempt}`}
              src={url}
              alt={p === page ? `Page ${p} of ${piece?.title ?? ''}` : ''}
              aria-hidden={p === page ? undefined : true}
              draggable={false}
              onLoad={(event) => {
                // Decoded before it can show, so a turn never waits on it.
                event.currentTarget
                  .decode()
                  .catch(() => {})
                  .then(() => setReady((r) => ({ ...r, [url]: true })))
              }}
              onError={() => setFailed((f) => ({ ...f, [url]: true }))}
              className={`absolute inset-0 m-auto block max-h-full max-w-full object-contain ${
                p === page && ready[url] ? '' : 'opacity-0'
              }`}
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
        className="relative min-h-0 flex-1 cursor-default touch-manipulation overflow-hidden"
        onPointerDown={(event) => {
          if (event.button === 0) down.current = { x: event.clientX, y: event.clientY }
        }}
        onPointerUp={onStagePointerUp}
        onPointerCancel={() => {
          down.current = null
        }}
      >
        {/* A plain white mat. Its filter is set here, not by index.css's
            score-page rules, so the theme's treatment and the photo filters
            compose in one list (scoreFilter). The edge margin keeps the page
            clear of the screen's edges. */}
        <div
          style={{ filter: scoreFilter }}
          className={`absolute inset-0 bg-white ${
            photo.margin
              ? 'p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]'
              : 'pb-[env(safe-area-inset-bottom)]'
          }`}
        >
          {stage}
        </div>
        {hint && (
          <div
            key={hint.id}
            className="pointer-events-none absolute top-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-scrim/90 px-4 py-2 text-sm whitespace-nowrap text-white"
          >
            {hint.text}
          </div>
        )}
      </main>
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
