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
  IconArrowsShuffle,
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
import { Radio } from '../components/Radio'
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
import { useShelfShuffles } from '../lib/shelfShuffle'
import { practiceHeading, type PracticeHeading } from '../lib/practiceHeading'
import { finishTip, tipDone } from '../lib/sheetViewerTips'
import { usePageTitle } from '../lib/usePageTitle'
import { useLockAppScroll } from '../hooks/useLockAppScroll'

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
/** The added-piece nudge: the fly into the tab, then how long the tab stays
 * lit and its message shows. */
const FLY_MS = 450
const NUDGE_MS = 3000
/** The drawer tip's id in lib/sheetViewerTips.ts. */
const DRAWER_TIP = 'practice-list-drawer'
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
  // CSS dashed border on a circle this small splits unevenly. Each day is
  // square at any width (aspect-square, shrinking together where the
  // target ring leaves less room), so every one stays a circle.
  if (today && !practiced) {
    const r = 13.25
    const dash = (2 * Math.PI * r) / 12
    return (
      <span
        title={title}
        className="relative flex aspect-square w-7 min-w-0 shrink items-center justify-center text-xs font-semibold text-accent"
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
      className={`flex aspect-square w-7 min-w-0 shrink items-center justify-center rounded-full border-[1.5px] text-xs font-semibold ${look}`}
    >
      {letter}
    </span>
  )
}

type WeekSettings = Pick<
  UserSettings,
  'practiceHistoryMode' | 'practiceTargetDays' | 'practiceWeekStart'
>

// The week box's seven days: the last seven, or this week from its first
// day (the user's choice, else the locale's).
function weekDaysFor(today: string, settings: WeekSettings): string[] {
  if (settings.practiceHistoryMode === 'daily') {
    return Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))
  }
  const weekStart = settings.practiceWeekStart || localeWeekStart()
  const [y, m, d] = today.split('-').map(Number)
  const weekday = new Date(y, m - 1, d).getDay() // 0 = Sunday
  const back = weekStart === 'monday' ? (weekday + 6) % 7 : weekday
  return Array.from({ length: 7 }, (_, i) => addDays(today, i - back))
}

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
  const days = weekDaysFor(today, settings)
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
                Practice goal
              </span>
              {(
                [
                  ['daily', 'Every day', 'The last 7 days, each circle filled when you practiced.'],
                  ['target', 'A weekly target', 'This week, toward a number of days.'],
                ] as const
              ).map(([mode, label, hint]) => (
                // The radio centers on the title's lowercase letters (mt-1, as
                // in User Settings): centered on the capitals it looked high.
                <label key={mode} className="flex cursor-pointer items-start gap-2 text-sm">
                  <Radio
                    name="week-mode"
                    checked={settings.practiceHistoryMode === mode}
                    onChange={() => onSettings({ practiceHistoryMode: mode })}
                    className="mt-1"
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
          <div className="flex w-full min-w-0 items-center gap-1.5">
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
        // W3 of https://claude.ai/artifact/SFrqyBdvMYGjLY6hLpR3Bg: the
        // days, how many are done and how many to go, and a bar toward the
        // target that stays full once it's met.
        <>
          <div className="flex w-full min-w-0 items-center gap-1.5">
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
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
            <span className="whitespace-nowrap text-ink-soft tabular-nums">
              {done} of {target} {target === 1 ? 'day' : 'days'}
            </span>
            <span className="whitespace-nowrap text-ink-faint">
              {done >= target ? 'Target met' : `${target - done} to go by ${lastDay}`}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="This week's target"
            aria-valuemin={0}
            aria-valuemax={target}
            aria-valuenow={Math.min(done, target)}
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper-sunken"
          >
            <div
              className="h-full rounded-full bg-accent-fill"
              style={{ width: `${(Math.min(done, target) / target) * 100}%` }}
            />
          </div>
        </>
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
  onMenuAdd,
  onRemove,
  onDragStart,
  onDragEnd,
}: {
  piece: Piece
  detail: string
  showStatus: boolean
  onList: boolean
  canAdd: boolean
  /** The + button's box, for the narrow layout's fly into the bar. */
  onAdd: (from: DOMRect) => void
  /** The piece menu's Add to Practice List saved. */
  onMenuAdd: () => void
  onRemove: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const thumbVersion = useThumbnailVersion()
  return (
    <PieceContextMenu
      piece={piece}
      hideTriggerButton
      openDetailsBackLabel="Practice"
      onAddedToPracticeList={onMenuAdd}
    >
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
                  onAdd(e.currentTarget.getBoundingClientRect())
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
function Shelf({
  title,
  seeAll,
  cards,
  shuffled,
  onShuffle,
}: {
  title: string
  seeAll?: string
  cards: ReactNode[]
  /** Random order is on; the button toggles it (a new order each time on). */
  shuffled: boolean
  onShuffle: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const link = seeAll ? <SeeAllLink key="see-all" to={seeAll} /> : null
  return (
    <section className="flex min-w-0 flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={onShuffle}
            aria-pressed={shuffled}
            aria-label={`Random order for ${title}`}
            title={shuffled ? 'Random order (click to turn off)' : 'Random order'}
            className={`flex size-7 cursor-pointer items-center justify-center rounded-full ${
              shuffled
                ? 'bg-accent-fill text-white hover:bg-accent-fill/90'
                : 'text-ink-soft hover:bg-paper-hover hover:text-ink'
            }`}
          >
            <IconArrowsShuffle size={16} />
          </button>
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

// Which slot clientY points at among the rows with these ids (before the
// first row whose middle is below it).
function rowIndexAt(rows: Map<number, HTMLDivElement>, clientY: number, ids: number[]): number {
  for (let i = 0; i < ids.length; i++) {
    const el = rows.get(ids[i])
    if (!el) continue
    const r = el.getBoundingClientRect()
    if (clientY < r.top + r.height / 2) return i
  }
  return ids.length
}

// The list order with the dragged row moved to where clientY points (the
// same object when that's where it already is).
function movedTo(
  rows: Map<number, HTMLDivElement>,
  r: { id: number; order: PracticeListEntry[] },
  clientY: number,
) {
  const moving = r.order.find((x) => x.piece.id === r.id)!
  const others = r.order.filter((x) => x.piece.id !== r.id)
  const at = rowIndexAt(
    rows,
    clientY,
    others.map((x) => x.piece.id),
  )
  const next = [...others]
  next.splice(at, 0, moving)
  return next.some((v, i) => v !== r.order[i]) ? { id: r.id, order: next } : r
}

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
  // The drawer lives above the bar, as wide as it: its box ends at the
  // bar's top edge and spans the bar's width (the content column, beside the
  // sidebar), so it slides out from behind the bar and only the page above
  // dims.
  const barRef = useRef<HTMLDivElement>(null)
  const [barBox, setBarBox] = useState(() => ({
    top: window.innerHeight,
    left: 0,
    width: window.innerWidth,
  }))
  const barTop = barBox.top
  const measureBar = () => {
    if (!barRef.current) return
    const { top, left, width } = barRef.current.getBoundingClientRect()
    setBarBox({ top, left, width })
  }
  useEffect(() => {
    const bar = barRef.current
    if (!drawerOpen || !bar) return
    window.addEventListener('resize', measureBar)
    // The bar also resizes without the window (the sidebar collapsing).
    const observer = new ResizeObserver(measureBar)
    observer.observe(bar)
    return () => {
      window.removeEventListener('resize', measureBar)
      observer.disconnect()
    }
  }, [drawerOpen])
  const drawerShown = drawerOpen && !isWide
  // The page under the open drawer stays put, so the bar it rises from does.
  useLockAppScroll(drawerShown, barRef)
  useEffect(() => {
    if (!drawerShown) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerShown])
  usePageTitle('Practice')
  const today = useToday()
  const queryClient = useQueryClient()

  // Each shelf's random order (lib/shelfShuffle.ts), per device: the
  // server does the picking, so a big shelf draws from all of its view.
  const { seeds: shuffleSeeds, seedOf, toggle: toggleShuffle } = useShelfShuffles()
  const { data: dashboard, isSuccess: dashboardLoaded } = useQuery({
    // Under 'pieces', so the piece menu's own changes (status, favorite,
    // edit, delete) refresh the shelves too.
    queryKey: ['pieces', 'practice-dashboard', today, shuffleSeeds],
    queryFn: () => getPracticeDashboard(today, shuffleSeeds),
    // Turning a shuffle on or off keeps the shelves up until the new ones
    // arrive, rather than blanking the page.
    placeholderData: (previous) => previous,
  })
  const listKey = ['practice-list', today]
  const { data: list = [], isSuccess: listLoaded } = useQuery({
    queryKey: listKey,
    queryFn: () => getPracticeList(today),
  })
  const { data: setlists = [], isSuccess: setlistsLoaded } = useQuery({
    queryKey: ['setlists'],
    queryFn: listSetlists,
  })
  const { data: statuses = [] } = useQuery({
    queryKey: ['practice-statuses'],
    queryFn: listPracticeStatuses,
  })
  const { data: settings } = useQuery({ queryKey: ['user-settings'], queryFn: getUserSettings })
  // User Settings › Sheet Viewer › Track practice. Off, nothing is recorded,
  // so the page leaves out what practiced days drive: the week box, the
  // list's practiced checks and count (the server leaves out Other Recently
  // Played). Unknown until the settings load, so none of it flashes up.
  const tracking = settings?.trackPractice === true

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

  // ---- With the list in a drawer (B, E and F of
  // https://claude.ai/artifact/3WcfhJoJXhAaH7v1cM3SU7): adding a piece says
  // where it went — a small page flies from the card's + into the tab (not
  // with Reduce Motion, nor from a menu or a gig's +N), the tab lights up,
  // and a message offers to show the list.
  const tabRef = useRef<HTMLButtonElement>(null)
  const [fly, setFly] = useState<{ key: number; from: DOMRect; to: DOMRect } | null>(null)
  const [nudge, setNudge] = useState(0)
  const nudgeKey = useRef(0)
  useEffect(() => {
    if (!nudge) return
    const t = window.setTimeout(() => setNudge(0), NUDGE_MS)
    return () => window.clearTimeout(t)
  }, [nudge])
  function addedNudge(from?: DOMRect) {
    if (isWide) return
    nudgeKey.current += 1
    const key = nudgeKey.current
    const to = tabRef.current?.getBoundingClientRect()
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (from && to && !reduced) setFly({ key, from, to })
    else setNudge(key)
  }
  // The first time the list is a drawer on this device, a tip points at the
  // tab, the page above dimmed, until it's dismissed — Got it, a tap on the
  // page, Escape, or opening the drawer — for good (lib/sheetViewerTips.ts,
  // so "Show tips again" brings it back).
  const [tipOpen, setTipOpen] = useState(() => !tipDone(DRAWER_TIP))
  const tipShown = tipOpen && !isWide && !drawerShown
  function closeTip() {
    if (!tipOpen) return
    finishTip(DRAWER_TIP)
    setTipOpen(false)
  }
  useEffect(() => {
    if (!tipShown) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      finishTip(DRAWER_TIP)
      setTipOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [tipShown])
  function openDrawerFromBar() {
    setDrawerOpen(true)
    closeTip()
  }

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

  // The heading (lib/practiceHeading.ts) is picked once, when everything it
  // goes by has loaded, and then kept for the visit: adding, ticking or
  // clearing in the list doesn't change it.
  const [heading, setHeading] = useState<PracticeHeading | null>(null)
  if (heading === null && dashboardLoaded && listLoaded && setlistsLoaded && settings) {
    setHeading(
      practiceHeading({
        today,
        practicedDays,
        weekDays: weekDaysFor(today, settings),
        weekMode: settings.practiceHistoryMode === 'daily' ? 'daily' : 'target',
        weekTarget: settings.practiceTargetDays,
        nextGig: gigs[0] ? { name: gigs[0].name, gigDate: gigs[0].gigDate } : null,
        listLength: list.length,
        trackPractice: settings.trackPractice,
      }),
    )
  }

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
        onAdd={(from) => {
          void addPiece(p.id)
          addedNudge(from)
        }}
        onMenuAdd={() => addedNudge()}
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
  // The card that follows the pointer while a row is dragged (Edit
  // Setlist's): where the pointer is, where it grabbed the row, the row's
  // width. The row itself stays in the list, faded, at the place it'd drop.
  const [dragCard, setDragCard] = useState<{
    x: number
    y: number
    offsetX: number
    offsetY: number
    width: number
  } | null>(null)
  const lastPointerY = useRef(0)

  const indexAt = (clientY: number, ids: number[]) => rowIndexAt(rowRefs.current, clientY, ids)
  function onGripDown(e: ReactPointerEvent, id: number) {
    e.preventDefault()
    const row = rowRefs.current.get(id)?.getBoundingClientRect()
    if (!row) return
    listRef.current?.setPointerCapture(e.pointerId)
    lastPointerY.current = e.clientY
    setReorder({ id, order: list })
    setDragCard({
      x: e.clientX,
      y: e.clientY,
      offsetX: e.clientX - row.left,
      offsetY: e.clientY - row.top,
      width: row.width,
    })
  }
  function onListPointerMove(e: ReactPointerEvent) {
    if (!reorder) return
    lastPointerY.current = e.clientY
    setDragCard((c) => c && { ...c, x: e.clientX, y: e.clientY })
    setReorder(movedTo(rowRefs.current, reorder, e.clientY))
  }
  function endReorder() {
    setDragCard(null)
    if (!reorder) return
    const changed = reorder.order.some((v, i) => v.piece.id !== list[i]?.piece.id)
    if (changed) void saveOrder(reorder.order)
    setReorder(null)
  }
  // Held near the list's top or bottom edge, the list scrolls (the drawer's
  // list is often taller than the screen), moving the row along with it.
  const dragging = reorder != null
  useEffect(() => {
    if (!dragging) return
    document.body.style.cursor = 'grabbing'
    const EDGE = 48
    const SPEED = 10
    const rows = rowRefs.current
    let frame = requestAnimationFrame(function tick() {
      const el = listRef.current
      if (el) {
        const box = el.getBoundingClientRect()
        const y = lastPointerY.current
        const step =
          y < box.top + EDGE
            ? -Math.ceil(((box.top + EDGE - y) / EDGE) * SPEED)
            : y > box.bottom - EDGE
              ? Math.ceil(((y - (box.bottom - EDGE)) / EDGE) * SPEED)
              : 0
        if (step !== 0) {
          const before = el.scrollTop
          el.scrollTop += step
          if (el.scrollTop !== before) setReorder((r) => r && movedTo(rows, r, y))
        }
      }
      frame = requestAnimationFrame(tick)
    })
    return () => {
      cancelAnimationFrame(frame)
      document.body.style.cursor = ''
    }
  }, [dragging])

  // A piece with no duration counts as the typical length setlists assume
  // (2:30, lib/setlistEstimate.ts), so the list's "about" total isn't short.
  const totalSeconds = estimateTotal(
    list.map((e) => ({ isMusic: true, durationSeconds: e.piece.duration })),
  ).seconds
  const practicedCount = list.filter((e) => e.practiced).length
  // The bar beside the tab (which names the list and counts it): the time,
  // and what's practiced today when tracking.
  const barSummary =
    list.length > 0
      ? [
          totalSeconds > 0 ? formatMinutes(totalSeconds) : null,
          tracking ? `${practicedCount} practiced today` : null,
        ]
          .filter(Boolean)
          .join(' • ')
      : 'Nothing queued yet'
  const ghost = (
    <div className="my-0.5 h-9 rounded-md border-[1.5px] border-dashed border-accent bg-accent-soft" />
  )

  // No text selection anywhere in the list (a press on a row, a drag or a
  // long press would otherwise start one), wide or in the drawer.
  const practiceList = (
    <div
      className={`flex min-h-0 flex-1 select-none flex-col ${
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
          className="-mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1"
        >
          {shown.map((entry, i) => {
            const p = entry.piece
            const done = tracking && !!entry.practiced
            return (
              <div key={p.id}>
                {dropAt === i && ghost}
                <div
                  ref={(el) => {
                    if (el) rowRefs.current.set(p.id, el)
                    else rowRefs.current.delete(p.id)
                  }}
                  className={`group flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-paper-hover ${
                    reorder?.id === p.id ? 'opacity-40' : ''
                  }`}
                >
                  {/* The grip's area runs the row's full height and its left
                      padding, wider on a touch screen, so a finger finds it;
                      the rest of the row scrolls the list. */}
                  <span
                    onPointerDown={(e) => onGripDown(e, p.id)}
                    className="-my-1.5 -ml-1 flex shrink-0 cursor-grab touch-none items-center justify-center self-stretch pl-1 text-ink-faint touch:w-9"
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
                  {tracking && (
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
                  )}
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
          {dragCard &&
            reorder &&
            (() => {
              const p = reorder.order.find((x) => x.piece.id === reorder.id)?.piece
              if (!p) return null
              return createPortal(
                <div
                  aria-hidden="true"
                  style={{
                    left: dragCard.x - dragCard.offsetX,
                    top: dragCard.y - dragCard.offsetY,
                    width: dragCard.width,
                  }}
                  className="pointer-events-none fixed z-[9999] flex items-center gap-2 rounded-md border border-accent bg-paper-raised px-1 py-1.5 shadow-xl"
                >
                  <span className="flex shrink-0 text-ink-faint touch:w-9 touch:justify-center">
                    <IconGripVertical size={15} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-display text-sm font-medium text-ink">
                      {p.title}
                    </span>
                    <span className="truncate text-xs text-ink-soft">
                      {personCreditPart(
                        p.composer.map((t) => t.name),
                        p.arranger.map((t) => t.name),
                      )}
                    </span>
                  </span>
                </div>,
                document.body,
              )
            })()}
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
            {list.length} {list.length === 1 ? 'piece' : 'pieces'}
            {tracking && ` • ${practicedCount} practiced today`}
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
      {/* An instruction with a line of help, like the book upload steps;
          the space is held while it's picked, so the page doesn't shift. */}
      <div className="flex min-h-14 flex-col gap-1">
        {heading && (
          <>
            <h1 className="font-display text-2xl font-medium text-ink">{heading.title}</h1>
            <p className="text-sm text-ink-soft">{heading.help}</p>
          </>
        )}
      </div>

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
                  onAddMissing={(ids) => {
                    void addPieces(ids)
                    addedNudge()
                  }}
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
          className="relative z-10 flex flex-col gap-4 [grid-area:rail] lg:sticky lg:top-6 lg:h-[calc(100dvh-3rem)] lg:self-start"
        >
          {tracking && (
            <WeekBox
              today={today}
              practicedDays={practicedDays}
              settings={weekSettings}
              onSettings={(patch) => settings && settingsMutation.mutate({ ...settings, ...patch })}
            />
          )}
          {isWide && practiceList}
        </div>

        <div className="flex min-w-0 flex-col gap-6 [grid-area:shelves]">
          {dashboard && visibleShelves.length === 0 && (
            <p className="text-sm text-ink-soft">
              Your shelves fill in as you add pieces, mark them, and practice.
            </p>
          )}
          {visibleShelves.map((s) => (
            <Shelf
              key={s.key}
              title={s.title}
              seeAll={s.seeAll}
              cards={s.cards}
              shuffled={!!seedOf(s.key)}
              onShuffle={() => toggleShuffle(s.key)}
            />
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
          className="sticky bottom-0 z-10 -mx-4 -mb-6 flex items-center select-none justify-between gap-3 border-t border-border bg-paper-raised px-4 pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom,0px))] md:-mx-8 md:px-8"
        >
          {/* The drawer tip's dimmed page: everything above the bar (the
              scroller clips it to the page), under the tab, which comes
              after it so it stays bright and usable. */}
          {tipShown && (
            <button
              type="button"
              aria-label="Dismiss the tip"
              onClick={closeTip}
              className="absolute inset-x-0 bottom-full h-[100dvh] cursor-default bg-scrim/40"
            />
          )}
          <button
            ref={tabRef}
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
                openDrawerFromBar()
              setDrag(null)
            }}
            onPointerCancel={() => setDrag(null)}
            // Keyboard only: a pointer's tap is handled on pointer up.
            onClick={(e) => {
              if (e.detail !== 0) return
              measureBar()
              openDrawerFromBar()
            }}
            // A pull tab that says what it opens, with the list's count; lit
            // for a moment when a piece goes in.
            className={`absolute bottom-[calc(100%-1px)] left-1/2 flex h-[30px] -translate-x-1/2 cursor-pointer touch-none items-center gap-1.5 rounded-t-[10px] border border-b-0 px-3.5 text-sm font-medium whitespace-nowrap text-ink transition-colors duration-300 ${
              nudge ? 'border-accent bg-accent-soft' : 'border-border bg-paper-raised'
            } ${
              // Out of sight while the drawer is out, so the bar's top
              // line runs unbroken under it.
              drawerShown || drag ? 'opacity-0' : ''
            }`}
          >
            <IconChevronUp size={16} stroke={2.5} className="text-accent" />
            Practice List
            {list.length > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-fill px-1.5 text-xs font-bold text-white tabular-nums">
                {list.length}
              </span>
            )}
          </button>
          {tipShown && (
            <div
              role="dialog"
              aria-label="Tip"
              className="absolute bottom-[calc(100%+44px)] left-1/2 w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border border-accent bg-paper-raised px-3.5 pt-3 pb-2.5 text-sm text-ink-soft shadow-lg"
            >
              <p className="font-display font-bold text-ink">Your Practice List lives here</p>
              <p className="mt-0.5 leading-snug">
                {tracking
                  ? 'Tap the tab or drag it up to see your list, put it in order and check off what you’ve practiced.'
                  : 'Tap the tab or drag it up to see your list and put it in order.'}
              </p>
              <div className="mt-1.5 flex justify-end">
                <button
                  type="button"
                  onClick={closeTip}
                  className="cursor-pointer rounded px-1.5 py-0.5 font-medium text-accent hover:bg-accent-soft"
                >
                  Got it
                </button>
              </div>
              {/* The pointer, toward the tab. */}
              <span
                aria-hidden="true"
                className="absolute -bottom-[7px] left-1/2 size-3 -translate-x-1/2 rotate-45 border-r border-b border-accent bg-paper-raised"
              />
            </div>
          )}
          {nudge > 0 && !drawerShown && !tipShown && (
            <div
              role="status"
              className="absolute bottom-[calc(100%+40px)] left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-scrim px-3 py-2 text-sm whitespace-nowrap text-white shadow-lg"
            >
              Added to your Practice List
              <button
                type="button"
                onClick={() => {
                  setNudge(0)
                  measureBar()
                  openDrawerFromBar()
                }}
                className="cursor-pointer font-bold underline underline-offset-2"
              >
                Show
              </button>
            </div>
          )}
          <span className="min-w-0 truncate text-sm text-ink-soft">{barSummary}</span>
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

      {fly &&
        createPortal(
          <div
            key={fly.key}
            aria-hidden="true"
            ref={(el) => {
              // React calls this again whenever the page redraws (adding
              // the piece redraws it mid-flight); starting again would
              // restart the fly from the card, a second flyover.
              if (!el || el.getAnimations().length > 0) return
              const dx = fly.to.left + fly.to.width / 2 - (fly.from.left + fly.from.width / 2)
              const dy = fly.to.top + fly.to.height / 2 - (fly.from.top + fly.from.height / 2)
              const a = el.animate(
                [
                  { transform: 'translate(0, 0) scale(1)', opacity: 1 },
                  { transform: `translate(${dx}px, ${dy}px) scale(0.45)`, opacity: 0.85 },
                ],
                { duration: FLY_MS, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', fill: 'forwards' },
              )
              a.onfinish = () => {
                setFly(null)
                setNudge(fly.key)
              }
            }}
            style={{
              left: fly.from.left + fly.from.width / 2 - 13,
              top: fly.from.top + fly.from.height / 2 - 16,
            }}
            className="pointer-events-none fixed z-[60] h-8 w-[26px] rounded-[3px] border border-accent bg-white bg-[repeating-linear-gradient(to_bottom,transparent_0_5px,var(--color-border)_5px_6px)] bg-[length:70%_100%] bg-[position:center_4px] bg-no-repeat shadow-lg"
          />,
          document.body,
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
            className={`fixed top-0 z-40 overflow-hidden ${drawerShown || drag ? '' : 'pointer-events-none'}`}
            style={{ height: barBox.top, left: barBox.left, width: barBox.width }}
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
