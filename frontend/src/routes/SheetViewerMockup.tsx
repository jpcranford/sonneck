import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  IconAdjustmentsHorizontal,
  IconArrowBackUp,
  IconBallpen,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconClef,
  IconClock,
  IconClockOff,
  IconDots,
  IconEraser,
  IconHighlight,
  IconInfoCircle,
  IconMetronome,
  IconPencil,
  IconPhotoCog,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconStopwatch,
  IconTypography,
  IconX,
} from '@tabler/icons-react'
import { getPiece, getPieceThumbnailUrl, searchPieces } from '../api/pieces'
import { Checkbox } from '../components/Checkbox'
import { InfoTooltip } from '../components/InfoTooltip'
import { SingleSelect } from '../components/SingleSelect'
import { useShortcutBlocker } from '../lib/shortcuts'
import { useMockupTitle } from '../lib/useMockupTitle'

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

// Debounced turns (locked plan rule): a turn in the same direction within
// this long of the last one is ignored; the opposite direction always fires.
const DEBOUNCE_MS = 500
const CLOSE_CONFIRM_MS = 3000
const HINT_MS = 1800

function subscribeResize(callback: () => void) {
  window.addEventListener('resize', callback)
  return () => window.removeEventListener('resize', callback)
}
function useWindowWidth() {
  return useSyncExternalStore(subscribeResize, () => window.innerWidth)
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
function stopwatchText(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
}
const clockFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function HitButton({
  label,
  onClick,
  children,
  faceClassName = '',
  disabled,
  title,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  faceClassName?: string
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      data-hit
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className={`${HIT} group/b disabled:opacity-50`}
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
  const navigate = useNavigate()
  const width = useWindowWidth()
  const tier = width >= 1100 ? 'wide' : width >= 640 ? 'mid' : 'phone'

  const [pieceId, setPieceId] = useState<number | null>(null)
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
  const pageCount = piece?.pageCount ?? 1

  const [page, setPage] = useState(1)
  const [mode, setMode] = useState<'play' | 'annotate'>('play')
  const [tool, setTool] = useState<Tool | null>(null)
  const [color, setColor] = useState(0)
  const [menu, setMenu] = useState<'clock' | 'more' | null>(null)
  const [closeArmed, setCloseArmed] = useState(false)
  const [hint, setHint] = useState<{ text: string; id: number } | null>(null)
  const [showZones, setShowZones] = useState(false)
  const [showHits, setShowHits] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)

  const [clockOn, setClockOn] = useState(true)
  const [clockMode, setClockMode] = useState<ClockMode>('clock')
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
      : clockFormat.format(now)

  const last = useRef({ dir: 0, at: 0 })
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
      flash('Ignored: same direction within 0.5 s')
      return
    }
    last.current = { dir, at: t }
    const next = Math.max(1, Math.min(pageCount, page + dir))
    if (next === page) {
      flash(dir < 0 ? 'First page' : 'Last page')
      return
    }
    setPage(next)
  }
  const turnRef = useRef(turn)
  useEffect(() => {
    turnRef.current = turn
  })

  // Page-turner pedals pair as keyboards sending this fixed set (plan:
  // hardcoded, no remapping). Space/Enter would also press whichever
  // toolbar button last took focus, so the viewer claims them.
  const menuOpen = menu !== null
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || menuOpen) return
      const target = event.target as Element | null
      if (target?.closest('input, textarea, select, [role="listbox"]')) return
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

  const down = useRef<{ x: number; y: number } | null>(null)
  function onStagePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const start = down.current
    down.current = null
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) return
    if (mode === 'annotate' && tool) {
      flash('Marking the page arrives in Phase 15')
      return
    }
    // Side thirds (Phase 1): left third back, right third forward; the
    // middle column splits top (back) from bottom (forward).
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    const dir = x < 1 / 3 ? -1 : x > 2 / 3 ? 1 : y < 0.5 ? -1 : 1
    turn(dir)
  }

  const closeButton = (
    <HitButton
      label={closeArmed ? 'Tap again to close' : 'Close'}
      onClick={pressClose}
      faceClassName={closeArmed ? 'bg-danger-fill px-3 font-medium text-white' : ''}
    >
      {closeArmed ? 'Close?' : <IconX size={22} />}
    </HitButton>
  )

  const ClockIcon = !clockOn ? IconClockOff : clockMode === 'stopwatch' ? IconStopwatch : IconClock
  const clockButton = (
    <div className="relative">
      <HitButton label="Clock" onClick={() => setMenu(menu === 'clock' ? null : 'clock')}>
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

  const inlineExtras = tier === 'wide'
  const extras = (
    <>
      <SoonButton label="Metronome" message="Metronome: coming soon">
        <IconMetronome size={22} />
      </SoonButton>
      <SoonButton label="Theory reference" message="Theory reference: coming soon">
        <IconClef size={22} />
      </SoonButton>
      <HitButton
        label="Photo filters"
        title="Photo filters (Phase 5)"
        onClick={() => flash('Photo filters are designed in Phase 5')}
      >
        <IconPhotoCog size={22} />
      </HitButton>
      <HitButton
        label="Info"
        title="Info: your notes, practice status, piece details (Phases 3–4)"
        onClick={() => flash('The Info drawer is designed in Phases 3–4')}
      >
        <IconInfoCircle size={22} />
      </HitButton>
    </>
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
      <HitButton label="Undo" onClick={() => flash('Undo arrives with marking (Phase 15)')}>
        <IconArrowBackUp size={22} />
      </HitButton>
    </>
  )
  const toolsInline = tier === 'wide'

  const annotating = mode === 'annotate'
  const sc = piece
  const credit = sc
    ? [
        ...sc.composer.values.map((p) => p.name),
        ...sc.arranger.values.map((p) => `arr. ${p.name}`),
      ].join(', ')
    : ''

  return (
    <div
      data-hits={showHits}
      className="group/sv fixed inset-0 flex flex-col bg-paper font-sans text-ink select-none"
    >
      <header
        className={`relative z-20 shrink-0 border-b pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] ${
          annotating
            ? 'border-accent/30 bg-accent-soft [--sv-hover:var(--color-accent-soft-hover)]'
            : 'border-border bg-paper-raised [--sv-hover:var(--color-paper-hover)]'
        }`}
      >
        {/* Three columns, the outer two equal, so the cyclers in the middle
            sit at exactly the same spot in Play and Annotate (Phase 1). */}
        <div className="relative z-40 grid h-14 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-1">
          <div className="flex min-w-0 items-center">
            {closeButton}
            {annotating ? (
              toolsInline ? (
                <>
                  <span className="mx-1 h-7 w-px shrink-0 bg-accent/30" />
                  {toolButtons}
                </>
              ) : (
                <span className="truncate px-2 text-sm font-medium text-accent">Annotating</span>
              )
            ) : (
              <div className="flex min-w-0 flex-col px-2">
                <span className="truncate font-display font-medium">{sc?.title ?? 'Loading…'}</span>
                {tier !== 'phone' && credit && (
                  <span className="truncate text-xs text-ink-soft">{credit}</span>
                )}
              </div>
            )}
          </div>
          {cyclers}
          <div className="flex min-w-0 items-center justify-end">
            {!annotating && (
              <>
                {tier !== 'phone' && clockButton}
                {inlineExtras && extras}
                {!inlineExtras && (
                  <div className="relative">
                    <HitButton
                      label="More"
                      onClick={() => setMenu(menu === 'more' ? null : 'more')}
                    >
                      <IconDots size={22} />
                    </HitButton>
                  </div>
                )}
                <span className="mx-1 h-7 w-px shrink-0 bg-border" />
                <HitButton
                  label="Annotate"
                  onClick={enterAnnotate}
                  faceClassName={
                    tier === 'phone'
                      ? ''
                      : 'border border-border px-3 font-medium hover:border-accent'
                  }
                >
                  <IconPencil size={20} />
                  {tier !== 'phone' && 'Annotate'}
                </HitButton>
              </>
            )}
            {annotating && (
              <HitButton
                label="Done annotating"
                onClick={leaveAnnotate}
                faceClassName={`bg-accent-fill text-white group-hover/b:bg-accent-fill/90 ${tier === 'phone' ? '' : 'px-3 font-medium'}`}
              >
                <IconCheck size={20} />
                {tier !== 'phone' && 'Done'}
              </HitButton>
            )}
          </div>
        </div>
        {annotating && !toolsInline && (
          <div className="flex items-center overflow-x-auto border-t border-accent/30 px-1">
            {toolButtons}
          </div>
        )}

        {menu && (
          <>
            {/* Under the toolbar row (z-40), so its buttons still work —
                tapping the clock or ⋯ again closes its menu — and over the
                score, so a tap there only closes the menu, never turns. */}
            <div className="fixed inset-0 z-30" onPointerDown={() => setMenu(null)} />
            {menu === 'clock' && (
              <div className="absolute top-full right-2 z-50 mt-1.5 w-72 rounded-xl border border-border bg-paper-raised p-2 shadow-xl [--sv-hover:var(--color-paper-hover)]">
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
                          clockMode === m
                            ? 'bg-paper-raised font-medium shadow-sm'
                            : 'text-ink-soft'
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
                        {swStart !== null ? (
                          <IconPlayerPause size={20} />
                        ) : (
                          <IconPlayerPlay size={20} />
                        )}
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
                <button
                  type="button"
                  data-hit
                  className={`${HIT} w-full group/b`}
                  onClick={() => setClockOn(!clockOn)}
                >
                  <span className={`${FACE} ${FACE_HOVER} w-full justify-start px-3 gap-2.5`}>
                    {clockOn ? <IconClockOff size={20} /> : <IconClock size={20} />}
                    {clockOn ? 'Hide clock' : 'Show clock'}
                  </span>
                </button>
              </div>
            )}
            {menu === 'more' && (
              <div className="absolute top-full right-2 z-50 mt-1.5 w-72 rounded-xl border border-border bg-paper-raised p-2 shadow-xl [--sv-hover:var(--color-paper-hover)]">
                {tier === 'phone' && (
                  <MenuRow
                    icon={<ClockIcon size={20} />}
                    label="Clock"
                    trailing={clockOn ? <ClockText text={readout} /> : 'Hidden'}
                    onClick={() => setMenu('clock')}
                  />
                )}
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
                <MenuRow
                  icon={<IconPhotoCog size={20} />}
                  label="Photo filters"
                  onClick={() => {
                    setMenu(null)
                    flash('Photo filters are designed in Phase 5')
                  }}
                />
                <MenuRow
                  icon={<IconInfoCircle size={20} />}
                  label="Info"
                  onClick={() => {
                    setMenu(null)
                    flash('The Info drawer is designed in Phases 3–4')
                  }}
                />
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
        {/* Plain white mat (plan: launch default), dimmed with the page in
            the dark theme by score-page. */}
        <div className="score-page absolute inset-0 flex items-center justify-center bg-white pb-[env(safe-area-inset-bottom)]">
          {activeId !== null && (
            <img
              key={`${activeId}-${page}`}
              src={getPieceThumbnailUrl(activeId, page)}
              alt={`Page ${page}`}
              draggable={false}
              className="block max-h-full max-w-full object-contain"
            />
          )}
        </div>
        {showZones && (mode === 'play' || !tool) && <ZoneOverlay />}
        {/* Mockup-only controls; they stop their own pointer events so
            using them never turns a page. */}
        <div
          className="absolute top-3 left-3 z-10 flex flex-col items-start gap-2"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
        >
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
                  setPieceId(Number(v))
                  setPage(1)
                }}
              />
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
                a pedal. The ✕ needs two taps.
              </p>
            </div>
          )}
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
