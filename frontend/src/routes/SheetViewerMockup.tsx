import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  IconAdjustmentsHorizontal,
  IconArrowBackUp,
  IconBallpen,
  IconBan,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheckFilled,
  IconCircleDashed,
  IconCircleHalf2,
  IconClef,
  IconClock,
  IconClockOff,
  IconDots,
  IconEraser,
  IconHighlight,
  IconHourglassEmpty,
  IconInfoCircle,
  IconMetronome,
  IconNotebook,
  IconPencil,
  IconPhotoCog,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconStopwatch,
  IconTypography,
  IconX,
} from '@tabler/icons-react'
import { getPiece, getPieceThumbnailUrl, searchPieces } from '../api/pieces'
import { Checkbox } from '../components/Checkbox'
import { InfoTooltip } from '../components/InfoTooltip'
import { MarkdownText } from '../components/MarkdownText'
import { SingleSelect } from '../components/SingleSelect'
import { Toggle } from '../components/Toggle'
import { useAnchoredPanel } from '../hooks/useAnchorRect'
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

// Practice statuses in practice order, by their durable icon (the real
// strip reads the viewer's own list; this mockup writes nothing).
const STATUSES = [
  { name: 'Want to Learn', Icon: IconCircleDashed },
  { name: 'Learning', Icon: IconCircleHalf2 },
  { name: 'Learned', Icon: IconCircleCheckFilled },
  { name: 'Stalled', Icon: IconHourglassEmpty },
  { name: 'Dropped', Icon: IconBan },
]
// Shown when the picked piece has no notes of its own yet.
const EXAMPLE_NOTES =
  '**Big picture:** keep it moving; the middle section is a waltz, not a ballad.\nOct 12 — first time through at tempo. Left hand still heavy in the bridge.'
// Phase 3: notes are broad strokes and practice-log entries; markings on the
// music itself belong in Annotate.
const EMPTY_NOTES =
  'Nothing yet. Big picture notes go here: what to remember about this piece, or a log of how practice is going. Markings on the music can be made in Annotate mode.'
const INFO_WIDTH = 380

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  return `${m}:${String(seconds % 60).padStart(2, '0')}`
}
// The notes bar shows the first line as plain text.
function firstLine(markdown: string) {
  return (markdown.split('\n').find((l) => l.trim()) ?? '').replace(/[*_`#>]/g, '').trim()
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
// The stopwatch always shows seconds — without them it sat at 00:00 for its
// first minute and read as broken.
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
  // Below 900px the labeled Annotate button doesn't fit (beside the clock
  // and Info with the cyclers centered; on a phone, beside the title, Info
  // and ⋯), so it's an icon there.
  const annotateLabel = width >= 900

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
  const [menu, setMenu] = useState<'clock' | 'more' | 'info' | null>(null)
  // Info (Phases 3–4). Everything here is local to the mockup: edits,
  // statuses and the bar's on/off are kept per piece but never written.
  const [notesOverride, setNotesOverride] = useState<Record<number, string>>({})
  const [statusOverride, setStatusOverride] = useState<Record<number, string | null>>({})
  const [barHidden, setBarHidden] = useState<Record<number, boolean>>({})
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
      ? stopwatchText(swAcc + (swStart !== null ? now - swStart : 0))
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
  const showBar = notes !== '' && activeId !== null && !barHidden[activeId] && menu === null

  const last = useRef({ dir: 0, at: 0 })
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
    <div ref={clockAnchorRef} className="relative">
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

  // Centered under the clock and kept on screen at the edges. Portaled to
  // <body>, so it sits over the backdrop that closes it.
  const clockMenuStyle = useAnchoredPanel(clockAnchorRef, menu === 'clock', 'below-center', {
    gap: 6,
    panelWidth: 288,
  })
  const clockMenu =
    menu === 'clock' &&
    clockMenuStyle &&
    createPortal(
      <div
        style={clockMenuStyle}
        className="z-50 w-72 rounded-xl border border-border bg-paper-raised p-2 shadow-xl [--sv-hover:var(--color-paper-hover)]"
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
            {clockOn ? <IconClockOff size={20} /> : <IconClock size={20} />}
            {clockOn ? 'Hide clock' : 'Show clock'}
          </span>
        </button>
      </div>,
      document.body,
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
    </>
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
      className={`pointer-events-none absolute top-[11px] right-[11px] size-[9px] rounded-full bg-accent-fill ring-2 ${mode === 'annotate' ? 'ring-accent-soft' : 'ring-paper-raised'}`}
    />
  )
  const infoButton = (
    <div ref={infoAnchorRef} className="relative">
      <HitButton
        label="Info"
        title="Info: your notes, practice status and the piece’s details"
        onClick={() => openInfo(!infoOpen)}
        faceClassName={infoOpen ? 'bg-accent-soft text-accent' : ''}
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
    setBarHidden({ ...barHidden, [activeId]: !visible })
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
    <div className="flex flex-col gap-5 px-4 pt-1 pb-5">
      <section className="flex flex-col gap-2">
        <div className="flex min-h-12 items-center">
          <h3 className={sectionLabel}>Your notes</h3>
          <span className="flex-1" />
          {notes && !editing && activeId !== null && (
            <>
              <HitButton label="Edit your notes" onClick={startEdit}>
                <IconPencil size={20} />
              </HitButton>
            </>
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
            <div className="rounded-xl border border-accent/40 bg-paper px-4 py-3 text-base leading-relaxed select-text">
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
                className={`${HIT} -mx-2 -mt-1`}
                onClick={(event) => {
                  if (event.target === event.currentTarget) setBar(!!barHidden[activeId])
                }}
              >
                <Toggle
                  row
                  checked={!barHidden[activeId]}
                  onChange={setBar}
                  label="Show in notes bar"
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
      <section className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <h3 className={sectionLabel}>Practice status</h3>
          <span className="text-sm font-medium">{status ?? 'None'}</span>
        </div>
        {/* Tap a status to set it, the current one again to clear it. */}
        <div className="-ml-1 flex" role="group" aria-label="Practice status">
          {STATUSES.map(({ name, Icon }) => (
            <HitButton
              key={name}
              label={name}
              onClick={() => {
                if (activeId === null) return
                setStatusOverride({ ...statusOverride, [activeId]: status === name ? null : name })
              }}
              faceClassName={
                status === name
                  ? 'border border-accent bg-accent-soft text-accent'
                  : 'border border-border text-ink-soft group-hover/b:bg-(--sv-hover)'
              }
            >
              <Icon size={20} />
            </HitButton>
          ))}
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
    <div className="flex shrink-0 items-center border-b border-border pr-1">
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
            className={`fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl border-t border-border bg-paper-raised pb-[env(safe-area-inset-bottom)] shadow-2xl [--sv-hover:var(--color-paper-hover)] ${
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
                className={`${HIT} mt-2 flex-1 justify-start pl-4`}
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
            className="z-50 flex max-h-[calc(100dvh-5.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-paper-raised shadow-xl [--sv-hover:var(--color-paper-hover)]"
          >
            {infoHeader(<h2 className="flex-1 pl-4 font-display text-base font-medium">Info</h2>)}
            <div className="min-h-0 overflow-y-auto overscroll-contain">{infoBody}</div>
          </div>,
          document.body,
        ))

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

  const annotateButton = (
    <HitButton
      label="Annotate"
      onClick={enterAnnotate}
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
            : 'border-border bg-paper-raised [--sv-hover:var(--color-paper-hover)]'
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
                {annotating ? (
                  <span className="min-w-0 flex-1 truncate px-2 text-sm font-medium text-accent">
                    Annotating
                  </span>
                ) : (
                  <div className="flex min-w-0 flex-1 flex-col px-2">
                    <span className="truncate font-display font-medium">
                      {sc?.title ?? 'Loading…'}
                    </span>
                    {credit && <span className="truncate text-xs text-ink-soft">{credit}</span>}
                  </div>
                )}
                {infoButton}
                {moreButton}
                <span
                  className={`mx-1 h-7 w-px shrink-0 ${annotating ? 'bg-accent/30' : 'bg-border'}`}
                />
                {annotating ? doneButton : annotateButton}
              </div>
              <div
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
                    <span className="truncate font-display font-medium">
                      {sc?.title ?? 'Loading…'}
                    </span>
                    {credit && <span className="truncate text-xs text-ink-soft">{credit}</span>}
                  </div>
                )}
              </div>
              {cyclers}
              <div className="flex min-w-0 items-center justify-end">
                {!annotating && (
                  <>
                    {clockButton}
                    {inlineExtras && extras}
                    {infoButton}
                    {!inlineExtras && moreButton}
                    <span className="mx-1 h-7 w-px shrink-0 bg-border" />
                    {annotateButton}
                  </>
                )}
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
            {menu === 'more' && (
              <div className="absolute top-full right-2 z-50 mt-1.5 w-72 rounded-xl border border-border bg-paper-raised p-2 shadow-xl [--sv-hover:var(--color-paper-hover)]">
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
        {/* The notes bar (Phase 3): your notes' first line over the top of
            the page; tap it for Info, ✕ hides it for this piece (Info's
            "Show in notes bar" brings it back). Its own taps never turn. */}
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
                <span className="truncate text-[15px]">{firstLine(notes)}</span>
              </span>
            </button>
            <HitButton label="Hide the notes bar for this piece" onClick={() => setBar(false)}>
              <IconX size={18} />
            </HitButton>
          </div>
        )}
        {/* Mockup-only controls; they stop their own pointer events so
            using them never turns a page. */}
        <div
          className={`absolute ${showBar ? 'top-15' : 'top-3'} left-3 z-10 flex flex-col items-start gap-2`}
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
                  setEditing(false)
                }}
              />
              <label className="flex items-center gap-2">
                <Checkbox checked={hasNotes} onChange={(e) => setHasNotes(e.target.checked)} />
                Piece has notes
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
                a pedal. The ✕ needs two taps.
              </p>
            </div>
          )}
        </div>
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
