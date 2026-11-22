import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Link, Navigate } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconGripVertical,
  IconListCheck,
  IconPlayerPlayFilled,
  IconPlaylistAdd,
  IconPlus,
  IconX,
} from '@tabler/icons-react'
import { getPieceThumbnailUrl } from '../api/pieces'
import { listPracticeStatuses } from '../api/lookups'
import {
  addToPracticeList,
  getPracticeDashboard,
  getPracticeList,
  removeFromPracticeList,
  reorderPracticeList,
  refreshAfterPracticed,
  setPracticed,
  type PracticeListEntry,
} from '../api/practiceList'
import { getSetlist, listSetlists } from '../api/setlists'
import type { Piece, PracticeStatusItem, Setlist } from '../api/types'
import { getUserSettings, updateUserSettings, type UserSettings } from '../api/userSettings'
import { PieceContextMenu } from '../components/PieceContextMenu'
import { PracticeStatusIcon } from '../components/PracticeStatusIcon'
import { AppFooter } from '../components/AppFooter'
import { useDismiss } from '../hooks/useDismiss'
import { useFitToScreen } from '../hooks/useFitToScreen'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useThumbnailVersion } from '../hooks/useThumbnailVersion'
import { useToday } from '../hooks/useToday'
import { hasPermission, useAuth } from '../lib/AuthContext'
import { cancelImageOnUnmount } from '../lib/cancelImageOnUnmount'
import { daysUntil, formatDateOnly } from '../lib/dateOnly'
import { confirmAction, showAlert } from '../lib/dialogs'
import { personCreditPart } from '../lib/joinNames'
import { CONTENT_MAX_W } from '../lib/layout'
import { estimateTotal } from '../lib/setlistEstimate'
import { usePageTitle } from '../lib/usePageTitle'

// The Practice Dashboard (/practice), the sidebar's Practice. Ported from
// routes/PracticeDashboardMockup.tsx (layout A3 of
// https://claude.ai/artifact/AadkReodCUoqEqNqS8Acjn, boxes from
// https://claude.ai/artifact/SFrqyBdvMYGjLY6hLpR3Bg):
// - Left, scrolling: gigs under 4 weeks away (countdown cards), then the
//   shelves — Currently Practicing, Other Recently Played, Recently Added,
//   Favorites, Want to Learn, Learned — each from GET
//   /api/practice/dashboard, sorted and capped there.
// - Right, pinned on a wide screen: the week (the last 7 days, or this week
//   toward a target — Customize, saved per account) over the Practice List.
// Narrow, it's one column: gigs, week, list, shelves. Needs `practice`.

const GIG_WINDOW_DAYS = 28
/** The Practice List drawer's handles: a press that moves less than this is
 * a tap; a drag past DRAG_COMMIT opens (or closes) the drawer on release,
 * anything between drops it back. */
const TAP_SLOP = 6
const DRAG_COMMIT = 60
/** The drawer's handle sits this far below its top edge: dragging the tab
 * up, the drawer is placed so the handle stays under the finger. */
const HANDLE_GRAB = 13
/** Empty drawer below the list, hidden behind the bar: dragging the tab up
 * past the drawer's full height uncovers it rather than lifting the drawer
 * off the bar. The drawer stops rising once it's all showing. */
const OVERSHOOT = 120
/** What an expanded shelf shows; the server sends no more than this. */
const EXPANDED_CAP = 16
/** Marks a drag that carries a piece from a shelf (not a file, which the
 * app-wide drop-to-upload takes, nor a link). */
const PIECE_DRAG_TYPE = 'application/x-sonneck-piece'

// ---------------------------------------------------------------------
// Dates

/** Whole days from `iso` ('YYYY-MM-DD') to `today`. */
function daysAgo(iso: string, today: string): number {
  return -daysUntil(iso, today)
}

/** The local calendar day of a timestamp. */
function localDay(timestamp: string): string {
  const d = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** "Today", "Yesterday", a weekday within the week, else "Nov 3". */
function dayLabel(iso: string, today: string): string {
  const n = daysAgo(iso, today)
  if (n <= 0) return 'Today'
  if (n === 1) return 'Yesterday'
  return n < 7
    ? formatDateOnly(iso, { weekday: 'long' })
    : formatDateOnly(iso, { month: 'short', day: 'numeric' })
}

/** `iso` moved by `n` days. */
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d + n)
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatMinutes(seconds: number): string {
  const m = Math.round(seconds / 60)
  return m < 60 ? `about ${m} min` : `about ${Math.floor(m / 60)} h ${m % 60} min`
}

/** The browser locale's first day of the week, for a week start left to
 * follow it. */
function localeWeekStart(): 'sunday' | 'monday' {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number }
      weekInfo?: { firstDay: number }
    }
    const firstDay = locale.getWeekInfo?.().firstDay ?? locale.weekInfo?.firstDay
    return firstDay === 1 ? 'monday' : 'sunday'
  } catch {
    return 'sunday'
  }
}

// ---------------------------------------------------------------------
// The week: the last 7 days, or this week toward a target

function DayCircle({
  iso,
  practiced,
  today,
  future,
}: {
  iso: string
  practiced: boolean
  today: boolean
  future: boolean
}) {
  const letter = formatDateOnly(iso, { weekday: 'narrow' })
  const title = formatDateOnly(iso, { weekday: 'long', month: 'long', day: 'numeric' })
  // Today is a dashed accent circle until it's practiced, then fills like
  // any other day; days still to come (target mode) are faint. The dashes
  // are an SVG stroke whose pattern divides the circumference evenly — a
  // CSS dashed border on a circle this small splits unevenly.
  if (today && !practiced) {
    const r = 13.25
    const dash = (2 * Math.PI * r) / 12
    return (
      <span
        title={title}
        className="relative flex size-7 items-center justify-center text-xs font-semibold text-accent"
      >
        <svg viewBox="0 0 28 28" className="absolute inset-0" aria-hidden="true">
          <circle
            cx="14"
            cy="14"
            r={r}
            fill="none"
            strokeWidth="1.5"
            strokeDasharray={`${dash * 0.55} ${dash * 0.45}`}
            transform="rotate(-90 14 14)"
            className="stroke-accent"
          />
        </svg>
        {letter}
      </span>
    )
  }
  const look = practiced
    ? 'border-accent-fill bg-accent-fill text-white'
    : future
      ? 'border-border text-ink-faint'
      : 'border-accent-muted text-accent'
  return (
    <span
      title={title}
      className={`flex size-7 items-center justify-center rounded-full border-[1.5px] text-xs font-semibold ${look}`}
    >
      {letter}
    </span>
  )
}

function TargetRing({ done, target }: { done: number; target: number }) {
  const r = 22
  const c = 2 * Math.PI * r
  const filled = (c * Math.min(done, target)) / target
  return (
    <svg
      viewBox="0 0 54 54"
      className="size-[54px] shrink-0"
      aria-label={`${done} of ${target} days`}
    >
      <circle cx="27" cy="27" r={r} fill="none" strokeWidth="6" className="stroke-paper-sunken" />
      <circle
        cx="27"
        cy="27"
        r={r}
        fill="none"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${c}`}
        transform="rotate(-90 27 27)"
        className="stroke-accent-fill"
      />
      <text
        x="27"
        y="27.5"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-ink font-display text-[13px] font-bold"
      >
        {done}/{target}
      </text>
    </svg>
  )
}

type WeekSettings = Pick<
  UserSettings,
  'practiceHistoryMode' | 'practiceTargetDays' | 'practiceWeekStart'
>

function WeekBox({
  today,
  practicedDays,
  settings,
  onSettings,
}: {
  today: string
  practicedDays: Set<string>
  settings: WeekSettings
  onSettings: (s: Partial<WeekSettings>) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useDismiss(open, wrapRef, () => setOpen(false))
  const weekStart = settings.practiceWeekStart || localeWeekStart()
  const daily = settings.practiceHistoryMode === 'daily'

  let days: string[]
  if (daily) {
    days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))
  } else {
    const [y, m, d] = today.split('-').map(Number)
    const weekday = new Date(y, m - 1, d).getDay() // 0 = Sunday
    const back = weekStart === 'monday' ? (weekday + 6) % 7 : weekday
    days = Array.from({ length: 7 }, (_, i) => addDays(today, i - back))
  }
  const done = days.filter((d) => d <= today && practicedDays.has(d)).length
  const target = settings.practiceTargetDays
  const lastDay = formatDateOnly(days[6], { weekday: 'long' })

  return (
    <div className="rounded-lg border border-border bg-paper-raised p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold tracking-wider text-ink-soft uppercase">
          {daily ? 'Last 7 days' : 'This week'}
        </span>
        <div ref={wrapRef} className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="cursor-pointer text-sm text-accent hover:underline"
          >
            Customize
          </button>
          {open && (
            <div className="absolute top-full right-0 z-20 mt-2 flex w-72 flex-col gap-3 rounded-lg border border-border bg-paper-raised p-4 shadow-lg">
              <span className="text-xs font-semibold tracking-wider text-ink-soft uppercase">
                Practice history
              </span>
              {(
                [
                  ['daily', 'Every day', 'The last 7 days, each circle filled when you practiced.'],
                  ['target', 'A weekly target', 'This week, toward a number of days.'],
                ] as const
              ).map(([mode, label, hint]) => (
                <label key={mode} className="flex cursor-pointer gap-2 text-sm">
                  <input
                    type="radio"
                    name="week-mode"
                    checked={settings.practiceHistoryMode === mode}
                    onChange={() => onSettings({ practiceHistoryMode: mode })}
                    className="mt-1 accent-accent-fill"
                  />
                  <span>
                    <span className="font-medium text-ink">{label}</span>
                    <span className="block text-xs text-ink-soft">{hint}</span>
                    {mode === 'target' && (
                      <span className="mt-2 flex items-center gap-2 text-xs text-ink-soft">
                        <span className="inline-flex items-center overflow-hidden rounded-md border border-border">
                          <button
                            type="button"
                            aria-label="Fewer days"
                            disabled={target <= 1}
                            onClick={() =>
                              onSettings({
                                practiceHistoryMode: 'target',
                                practiceTargetDays: target - 1,
                              })
                            }
                            className="cursor-pointer bg-paper-sunken px-2 py-0.5 disabled:opacity-40"
                          >
                            −
                          </button>
                          <span className="px-2 text-ink tabular-nums">{target}</span>
                          <button
                            type="button"
                            aria-label="More days"
                            disabled={target >= 7}
                            onClick={() =>
                              onSettings({
                                practiceHistoryMode: 'target',
                                practiceTargetDays: target + 1,
                              })
                            }
                            className="cursor-pointer bg-paper-sunken px-2 py-0.5 disabled:opacity-40"
                          >
                            +
                          </button>
                        </span>
                        days a week
                      </span>
                    )}
                  </span>
                </label>
              ))}
              <div className="flex items-center gap-2 text-xs text-ink-soft">
                Week starts
                <span className="inline-flex overflow-hidden rounded-md border border-border">
                  {(['sunday', 'monday'] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => onSettings({ practiceWeekStart: d })}
                      className={`cursor-pointer px-2.5 py-1 capitalize ${
                        weekStart === d ? 'bg-accent-soft font-semibold text-accent' : ''
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {daily ? (
        <>
          <div className="flex gap-1.5">
            {days.map((d) => (
              <DayCircle
                key={d}
                iso={d}
                practiced={practicedDays.has(d)}
                today={d === today}
                future={false}
              />
            ))}
          </div>
          <p className="mt-3 text-sm text-ink-soft">Practiced {done} of the last 7 days</p>
        </>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex gap-1.5">
              {days.map((d) => (
                <DayCircle
                  key={d}
                  iso={d}
                  practiced={d <= today && practicedDays.has(d)}
                  today={d === today}
                  future={d > today}
                />
              ))}
            </div>
            <p className="text-sm text-ink-soft">
              {done >= target ? 'Target met' : `${target - done} to go by ${lastDay}`}
            </p>
          </div>
          <TargetRing done={done} target={target} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Gig card: the countdown, the setlist, and its own Practice

function GigCard({
  setlist,
  today,
  pieceIds,
  onList,
  onAddMissing,
}: {
  setlist: Setlist & { gigDate: string }
  today: string
  /** The set's pieces, in its order, once loaded (custom entries have none). */
  pieceIds: number[] | undefined
  onList: Set<number>
  onAddMissing: (ids: number[]) => void
}) {
  const days = daysUntil(setlist.gigDate, today)
  const missing = (pieceIds ?? []).filter((id) => !onList.has(id))
  const addLabel = missing.length
    ? `Add ${missing.length} missing ${missing.length === 1 ? 'piece' : 'pieces'} to the Practice List`
    : 'All of this set’s pieces are on the Practice List'
  return (
    <div className="relative flex items-center gap-[19px] rounded-lg border border-gig-border bg-gig p-4 hover:border-accent">
      <div className="w-16 shrink-0 text-center">
        {days === 0 ? (
          <div className="font-display text-xl leading-tight font-bold text-gig-ink">Today</div>
        ) : (
          <>
            <div className="font-display text-4xl leading-none font-bold text-gig-ink tabular-nums">
              {days}
            </div>
            <div className="mt-1 text-[0.68rem] font-semibold tracking-wider text-gig-ink uppercase">
              {days === 1 ? 'day' : 'days'}
            </div>
          </>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* The whole card opens Setlist Details: the name's link covers it
            (a real link, so it can open in a new tab), under Practice. */}
        <Link
          to={`/setlists/${setlist.id}`}
          state={{ backLabel: 'Practice' }}
          className="font-display text-lg leading-snug font-bold text-ink after:absolute after:inset-0 after:content-['']"
        >
          {setlist.name}
        </Link>
        <div className="text-sm text-ink-soft">
          {formatDateOnly(setlist.gigDate, { weekday: 'long', month: 'long', day: 'numeric' })}
          {setlist.totalDurationSeconds ? ` • ${formatMinutes(setlist.totalDurationSeconds)}` : ''}
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/setlists/${setlist.id}/play`}
            className="relative z-10 inline-flex items-center gap-1.5 rounded-md bg-accent-fill px-3 py-1.5 font-display text-sm font-medium text-white hover:bg-accent-fill/90"
          >
            <IconPlayerPlayFilled size={13} />
            Practice
          </Link>
          {/* Small beside Practice: the set's pieces not yet on the
              Practice List, added in the set's order. Once they're all on
              it, a quiet check in the same place, so Practice never moves.
              Practice's height either way, so the card never changes
              height when it's done; only its width follows what it shows. */}
          {pieceIds && pieceIds.length > 0 && (
            <button
              type="button"
              disabled={missing.length === 0}
              onClick={() => onAddMissing(missing)}
              aria-label={addLabel}
              title={addLabel}
              className="relative z-10 inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1 px-2 rounded-md border border-gig-border bg-paper-raised text-sm leading-none font-medium text-accent tabular-nums hover:border-accent disabled:cursor-default disabled:text-ink-faint disabled:hover:border-gig-border"
            >
              {missing.length ? (
                <>
                  <IconPlaylistAdd size={16} />+{missing.length}
                </>
              ) : (
                <IconListCheck size={16} />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// Shelves

function ShelfCard({
  piece,
  detail,
  showStatus,
  onList,
  canAdd,
  onAdd,
  onRemove,
  onDragStart,
  onDragEnd,
}: {
  piece: Piece
  detail: string
  showStatus: boolean
  onList: boolean
  canAdd: boolean
  onAdd: () => void
  onRemove: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const thumbVersion = useThumbnailVersion()
  return (
    <PieceContextMenu piece={piece} hideTriggerButton openDetailsBackLabel="Practice">
      <Link
        to={`/pieces/${piece.id}`}
        state={{ backLabel: 'Practice' }}
        draggable={canAdd && !onList}
        onDragStart={(e: DragEvent) => {
          if (!canAdd || onList) return
          e.dataTransfer.setData(PIECE_DRAG_TYPE, String(piece.id))
          e.dataTransfer.effectAllowed = 'copy'
          onDragStart()
        }}
        onDragEnd={onDragEnd}
        className="shelf-card group relative flex w-36 shrink-0 cursor-pointer flex-col gap-1.5"
      >
        <div
          className={`relative aspect-[180/132] overflow-hidden rounded-md border border-border ${
            onList ? 'bg-paper' : 'bg-border group-hover:border-accent'
          }`}
        >
          {/* Faded over the paper, not the grey card fill (--onlist-fade). */}
          <img
            src={getPieceThumbnailUrl(piece.id, piece.thumbnailPage, thumbVersion(piece.fileHash))}
            alt=""
            loading="lazy"
            draggable={false}
            ref={cancelImageOnUnmount}
            className={`score-page h-full w-full object-cover object-top ${
              onList ? 'opacity-(--onlist-fade)' : ''
            }`}
          />
          {showStatus && piece.practiceStatus && (
            <span
              className={`absolute bottom-1.5 left-1.5 flex max-w-[calc(100%-0.75rem)] items-center gap-1 rounded-full border border-accent/30 bg-accent-soft px-1.5 py-px text-[0.65rem] font-medium text-accent ${
                onList ? 'opacity-55' : ''
              }`}
            >
              <PracticeStatusIcon status={piece.practiceStatus} size={10} className="shrink-0" />
              <span className="truncate">{piece.practiceStatus}</span>
            </span>
          )}
          {onList ? (
            <button
              type="button"
              aria-label={`Remove ${piece.title} from the Practice List`}
              title="On the Practice List (click to remove)"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onRemove()
              }}
              className="absolute top-1.5 right-1.5 flex size-5 cursor-pointer items-center justify-center rounded-full border border-accent-muted bg-accent-soft text-accent hover:border-accent-fill hover:bg-accent-fill hover:text-white"
            >
              <IconCheck size={12} stroke={3} />
            </button>
          ) : (
            canAdd && (
              <button
                type="button"
                aria-label={`Add ${piece.title} to the Practice List`}
                title="Add to Practice List"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onAdd()
                }}
                className="absolute top-1.5 right-1.5 flex size-6 cursor-pointer items-center justify-center rounded-full bg-accent-fill text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 focus-visible:opacity-100 touch:opacity-100"
              >
                <IconPlus size={15} stroke={2.5} />
              </button>
            )
          )}
        </div>
        <div className={onList ? 'opacity-55' : ''}>
          <p className="truncate font-display text-sm font-medium text-ink">{piece.title}</p>
          <p className="truncate text-xs text-ink-soft">{detail}</p>
        </div>
      </Link>
    </PieceContextMenu>
  )
}

/** A shelf's row: scrolls sideways, fading out at an edge with more beyond
 * it rather than clipping, so it reads as running on under the rail. On a
 * wide screen it reaches halfway into the gap before the rail. */
function ShelfRow({
  children,
  onOverflow,
}: {
  children: ReactNode
  /** Told whether the row holds more than fits, for Show more. */
  onOverflow: (overflows: boolean) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: false, end: false })
  const onOverflowRef = useRef(onOverflow)
  useEffect(() => {
    onOverflowRef.current = onOverflow
  })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      setEdges({
        start: el.scrollLeft > 1,
        end: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
      })
      onOverflowRef.current(el.scrollWidth > el.clientWidth + 1)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [])
  const fade = 40
  const mask = `linear-gradient(to right, ${edges.start ? 'transparent' : 'black'} 0, black ${fade}px, black calc(100% - ${fade}px), ${edges.end ? 'transparent' : 'black'} 100%)`
  return (
    <div
      ref={ref}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
      className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 lg:-mr-3 lg:pr-3"
    >
      {children}
    </div>
  )
}

/** The end of a shelf with a page of its own: a faint link straight on the
 * page — a raised round arrow button level with the pages beside it, its
 * italic label just under it — like a music or streaming app's end-of-row
 * link. */
function SeeAllLink({ to }: { to: string }) {
  return (
    <Link to={to} className="group flex w-16 shrink-0 justify-center">
      <div className="flex h-[105.6px] items-center">
        <span className="relative flex size-10 items-center justify-center rounded-full border border-border bg-paper-raised text-ink-soft group-hover:border-accent-fill group-hover:bg-accent-fill group-hover:text-white">
          <IconArrowRight size={20} />
          <span className="absolute top-full left-1/2 mt-1.5 -translate-x-1/2 text-sm whitespace-nowrap text-ink-faint italic">
            See all
          </span>
        </span>
      </div>
    </Link>
  )
}

/** One shelf: its heading with Show more / Show less, then the sideways
 * row or, expanded, the same cards wrapped onto rows (same size and
 * spacing either way). A shelf with a page of its own ends with See all in
 * both — unless it already holds every piece that page would list. Show more shows only when the row holds more than fits; every
 * visit starts collapsed. */
function Shelf({ title, seeAll, cards }: { title: string; seeAll?: string; cards: ReactNode[] }) {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const link = seeAll ? <SeeAllLink key="see-all" to={seeAll} /> : null
  return (
    <section className="flex min-w-0 flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
        {(overflows || expanded) && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-sm text-accent hover:underline"
          >
            {expanded ? 'Show less' : 'Show more'}
            {expanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          </button>
        )}
      </div>
      {expanded ? (
        <div className="flex flex-wrap gap-x-3 gap-y-4 pb-2">
          {cards.slice(0, EXPANDED_CAP)}
          {link}
        </div>
      ) : (
        <ShelfRow onOverflow={setOverflows}>
          {cards}
          {link}
        </ShelfRow>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------
// The page

export function PracticeDashboardPage() {
  const me = useAuth()
  if (!hasPermission(me, 'practice')) return <Navigate to="/" replace />
  return <PracticeDashboard />
}

function PracticeDashboard() {
  const railRef = useRef<HTMLDivElement>(null)
  useFitToScreen(railRef)
  // Wide (lg), the list sits in the pinned column; narrower, it lives in a
  // drawer that unfolds from the bar pinned to the bottom of the screen.
  const isWide = useMediaQuery('(min-width: 64rem)')
  const [drawerOpen, setDrawerOpen] = useState(false)
  // A drag on a handle: the tab above the bar (up, to open) or the drawer's
  // own handle (down, to close). The drawer follows the finger; a tap, or
  // a drag past DRAG_COMMIT px, carries it through.
  const [drag, setDrag] = useState<{ from: 'open' | 'close'; startY: number; y: number } | null>(
    null,
  )
  // The drawer lives above the bar: its box ends at the bar's top edge, so
  // it slides out from behind the bar and only the page above dims.
  const barRef = useRef<HTMLDivElement>(null)
  const [barTop, setBarTop] = useState(() => window.innerHeight)
  const measureBar = () => {
    if (barRef.current) setBarTop(barRef.current.getBoundingClientRect().top)
  }
  useEffect(() => {
    if (!drawerOpen) return
    window.addEventListener('resize', measureBar)
    return () => window.removeEventListener('resize', measureBar)
  }, [drawerOpen])
  const drawerShown = drawerOpen && !isWide
  useEffect(() => {
    if (!drawerShown) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerShown])
  usePageTitle('Practice')
  const today = useToday()
  const queryClient = useQueryClient()

  const { data: dashboard } = useQuery({
    // Under 'pieces', so the piece menu's own changes (status, favorite,
    // edit, delete) refresh the shelves too.
    queryKey: ['pieces', 'practice-dashboard', today],
    queryFn: () => getPracticeDashboard(today),
  })
  const listKey = ['practice-list', today]
  const { data: list = [] } = useQuery({
    queryKey: listKey,
    queryFn: () => getPracticeList(today),
  })
  const { data: setlists = [] } = useQuery({ queryKey: ['setlists'], queryFn: listSetlists })
  const { data: statuses = [] } = useQuery({
    queryKey: ['practice-statuses'],
    queryFn: listPracticeStatuses,
  })
  const { data: settings } = useQuery({ queryKey: ['user-settings'], queryFn: getUserSettings })

  const settingsMutation = useMutation({
    mutationFn: (next: UserSettings) => updateUserSettings(next),
    onMutate: (next) => queryClient.setQueryData(['user-settings'], next),
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['user-settings'] })
      showAlert('Could not save the week’s settings.')
    },
  })

  const refreshDashboard = () =>
    queryClient.invalidateQueries({ queryKey: ['pieces', 'practice-dashboard'] })
  const listFailed = (message: string) => {
    queryClient.invalidateQueries({ queryKey: ['practice-list'] })
    showAlert(message)
  }

  const onList = useMemo(() => new Set(list.map((e) => e.piece.id)), [list])

  // ---- The list's changes. Each shows at once, then is saved; a failure
  // puts back the server's list.
  async function addPiece(id: number, at?: number) {
    if (onList.has(id)) return
    try {
      await addToPracticeList([id])
      if (at !== undefined && at < list.length) {
        const ids = list.map((e) => e.piece.id)
        ids.splice(at, 0, id)
        await reorderPracticeList(ids)
      }
    } catch {
      listFailed('Could not add that piece to your Practice List.')
      return
    }
    queryClient.invalidateQueries({ queryKey: ['practice-list'] })
  }
  // A gig's missing pieces, all at once, in the set's order.
  async function addPieces(ids: number[]) {
    const fresh = ids.filter((id) => !onList.has(id))
    if (!fresh.length) return
    try {
      await addToPracticeList(fresh)
    } catch {
      listFailed('Could not add those pieces to your Practice List.')
      return
    }
    queryClient.invalidateQueries({ queryKey: ['practice-list'] })
  }
  async function removePiece(id: number) {
    queryClient.setQueryData<PracticeListEntry[]>(listKey, (old) =>
      (old ?? []).filter((e) => e.piece.id !== id),
    )
    try {
      await removeFromPracticeList(id)
    } catch {
      listFailed('Could not remove that piece from your Practice List.')
    }
  }
  async function saveOrder(entries: PracticeListEntry[]) {
    queryClient.setQueryData<PracticeListEntry[]>(listKey, entries)
    try {
      await reorderPracticeList(entries.map((e) => e.piece.id))
    } catch {
      listFailed('Could not save the new order.')
    }
  }
  async function togglePracticed(id: number, practiced: boolean) {
    queryClient.setQueryData<PracticeListEntry[]>(listKey, (old) =>
      (old ?? []).map((e) => (e.piece.id === id ? { ...e, practiced } : e)),
    )
    try {
      refreshAfterPracticed(queryClient, id, await setPracticed(id, today, practiced))
    } catch {
      listFailed('Could not save that.')
      return
    }
    queryClient.invalidateQueries({ queryKey: ['practiced', id] })
    refreshDashboard()
  }
  async function clearList() {
    const ok = await confirmAction({
      title: 'Clear the Practice List?',
      message: 'Every piece comes off the list. The pieces themselves aren’t touched.',
      confirmLabel: 'Clear list',
    })
    if (!ok) return
    const ids = list.map((e) => e.piece.id)
    queryClient.setQueryData<PracticeListEntry[]>(listKey, [])
    try {
      for (const id of ids) await removeFromPracticeList(id)
    } catch {
      listFailed('Could not clear your Practice List.')
    }
  }

  // ---- The days practiced: the server's, with today's marks on the list
  // shown at once.
  const practicedDays = useMemo(() => {
    const days = new Set(dashboard?.practiceDays ?? [])
    if (list.some((e) => e.practiced)) days.add(today)
    return days
  }, [dashboard, list, today])

  const gigs = useMemo(
    () =>
      setlists
        .filter((s): s is Setlist & { gigDate: string } => !!s.gigDate && !s.effectiveArchived)
        .filter((s) => {
          const n = daysUntil(s.gigDate, today)
          return n >= 0 && n < GIG_WINDOW_DAYS
        })
        .sort((a, b) => (a.gigDate < b.gigDate ? -1 : 1)),
    [setlists, today],
  )

  // Each gig's pieces, for its add-missing button: the set itself (the
  // same query as Setlist Details, so one primes the other).
  const gigSets = useQueries({
    queries: gigs.map((s) => ({ queryKey: ['setlist', s.id], queryFn: () => getSetlist(s.id) })),
  })
  const gigPieceIds = (i: number) => {
    const entries = gigSets[i]?.data?.entries
    if (!entries) return undefined
    const ids: number[] = []
    for (const e of entries) if (e.piece && !ids.includes(e.piece.id)) ids.push(e.piece.id)
    return ids
  }

  // ---- Shelves
  const [shelfDrag, setShelfDrag] = useState(false)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const iconKeyOf = useMemo(() => {
    const m = new Map<string, PracticeStatusItem['iconKey']>()
    for (const s of statuses) m.set(s.name, s.iconKey)
    return m
  }, [statuses])
  const credit = (p: Piece) =>
    personCreditPart(
      p.composer.values.map((t) => t.name),
      p.arranger.values.map((t) => t.name),
    ) ?? ''

  function cardsFor(
    pieces: Piece[],
    detail: (p: Piece, i: number) => string,
    showStatus: (p: Piece) => boolean,
  ): ReactNode[] {
    return pieces.map((p, i) => (
      <ShelfCard
        key={p.id}
        piece={p}
        detail={detail(p, i)}
        showStatus={showStatus(p)}
        onList={onList.has(p.id)}
        canAdd
        onAdd={() => void addPiece(p.id)}
        onRemove={() => void removePiece(p.id)}
        onDragStart={() => setShelfDrag(true)}
        onDragEnd={() => {
          setShelfDrag(false)
          setDropAt(null)
        }}
      />
    ))
  }

  const shelves: { key: string; title: string; seeAll?: string; cards: ReactNode[] }[] = dashboard
    ? [
        {
          key: 'practicing',
          title: 'Currently Practicing',
          seeAll:
            dashboard.totals.practicing > dashboard.practicing.length ? '/practicing' : undefined,
          // Learning is the shelf's own status; Stalled is worth saying.
          cards: cardsFor(dashboard.practicing, credit, (p) =>
            p.practiceStatus ? iconKeyOf.get(p.practiceStatus) !== 'learning' : false,
          ),
        },
        {
          key: 'played',
          title: 'Other Recently Played',
          cards: cardsFor(
            dashboard.recentlyPlayed.map((r) => r.piece),
            (_, i) => dayLabel(dashboard.recentlyPlayed[i].lastPracticed, today),
            () => true,
          ),
        },
        {
          key: 'added',
          title: 'Recently Added',
          cards: cardsFor(
            dashboard.recentlyAdded,
            (p) => {
              const label = dayLabel(localDay(p.createdAt), today)
              return `Added ${label === 'Today' || label === 'Yesterday' ? label.toLowerCase() : label}`
            },
            () => true,
          ),
        },
        {
          key: 'favorites',
          title: 'Favorites',
          seeAll:
            dashboard.totals.favorites > dashboard.favorites.length ? '/favorites' : undefined,
          cards: cardsFor(dashboard.favorites, credit, () => true),
        },
        {
          key: 'want',
          title: 'Want to Learn',
          seeAll:
            dashboard.totals.wantToLearn > dashboard.wantToLearn.length
              ? '/want-to-learn'
              : undefined,
          cards: cardsFor(dashboard.wantToLearn, credit, () => false),
        },
        {
          key: 'learned',
          title: 'Learned',
          seeAll: dashboard.totals.learned > dashboard.learned.length ? '/learned' : undefined,
          cards: cardsFor(dashboard.learned, credit, () => false),
        },
      ]
    : []
  const visibleShelves = shelves.filter((s) => s.cards.length > 0)

  // ---- The Practice List: reorder by the grip (pointer events captured on
  // the list itself, which never moves), drop-in from a shelf (a mouse drag).
  const listRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef(new Map<number, HTMLDivElement>())
  const [reorder, setReorder] = useState<{ id: number; order: PracticeListEntry[] } | null>(null)
  const shown = reorder?.order ?? list

  function indexAt(clientY: number, ids: number[]): number {
    for (let i = 0; i < ids.length; i++) {
      const el = rowRefs.current.get(ids[i])
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (clientY < r.top + r.height / 2) return i
    }
    return ids.length
  }
  function onGripDown(e: ReactPointerEvent, id: number) {
    e.preventDefault()
    listRef.current?.setPointerCapture(e.pointerId)
    setReorder({ id, order: list })
  }
  function onListPointerMove(e: ReactPointerEvent) {
    if (!reorder) return
    const moving = reorder.order.find((x) => x.piece.id === reorder.id)!
    const others = reorder.order.filter((x) => x.piece.id !== reorder.id)
    const at = indexAt(
      e.clientY,
      others.map((x) => x.piece.id),
    )
    const next = [...others]
    next.splice(at, 0, moving)
    if (next.some((v, i) => v !== reorder.order[i])) setReorder({ id: reorder.id, order: next })
  }
  function endReorder() {
    if (!reorder) return
    const changed = reorder.order.some((v, i) => v.piece.id !== list[i]?.piece.id)
    if (changed) void saveOrder(reorder.order)
    setReorder(null)
  }

  // A piece with no duration counts as the typical length setlists assume
  // (2:30, lib/setlistEstimate.ts), so the list's "about" total isn't short.
  const totalSeconds = estimateTotal(
    list.map((e) => ({ isMusic: true, durationSeconds: e.piece.duration })),
  ).seconds
  const practicedCount = list.filter((e) => e.practiced).length
  const listSummary =
    list.length > 0
      ? `${list.length} ${list.length === 1 ? 'piece' : 'pieces'}${totalSeconds > 0 ? ` • ${formatMinutes(totalSeconds)}` : ''}`
      : 'empty'
  const ghost = (
    <div className="my-0.5 h-9 rounded-md border-[1.5px] border-dashed border-accent bg-accent-soft" />
  )

  const practiceList = (
    <div
      className={`flex min-h-0 flex-1 flex-col ${
        isWide ? 'rounded-lg border border-border bg-paper-raised p-3' : 'px-4 pt-1 pb-3'
      }`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(PIECE_DRAG_TYPE)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDropAt(
          indexAt(
            e.clientY,
            list.map((x) => x.piece.id),
          ),
        )
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null)
      }}
      onDrop={(e) => {
        const id = Number(e.dataTransfer.getData(PIECE_DRAG_TYPE))
        if (!id) return
        e.preventDefault()
        void addPiece(id, dropAt ?? undefined)
        setDropAt(null)
        setShelfDrag(false)
      }}
    >
      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        <span className="text-xs font-semibold tracking-wider text-ink-soft uppercase">
          Practice List
        </span>
        {/* Wide, the header holds Practice; narrow, Practice is on the bar
            right under the drawer, so Clear comes up here, well away from
            it. */}
        {list.length > 0 &&
          (isWide ? (
            <Link
              to="/practice-list/play"
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent-fill px-2.5 font-display text-sm font-medium text-white hover:bg-accent-fill/90"
            >
              <IconPlayerPlayFilled size={11} />
              Practice
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => void clearList()}
              className="cursor-pointer text-sm text-accent hover:underline"
            >
              Clear
            </button>
          ))}
      </div>

      {list.length === 0 && !shelfDrag ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-3 py-6 text-center">
          <p className="font-display font-bold text-ink">Nothing queued yet</p>
          <p className="text-sm text-ink-soft">
            {/* Dragging a piece in needs a mouse, which a narrow screen
                rarely has. */}
            {isWide ? 'Press + on a piece, or drag it here.' : 'Press + on a piece to add it here.'}
          </p>
          <div className="mt-2 w-full rounded-md border-[1.5px] border-dashed border-border p-3 text-xs text-ink-faint">
            Drop pieces here
          </div>
        </div>
      ) : (
        <div
          ref={listRef}
          onPointerMove={onListPointerMove}
          onPointerUp={endReorder}
          onPointerCancel={endReorder}
          className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1"
        >
          {shown.map((entry, i) => {
            const p = entry.piece
            const done = !!entry.practiced
            return (
              <div key={p.id}>
                {dropAt === i && ghost}
                <div
                  ref={(el) => {
                    if (el) rowRefs.current.set(p.id, el)
                    else rowRefs.current.delete(p.id)
                  }}
                  className={`group flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-paper-hover ${
                    reorder?.id === p.id ? 'bg-paper-hover shadow-sm' : ''
                  }`}
                >
                  <span
                    onPointerDown={(e) => onGripDown(e, p.id)}
                    className="flex shrink-0 cursor-grab touch-none text-ink-faint"
                    aria-label="Drag to reorder"
                  >
                    <IconGripVertical size={15} />
                  </span>
                  <Link
                    to={`/pieces/${p.id}`}
                    state={{ backLabel: 'Practice' }}
                    className="flex min-w-0 flex-1 flex-col"
                  >
                    <span
                      className={`truncate font-display text-sm font-medium ${done ? 'text-ink-soft' : 'text-ink'}`}
                    >
                      {p.title}
                    </span>
                    <span className="truncate text-xs text-ink-soft">
                      {personCreditPart(
                        p.composer.map((t) => t.name),
                        p.arranger.map((t) => t.name),
                      )}
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => void togglePracticed(p.id, !done)}
                    title={done ? 'Practiced today (click to unmark)' : 'Mark practiced today'}
                    aria-pressed={done}
                    className={`flex size-[22px] shrink-0 cursor-pointer items-center justify-center rounded-full border-[1.5px] ${
                      done
                        ? 'border-accent-fill bg-accent-fill text-white'
                        : 'border-border text-transparent hover:border-accent'
                    }`}
                  >
                    <IconCheck size={13} stroke={3} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void removePiece(p.id)}
                    aria-label={`Remove ${p.title}`}
                    title="Remove from Practice List"
                    className="shrink-0 cursor-pointer text-ink-faint opacity-0 group-hover:opacity-100 hover:text-ink focus-visible:opacity-100 touch:opacity-100"
                  >
                    <IconX size={15} />
                  </button>
                </div>
              </div>
            )
          })}
          {dropAt === shown.length && ghost}
          {/* How pieces get here, always under the rows; while a piece is
              dragged over it says what letting go does. Text only: the gap
              above is the one drop marker. */}
          <p
            className={`px-1 pt-3 pb-1 text-center text-xs ${
              dropAt != null ? 'text-accent' : 'text-ink-faint'
            }`}
          >
            {dropAt != null
              ? 'Let go to add it where the gap is'
              : isWide
                ? 'Drag pieces here, or press + on a piece'
                : 'Press + on a piece to add it'}
          </p>
        </div>
      )}

      {list.length > 0 && (
        <div className="mt-2 flex items-center justify-between border-t border-border px-1 pt-2 text-xs text-ink-soft">
          <span>
            {list.length} {list.length === 1 ? 'piece' : 'pieces'} • {practicedCount} practiced
            today
          </span>
          <span className="flex items-center gap-2">
            {totalSeconds > 0 && (
              <span className="tabular-nums">{formatMinutes(totalSeconds)}</span>
            )}
            {/* Wide, Clear sits here, since Practice took the header. */}
            {isWide && (
              <button
                type="button"
                onClick={() => void clearList()}
                className="cursor-pointer text-accent hover:underline"
              >
                Clear
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  )

  const weekSettings: WeekSettings = settings ?? {
    practiceHistoryMode: 'daily',
    practiceTargetDays: 4,
    practiceWeekStart: '',
  }

  return (
    <div className={`${CONTENT_MAX_W} flex flex-1 flex-col gap-5 px-4 py-6 md:px-8`}>
      {/* The page's title. Its Practice button lives with the list it
          plays (D of https://claude.ai/artifact/My1kLD9LpjNwCKsDrejseh): in
          the list's header on a wide screen, where the column is pinned, and
          in a bar pinned to the bottom on a narrow one. */}
      <h1 className="font-display text-2xl font-bold text-ink">Practice</h1>

      {/* Narrow: gigs, week + list, shelves. Wide: gigs and shelves on the
          left, the week and list pinned on the right for the whole page.
          With no gig coming up there's no gig row at all, so the shelves
          start level with the week. */}
      <div
        className={`grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] ${
          gigs.length > 0
            ? "[grid-template-areas:'gigs'_'rail'_'shelves'] lg:[grid-template-areas:'gigs_rail'_'shelves_rail']"
            : "[grid-template-areas:'rail'_'shelves'] lg:[grid-template-areas:'shelves_rail']"
        }`}
      >
        {gigs.length > 0 ? (
          <div className="@container [grid-area:gigs]">
            {/* Two across only where the column has room for them. */}
            <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
              {gigs.map((s, i) => (
                <GigCard
                  key={s.id}
                  setlist={s}
                  today={today}
                  pieceIds={gigPieceIds(i)}
                  onList={onList}
                  onAddMissing={addPieces}
                />
              ))}
            </div>
          </div>
        ) : null}

        {/* Pinned on a wide screen, and sized to the room it has there
            (hooks/useFitToScreen): it starts under the title row, so a
            fixed screen-height column ran off the bottom. */}
        <div
          ref={railRef}
          className="flex flex-col gap-4 [grid-area:rail] lg:sticky lg:top-6 lg:h-[calc(100dvh-3rem)] lg:self-start"
        >
          <WeekBox
            today={today}
            practicedDays={practicedDays}
            settings={weekSettings}
            onSettings={(patch) => settings && settingsMutation.mutate({ ...settings, ...patch })}
          />
          {isWide && practiceList}
        </div>

        <div className="flex min-w-0 flex-col gap-6 [grid-area:shelves]">
          {dashboard && visibleShelves.length === 0 && (
            <p className="text-sm text-ink-soft">
              Your shelves fill in as you add pieces, mark them, and practice.
            </p>
          )}
          {visibleShelves.map((s) => (
            <Shelf key={s.key} title={s.title} seeAll={s.seeAll} cards={s.cards} />
          ))}
          {/* The footer mark ends the shelves column rather than the page
              (lib/appFooter.ts' PAGES_WITH_OWN_FOOTER), so the pinned column runs
              the page's full height. */}
          <AppFooter className="mt-6" />
        </div>
      </div>
      {/* Narrow screens: a bar pinned to the bottom of the screen with what
          the list holds and Practice, and on top of it a tab with an up
          arrow — tap it or drag it up and the Practice List rises out of the
          bar as a drawer. Shown even for an empty list, so the drawer (with
          how to add pieces) is always a tap away. */}
      {!isWide && (
        <div
          ref={barRef}
          className="sticky bottom-0 z-10 -mx-4 -mb-6 flex items-center justify-between gap-3 border-t border-border bg-paper-raised px-4 pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom,0px))] md:-mx-8 md:px-8"
        >
          <button
            type="button"
            aria-label="Open the Practice List"
            aria-expanded={drawerShown}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              measureBar()
              setDrag({ from: 'open', startY: e.clientY, y: e.clientY })
            }}
            onPointerMove={(e) => drag?.from === 'open' && setDrag({ ...drag, y: e.clientY })}
            onPointerUp={() => {
              const moved = drag ? drag.startY - drag.y : 0
              if (drag?.from === 'open' && (Math.abs(moved) < TAP_SLOP || moved > DRAG_COMMIT))
                setDrawerOpen(true)
              setDrag(null)
            }}
            onPointerCancel={() => setDrag(null)}
            // Keyboard only: a pointer's tap is handled on pointer up.
            onClick={(e) => {
              if (e.detail !== 0) return
              measureBar()
              setDrawerOpen(true)
            }}
            className={`absolute bottom-[calc(100%-1px)] left-1/2 flex h-6 w-14 -translate-x-1/2 cursor-pointer touch-none items-center justify-center rounded-t-lg border border-b-0 border-border bg-paper-raised text-ink-soft hover:text-ink ${
              // Out of sight while the drawer is out, so the bar's top
              // line runs unbroken under it.
              drawerShown || drag ? 'opacity-0' : ''
            }`}
          >
            <IconChevronUp size={18} stroke={2.25} />
          </button>
          <span className="min-w-0 truncate">
            <span className="font-display text-sm font-bold text-ink">Practice List</span>
            <span className="text-sm text-ink-soft">
              {' · '}
              {listSummary}
            </span>
          </span>
          {list.length > 0 && (
            <Link
              to="/practice-list/play"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent-fill px-3 py-1.5 font-display text-sm font-medium text-white hover:bg-accent-fill/90"
            >
              <IconPlayerPlayFilled size={12} />
              Practice
            </Link>
          )}
        </div>
      )}

      {/* The drawer, over everything above the bar: it rises from behind the
          bar's top edge (its box ends there), with only the page above
          dimmed, so it reads as opening out of the bar. Dragging the tab up,
          the drawer's handle stays under the finger. Tap the page or press
          Escape to close, or tap its handle or drag it down. Kept mounted so
          it slides. */}
      {!isWide &&
        createPortal(
          <div
            className={`fixed inset-x-0 top-0 z-40 overflow-hidden ${drawerShown || drag ? '' : 'pointer-events-none'}`}
            style={{ height: barTop }}
            aria-hidden={!drawerShown}
          >
            <button
              type="button"
              aria-label="Close the Practice List"
              tabIndex={drawerShown ? 0 : -1}
              onClick={() => setDrawerOpen(false)}
              className={`absolute inset-0 cursor-default bg-scrim/40 transition-opacity duration-200 ${
                drawerShown || drag ? 'opacity-100' : 'opacity-0'
              }`}
            />
            <div
              role="dialog"
              aria-label="Practice List"
              style={
                drag
                  ? {
                      // Tailwind's translate-y-* set the `translate`
                      // property, so the drag sets that too (a `transform`
                      // would add to it rather than replace it). Opening,
                      // the handle (HANDLE_GRAB px below the drawer's top)
                      // sits under the finger; closing, the drawer moves
                      // down with it.
                      translate:
                        drag.from === 'open'
                          ? `0 max(-${OVERSHOOT}px, calc(100% - ${Math.max(0, barTop - drag.y + HANDLE_GRAB + OVERSHOOT)}px))`
                          : `0 ${Math.max(0, drag.y - drag.startY)}px`,
                      transition: 'none',
                      bottom: -OVERSHOOT,
                    }
                  : { bottom: -OVERSHOOT }
              }
              className={`absolute inset-x-0 flex max-h-[calc(85%+120px)] flex-col rounded-t-2xl bg-paper-raised shadow-[0_-8px_24px_rgba(28,24,21,0.18)] transition-[translate] duration-200 ease-out ${
                drawerShown ? 'translate-y-0' : 'translate-y-full'
              }`}
            >
              <button
                type="button"
                aria-label="Close the Practice List"
                tabIndex={drawerShown ? 0 : -1}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  setDrag({ from: 'close', startY: e.clientY, y: e.clientY })
                }}
                onPointerMove={(e) => drag?.from === 'close' && setDrag({ ...drag, y: e.clientY })}
                onPointerUp={() => {
                  const moved = drag ? drag.y - drag.startY : 0
                  if (drag?.from === 'close' && (Math.abs(moved) < TAP_SLOP || moved > DRAG_COMMIT))
                    setDrawerOpen(false)
                  setDrag(null)
                }}
                onPointerCancel={() => setDrag(null)}
                onClick={(e) => e.detail === 0 && setDrawerOpen(false)}
                className="flex shrink-0 cursor-pointer touch-none justify-center pt-2.5 pb-1.5"
              >
                <span className="h-1.5 w-10 rounded-full bg-border" />
              </button>
              {practiceList}
              {/* The overshoot room: hidden behind the bar unless a drag
                  pulls the drawer past its full height. */}
              <div aria-hidden="true" className="shrink-0" style={{ height: OVERSHOOT }} />
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
