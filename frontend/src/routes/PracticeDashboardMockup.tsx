import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconGripVertical,
  IconPlayerPlayFilled,
  IconPlus,
  IconX,
} from '@tabler/icons-react'
import { ContextMenu, type ContextMenuItem } from '../components/ContextMenu'
import { PracticeStatusIcon } from '../components/PracticeStatusIcon'
import { AppFooter } from '../components/AppFooter'
import { useDismiss } from '../hooks/useDismiss'
import { useFitToScreen } from '../hooks/useFitToScreen'
import { PracticeStatusStrip } from './AddToSetlistMockup'
import { CONTENT_MAX_W } from '../lib/layout'
import { daysUntil, formatDateOnly, todayDateOnly } from '../lib/dateOnly'
import { ALL_MOCK_SETLISTS, daysFromNow, getUpcomingSetlists } from '../lib/setlistsMockupFixture'
import { confirmAction } from '../lib/dialogs'
import { useMockupTitle } from '../lib/useMockupTitle'

// The Practice Dashboard: where the sidebar's "Practice" lands (real:
// routes/PracticeDashboardPage.tsx). Layout A3 of https://claude.ai/artifact/AadkReodCUoqEqNqS8Acjn
// and the boxes picked in https://claude.ai/artifact/SFrqyBdvMYGjLY6hLpR3Bg:
// - Left column, scrolling: the gigs under 4 weeks away (G2, countdown
//   cards, two across), then the shelves (T7) — Currently Practicing,
//   Other Recently Played, Recently Added, Favorites, Want to Learn,
//   Learned.
// - Right column, pinned on a wide screen: the week (W1 every day, W4 a
//   weekly target, chosen in Customize) over the Practice List (L1 rows
//   with L4's totals footer), running the full height.
// On a narrow screen it's one column: gigs, week, list, then the shelves.
// A piece already on the list is faded with a check on every shelf and
// can't be added again. Shelf pieces add with their + (on hover with a
// mouse, always shown on touch) or by dragging them into the list (mouse
// only); their right-click / long-press menu is the Piece Library's with
// Open Piece Details on top.

type Status = 'Want to Learn' | 'Learning' | 'Stalled' | 'Learned' | 'Dropped'

interface MockPiece {
  id: number
  title: string
  composer: string
  status: Status | null
  favorite?: boolean
  addedDaysAgo: number
  /** The last day it was practiced, from the practice log; null if never. */
  playedDaysAgo: number | null
  /** When its practice status last changed (Currently Practicing's order). */
  statusDaysAgo: number
  durationSeconds: number
}

const PIECES: MockPiece[] = [
  {
    id: 1,
    title: 'Prelude in C Major',
    composer: 'J.S. Bach',
    status: 'Learned',
    favorite: true,
    addedDaysAgo: 120,
    playedDaysAgo: 1,
    statusDaysAgo: 40,
    durationSeconds: 150,
  },
  {
    id: 2,
    title: 'Benedictus',
    composer: 'Alec Rowley',
    status: 'Learning',
    addedDaysAgo: 6,
    playedDaysAgo: 1,
    statusDaysAgo: 1,
    durationSeconds: 240,
  },
  {
    id: 3,
    title: 'Ave Maria',
    composer: 'Franz Schubert',
    status: 'Learned',
    favorite: true,
    addedDaysAgo: 200,
    playedDaysAgo: 2,
    statusDaysAgo: 90,
    durationSeconds: 255,
  },
  {
    id: 4,
    title: 'Jesu, Joy of Man’s Desiring',
    composer: 'J.S. Bach',
    status: 'Learning',
    addedDaysAgo: 90,
    playedDaysAgo: 2,
    statusDaysAgo: 3,
    durationSeconds: 225,
  },
  {
    id: 5,
    title: 'How Great Thou Art',
    composer: 'arr. Stuart K. Hine',
    status: 'Learned',
    addedDaysAgo: 60,
    playedDaysAgo: 5,
    statusDaysAgo: 30,
    durationSeconds: 180,
  },
  {
    id: 6,
    title: 'Clair de lune',
    composer: 'Claude Debussy',
    status: 'Learning',
    favorite: true,
    addedDaysAgo: 30,
    playedDaysAgo: 1,
    statusDaysAgo: 0,
    durationSeconds: 300,
  },
  {
    id: 7,
    title: 'Pavane, Op. 50',
    composer: 'Gabriel Fauré',
    status: 'Learning',
    addedDaysAgo: 3,
    playedDaysAgo: 4,
    statusDaysAgo: 4,
    durationSeconds: 330,
  },
  {
    id: 8,
    title: 'Arabesque No. 1',
    composer: 'Claude Debussy',
    status: 'Stalled',
    addedDaysAgo: 45,
    playedDaysAgo: 9,
    statusDaysAgo: 12,
    durationSeconds: 270,
  },
  {
    id: 9,
    title: 'Gymnopédie No. 1',
    composer: 'Erik Satie',
    status: 'Learned',
    addedDaysAgo: 150,
    playedDaysAgo: 5,
    statusDaysAgo: 60,
    durationSeconds: 200,
  },
  {
    id: 10,
    title: 'Träumerei',
    composer: 'Robert Schumann',
    status: 'Learning',
    addedDaysAgo: 70,
    playedDaysAgo: 4,
    statusDaysAgo: 7,
    durationSeconds: 170,
  },
  {
    id: 11,
    title: 'Morning Mood',
    composer: 'Edvard Grieg',
    status: null,
    addedDaysAgo: 1,
    playedDaysAgo: null,
    statusDaysAgo: 1,
    durationSeconds: 240,
  },
  {
    id: 12,
    title: 'Salut d’amour',
    composer: 'Edward Elgar',
    status: 'Want to Learn',
    addedDaysAgo: 2,
    playedDaysAgo: null,
    statusDaysAgo: 2,
    durationSeconds: 190,
  },
  {
    id: 13,
    title: 'The Swan',
    composer: 'Camille Saint-Saëns',
    status: 'Learned',
    favorite: true,
    addedDaysAgo: 80,
    playedDaysAgo: 4,
    statusDaysAgo: 50,
    durationSeconds: 180,
  },
  {
    id: 14,
    title: 'Liebestraum No. 3',
    composer: 'Franz Liszt',
    status: 'Want to Learn',
    addedDaysAgo: 4,
    playedDaysAgo: null,
    statusDaysAgo: 4,
    durationSeconds: 290,
  },
  {
    id: 15,
    title: 'Méditation',
    composer: 'Jules Massenet',
    status: 'Want to Learn',
    addedDaysAgo: 40,
    playedDaysAgo: 8,
    statusDaysAgo: 40,
    durationSeconds: 300,
  },
  {
    id: 16,
    title: 'Nimrod',
    composer: 'Edward Elgar',
    status: 'Learned',
    favorite: true,
    addedDaysAgo: 300,
    playedDaysAgo: 5,
    statusDaysAgo: 120,
    durationSeconds: 210,
  },
  {
    id: 17,
    title: 'Canon in D',
    composer: 'Johann Pachelbel',
    status: 'Learned',
    addedDaysAgo: 400,
    playedDaysAgo: 2,
    statusDaysAgo: 200,
    durationSeconds: 300,
  },
  {
    id: 18,
    title: 'Simple Gifts',
    composer: 'arr. Aaron Copland',
    status: 'Learned',
    addedDaysAgo: 220,
    playedDaysAgo: 11,
    statusDaysAgo: 100,
    durationSeconds: 120,
  },
  {
    id: 19,
    title: 'Air on the G String',
    composer: 'J.S. Bach',
    status: 'Learned',
    favorite: true,
    addedDaysAgo: 260,
    playedDaysAgo: 13,
    statusDaysAgo: 150,
    durationSeconds: 270,
  },
  {
    id: 20,
    title: 'Panis Angelicus',
    composer: 'César Franck',
    status: 'Want to Learn',
    favorite: true,
    addedDaysAgo: 9,
    playedDaysAgo: null,
    statusDaysAgo: 9,
    durationSeconds: 220,
  },
  {
    id: 21,
    title: 'Vocalise',
    composer: 'Sergei Rachmaninoff',
    status: 'Want to Learn',
    addedDaysAgo: 12,
    playedDaysAgo: null,
    statusDaysAgo: 12,
    durationSeconds: 360,
  },
  {
    id: 22,
    title: 'Après un rêve',
    composer: 'Gabriel Fauré',
    status: 'Dropped',
    addedDaysAgo: 100,
    playedDaysAgo: 20,
    statusDaysAgo: 25,
    durationSeconds: 180,
  },
  {
    id: 23,
    title: 'Ave Verum Corpus',
    composer: 'W.A. Mozart',
    status: null,
    addedDaysAgo: 5,
    playedDaysAgo: null,
    statusDaysAgo: 5,
    durationSeconds: 160,
  },
  {
    id: 24,
    title: 'The Lark Ascending',
    composer: 'Ralph Vaughan Williams',
    status: null,
    addedDaysAgo: 8,
    playedDaysAgo: null,
    statusDaysAgo: 8,
    durationSeconds: 600,
  },
]

const INITIAL_LIST = [1, 2, 3, 4, 5, 6]
// Days with practice besides the pieces' own last days (the log goes back
// further than "last played").
const EXTRA_PRACTICE_DAYS = [10, 14, 15, 17]

const PRACTICING: Status[] = ['Learning', 'Stalled']
const GIG_WINDOW_DAYS = 28

// ---------------------------------------------------------------------
// Dates

/** "Today", "Yesterday", a weekday within the week, else "Nov 3". */
function dayLabel(daysAgo: number): string {
  if (daysAgo === 0) return 'Today'
  if (daysAgo === 1) return 'Yesterday'
  const iso = daysFromNow(-daysAgo)
  return daysAgo < 7
    ? formatDateOnly(iso, { weekday: 'long' })
    : formatDateOnly(iso, { month: 'short', day: 'numeric' })
}

function formatMinutes(seconds: number): string {
  const m = Math.round(seconds / 60)
  return m < 60 ? `about ${m} min` : `about ${Math.floor(m / 60)} h ${m % 60} min`
}

// ---------------------------------------------------------------------
// The week (W1 every day, W4 a weekly target)

type WeekMode = 'daily' | 'target'
interface WeekSettings {
  mode: WeekMode
  target: number
  weekStart: 'monday' | 'sunday'
}

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
  // are drawn as an SVG stroke whose pattern divides the circumference
  // evenly — a CSS dashed border on a small circle splits unevenly where
  // its corners meet.
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

function WeekBox({
  practicedDays,
  settings,
  onSettings,
}: {
  practicedDays: Set<string>
  settings: WeekSettings
  onSettings: (s: WeekSettings) => void
}) {
  const today = todayDateOnly()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useDismiss(open, wrapRef, () => setOpen(false))

  let days: string[]
  if (settings.mode === 'daily') {
    days = Array.from({ length: 7 }, (_, i) => daysFromNow(i - 6))
  } else {
    const weekday = new Date().getDay() // 0 = Sunday
    const back = settings.weekStart === 'monday' ? (weekday + 6) % 7 : weekday
    days = Array.from({ length: 7 }, (_, i) => daysFromNow(i - back))
  }
  const done = days.filter((d) => d <= today && practicedDays.has(d)).length
  const lastDay = formatDateOnly(days[6], { weekday: 'long' })

  return (
    <div className="rounded-lg border border-border bg-paper-raised p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold tracking-wider text-ink-soft uppercase">
          {settings.mode === 'daily' ? 'Last 7 days' : 'This week'}
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
                    checked={settings.mode === mode}
                    onChange={() => onSettings({ ...settings, mode })}
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
                            disabled={settings.target <= 1}
                            onClick={() =>
                              onSettings({
                                ...settings,
                                mode: 'target',
                                target: settings.target - 1,
                              })
                            }
                            className="cursor-pointer bg-paper-sunken px-2 py-0.5 disabled:opacity-40"
                          >
                            −
                          </button>
                          <span className="px-2 tabular-nums text-ink">{settings.target}</span>
                          <button
                            type="button"
                            aria-label="More days"
                            disabled={settings.target >= 7}
                            onClick={() =>
                              onSettings({
                                ...settings,
                                mode: 'target',
                                target: settings.target + 1,
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
                      onClick={() => onSettings({ ...settings, weekStart: d })}
                      className={`cursor-pointer px-2.5 py-1 capitalize ${
                        settings.weekStart === d ? 'bg-accent-soft font-semibold text-accent' : ''
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

      {settings.mode === 'daily' ? (
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
              {done >= settings.target
                ? 'Target met'
                : `${settings.target - done} to go by ${lastDay}`}
            </p>
          </div>
          <TargetRing done={done} target={settings.target} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Gig card (G2)

function GigCard({
  setlist,
}: {
  setlist: {
    id: string
    name: string
    gigDate: string
    entryCount: number
    totalDurationSeconds?: number
  }
}) {
  const navigate = useNavigate()
  const days = daysUntil(setlist.gigDate)
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => navigate('/mockup/setlist-details')}
      onKeyDown={(e) => e.key === 'Enter' && navigate('/mockup/setlist-details')}
      className="flex cursor-pointer items-center gap-[19px] rounded-lg border border-gig-border bg-gig p-4 hover:border-accent"
    >
      <div className="px-[7px] text-center">
        {days <= 1 ? (
          <div className="font-display text-xl leading-tight font-bold text-gig-ink">
            {days === 0 ? 'Today' : 'Tomorrow'}
          </div>
        ) : (
          <>
            <div className="font-display text-4xl leading-none font-bold text-gig-ink tabular-nums">
              {days}
            </div>
            <div className="mt-1 text-[0.68rem] font-semibold tracking-wider text-gig-ink uppercase">
              days
            </div>
          </>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="font-display text-lg leading-snug font-bold text-ink">{setlist.name}</div>
        <div className="text-sm text-ink-soft">
          {formatDateOnly(setlist.gigDate, { weekday: 'long', month: 'long', day: 'numeric' })}
          {setlist.totalDurationSeconds ? ` • ${formatMinutes(setlist.totalDurationSeconds)}` : ''}
        </div>
        <div>
          <Link
            to="/mockup/sheet-viewer?from=setlist"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent-fill px-3 py-1.5 font-display text-sm font-medium text-white hover:bg-accent-fill/90"
          >
            <IconPlayerPlayFilled size={13} />
            Practice
          </Link>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// Shelves (T7)

/** Mockup stand-in for a page thumbnail: the top of a score page. */
function PageThumb({ seed }: { seed: number }) {
  const staffYs = [26, 52, 78, 104]
  return (
    <svg
      viewBox="0 0 180 132"
      preserveAspectRatio="none"
      className="h-full w-full"
      aria-hidden="true"
    >
      <rect width="180" height="132" className="fill-white" />
      <rect
        x={60 + (seed % 4) * 6}
        y="8"
        width={60 - (seed % 3) * 8}
        height="4"
        rx="2"
        fill="#3a342c"
        opacity="0.35"
      />
      {staffYs.map((y) => (
        <g key={y}>
          {Array.from({ length: 5 }, (_, i) => (
            <line
              key={i}
              x1="14"
              y1={y + i * 3.4}
              x2="166"
              y2={y + i * 3.4}
              stroke="#3a342c"
              strokeWidth="0.8"
              opacity="0.5"
            />
          ))}
        </g>
      ))}
    </svg>
  )
}

interface ShelfDef {
  key: string
  title: string
  pieces: MockPiece[]
  /** The line under each title. */
  detail: (p: MockPiece) => string
  /** Whether a piece's status pill shows here (not when it's the shelf's own). */
  showStatus: (p: MockPiece) => boolean
  seeAll?: string
  /** The whole view's count; See all shows only when it's more than the
   * shelf holds. Favorites and Learned pretend the library has more than
   * the sample, so both cases show. */
  total?: number
}

function ShelfCard({
  piece,
  detail,
  showStatus,
  onList,
  onAdd,
  onRemove,
  onDragStart,
  onDragEnd,
  menuItems,
  onStatus,
}: {
  piece: MockPiece
  detail: string
  showStatus: boolean
  onList: boolean
  onAdd: () => void
  onRemove: () => void
  onDragStart: () => void
  onDragEnd: () => void
  menuItems: ContextMenuItem[]
  onStatus: (s: Status | null) => void
}) {
  const navigate = useNavigate()
  return (
    <ContextMenu
      hideTriggerButton
      items={menuItems}
      header={(close) => (
        <PracticeStatusStrip
          status={piece.status}
          onChange={(s) => onStatus(s as Status | null)}
          close={close}
        />
      )}
    >
      <div
        draggable={!onList}
        onDragStart={(e: DragEvent) => {
          e.dataTransfer.setData('text/plain', String(piece.id))
          e.dataTransfer.effectAllowed = 'copy'
          onDragStart()
        }}
        onDragEnd={onDragEnd}
        onClick={() => navigate('/mockup/piece-details')}
        className="shelf-card group relative flex w-36 shrink-0 cursor-pointer flex-col gap-1.5"
      >
        <div
          className={`relative aspect-[180/132] overflow-hidden rounded-md border border-border ${
            onList ? '' : 'group-hover:border-accent'
          }`}
        >
          {/* A white page faded by opacity turns mid-grey on the dark theme,
              so the page itself takes --skip-fade (CLAUDE.md). */}
          <div className={onList ? 'h-full opacity-(--skip-fade)' : 'h-full'}>
            <PageThumb seed={piece.id} />
          </div>
          {showStatus && piece.status && (
            <span
              className={`absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full border border-accent/30 bg-accent-soft px-1.5 py-px text-[0.65rem] font-medium text-accent ${
                onList ? 'opacity-45' : ''
              }`}
            >
              <PracticeStatusIcon status={piece.status} size={10} />
              {piece.status}
            </span>
          )}
          {onList ? (
            <button
              type="button"
              aria-label={`Remove ${piece.title} from the Practice List`}
              title="On the Practice List (click to remove)"
              onClick={(e) => {
                e.stopPropagation()
                onRemove()
              }}
              className="absolute top-1.5 right-1.5 flex size-5 cursor-pointer items-center justify-center rounded-full border border-accent-muted bg-accent-soft text-accent hover:border-accent-fill hover:bg-accent-fill hover:text-white"
            >
              <IconCheck size={12} stroke={3} />
            </button>
          ) : (
            <button
              type="button"
              aria-label={`Add ${piece.title} to the Practice List`}
              title="Add to Practice List"
              onClick={(e) => {
                e.stopPropagation()
                onAdd()
              }}
              className="absolute top-1.5 right-1.5 flex size-6 cursor-pointer items-center justify-center rounded-full bg-accent-fill text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 focus-visible:opacity-100 touch:opacity-100"
            >
              <IconPlus size={15} stroke={2.5} />
            </button>
          )}
        </div>
        <div className={onList ? 'opacity-45' : ''}>
          <p className="truncate font-display text-sm font-medium text-ink">{piece.title}</p>
          <p className="truncate text-xs text-ink-soft">{detail}</p>
        </div>
      </div>
    </ContextMenu>
  )
}

/** A shelf's row: scrolls sideways, fading out at an edge with more
 * beyond it rather than clipping, so it reads as running on under the
 * rail. On a wide screen it reaches into the gap before the rail. */
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

/** At most this many pieces show in an expanded shelf (four rows on a
 * laptop); the See all tile leads to the rest. */
const EXPANDED_CAP = 16

/** The end of a shelf with a page of its own: a faint link straight on
 * the page, no box — an arrow in a circle where a piece's page would sit,
 * "See all" and the count below it — that darkens to the accent on hover,
 * like a music or streaming app's end-of-row link. */
function SeeAllTile({ to }: { to: string }) {
  return (
    <Link to={to} className="group flex w-16 shrink-0 justify-center">
      {/* The button centered on a piece's page height (144px wide at
          180:132), level with the pages beside it, its label hanging just
          under it — a link beside the pages rather than another tile. */}
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

/** One shelf: its heading with Show more / Show less, then either the
 * single sideways row or, expanded, the same cards wrapped onto rows (the
 * same size and spacing either way). A shelf with a page of its own ends with a See
 * all tile in both. Show more appears only when the row holds more than
 * fits. Every visit starts with every shelf collapsed. */
function Shelf({
  title,
  seeAll,
  children,
}: {
  title: string
  seeAll?: string
  children: () => ReactNode[]
}) {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const cards = children()
  const tile = seeAll ? <SeeAllTile key="see-all" to={seeAll} /> : null
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
        // The same cards with the same gap as the row, wrapped onto new
        // lines where they don't fit.
        <div className="flex flex-wrap gap-x-3 gap-y-4 pb-2">
          {cards.slice(0, EXPANDED_CAP)}
          {tile}
        </div>
      ) : (
        <ShelfRow onOverflow={setOverflows}>
          {cards}
          {tile}
        </ShelfRow>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------
// The page

export function PracticeDashboardMockup() {
  const railRef = useRef<HTMLDivElement>(null)
  useFitToScreen(railRef)
  useMockupTitle('Practice Dashboard')
  const navigate = useNavigate()
  const [pieces, setPieces] = useState(PIECES)
  const [list, setList] = useState<number[]>(INITIAL_LIST)
  const [practicedToday, setPracticedToday] = useState<Set<number>>(new Set())
  const [week, setWeek] = useState<WeekSettings>({ mode: 'daily', target: 4, weekStart: 'monday' })
  // Mockup-only preview switches.
  const [gigPreview, setGigPreview] = useState<'two' | 'one' | 'none'>('two')

  const byId = useMemo(() => new Map(pieces.map((p) => [p.id, p])), [pieces])
  const onList = useMemo(() => new Set(list), [list])

  const practicedDays = useMemo(() => {
    const s = new Set<string>()
    for (const p of pieces) if (p.playedDaysAgo != null) s.add(daysFromNow(-p.playedDaysAgo))
    for (const d of EXTRA_PRACTICE_DAYS) s.add(daysFromNow(-d))
    // Today's circle comes from today's marks only (the fixture's last
    // days never include today), so ticking a list row fills it.
    s.delete(todayDateOnly())
    if (practicedToday.size > 0) s.add(todayDateOnly())
    return s
  }, [pieces, practicedToday])

  const gigs = useMemo(() => {
    const upcoming = getUpcomingSetlists(ALL_MOCK_SETLISTS).filter(
      (s) => daysUntil(s.gigDate) < GIG_WINDOW_DAYS,
    )
    return gigPreview === 'none' ? [] : gigPreview === 'one' ? upcoming.slice(0, 1) : upcoming
  }, [gigPreview])

  const shelves: ShelfDef[] = useMemo(() => {
    const practicing = pieces
      .filter((p) => p.status && PRACTICING.includes(p.status))
      .sort((a, b) => a.statusDaysAgo - b.statusDaysAgo)
    const practicingIds = new Set(practicing.map((p) => p.id))
    const byTitle = (a: MockPiece, b: MockPiece) => a.title.localeCompare(b.title)
    return [
      {
        key: 'practicing',
        title: 'Currently Practicing',
        pieces: practicing,
        detail: (p) => p.composer,
        showStatus: (p) => p.status === 'Stalled',
        seeAll: '/practicing',
      },
      {
        key: 'played',
        title: 'Other Recently Played',
        pieces: pieces
          .filter((p) => p.playedDaysAgo != null && !practicingIds.has(p.id))
          .sort((a, b) => a.playedDaysAgo! - b.playedDaysAgo!)
          .slice(0, 15),
        detail: (p) => dayLabel(p.playedDaysAgo!),
        showStatus: () => true,
      },
      {
        key: 'added',
        title: 'Recently Added',
        pieces: [...pieces].sort((a, b) => a.addedDaysAgo - b.addedDaysAgo).slice(0, 10),
        detail: (p) =>
          `Added ${dayLabel(p.addedDaysAgo).replace(/^(Today|Yesterday)$/, (m) => m.toLowerCase())}`,
        showStatus: () => true,
      },
      {
        key: 'favorites',
        title: 'Favorites',
        pieces: pieces.filter((p) => p.favorite).sort(byTitle),
        detail: (p) => p.composer,
        showStatus: () => true,
        seeAll: '/favorites',
        total: 23,
      },
      {
        key: 'want',
        title: 'Want to Learn',
        pieces: pieces.filter((p) => p.status === 'Want to Learn').sort(byTitle),
        detail: (p) => p.composer,
        showStatus: () => false,
        seeAll: '/want-to-learn',
      },
      {
        key: 'learned',
        title: 'Learned',
        pieces: pieces.filter((p) => p.status === 'Learned').sort(byTitle),
        detail: (p) => p.composer,
        showStatus: () => false,
        seeAll: '/learned',
        total: 31,
      },
    ]
  }, [pieces])

  function addToList(id: number, at?: number) {
    setList((cur) => {
      if (cur.includes(id)) return cur
      const next = [...cur]
      next.splice(at ?? next.length, 0, id)
      return next
    })
  }
  function removeFromList(id: number) {
    setList((cur) => cur.filter((x) => x !== id))
    setPracticedToday((cur) => {
      const next = new Set(cur)
      next.delete(id)
      return next
    })
  }
  function setStatus(id: number, status: Status | null) {
    setPieces((cur) => cur.map((p) => (p.id === id ? { ...p, status, statusDaysAgo: 0 } : p)))
  }
  function toggleFavorite(id: number) {
    setPieces((cur) => cur.map((p) => (p.id === id ? { ...p, favorite: !p.favorite } : p)))
  }

  function menuFor(p: MockPiece): ContextMenuItem[] {
    return [
      { label: 'Open Piece Details', onSelect: () => navigate('/mockup/piece-details') },
      {
        label: p.favorite ? 'Remove from Favorites' : 'Add to Favorites',
        onSelect: () => toggleFavorite(p.id),
      },
      onList.has(p.id)
        ? { label: 'Remove from Practice List', onSelect: () => removeFromList(p.id) }
        : { label: 'Add to Practice List', onSelect: () => addToList(p.id) },
      { label: 'Add to Setlist', onSelect: () => {} },
      { label: 'Edit Piece', onSelect: () => {} },
      {
        label: 'Delete Piece',
        destructive: true,
        onSelect: () =>
          void confirmAction({
            title: `Delete "${p.title}"?`,
            message: 'Nothing is deleted in this mockup.',
            confirmLabel: 'Delete piece',
          }),
      },
    ]
  }

  // ---- Practice List: reorder by the grip (pointer events, captured on the
  // list itself, which never moves), drop-in from a shelf (mouse drag).
  const listRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef(new Map<number, HTMLDivElement>())
  const [reorderId, setReorderId] = useState<number | null>(null)
  const [shelfDrag, setShelfDrag] = useState(false)
  const [dropAt, setDropAt] = useState<number | null>(null)

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
    setReorderId(id)
  }
  function onListPointerMove(e: ReactPointerEvent) {
    if (reorderId == null) return
    const others = list.filter((x) => x !== reorderId)
    const at = indexAt(e.clientY, others)
    const next = [...others]
    next.splice(at, 0, reorderId)
    if (next.some((v, i) => v !== list[i])) setList(next)
  }
  function endReorder() {
    setReorderId(null)
  }

  function clearList() {
    void confirmAction({
      title: 'Clear the Practice List?',
      message: 'Every piece comes off the list. The pieces themselves aren’t touched.',
      confirmLabel: 'Clear list',
    }).then((ok) => {
      if (ok) {
        setList([])
        setPracticedToday(new Set())
      }
    })
  }

  const totalSeconds = list.reduce((s, id) => s + (byId.get(id)?.durationSeconds ?? 0), 0)
  const practicedCount = list.filter((id) => practicedToday.has(id)).length

  const ghost = (
    <div className="my-0.5 h-9 rounded-md border-[1.5px] border-dashed border-accent bg-accent-soft" />
  )

  const practiceList = (
    <div
      className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-paper-raised p-3"
      onDragOver={(e) => {
        if (!shelfDrag) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDropAt(indexAt(e.clientY, list))
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null)
      }}
      onDrop={(e) => {
        e.preventDefault()
        const id = Number(e.dataTransfer.getData('text/plain'))
        if (id) addToList(id, dropAt ?? undefined)
        setDropAt(null)
        setShelfDrag(false)
      }}
    >
      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        <span className="text-xs font-semibold tracking-wider text-ink-soft uppercase">
          Practice List
        </span>
        {list.length > 0 && (
          <Link
            to="/mockup/sheet-viewer?from=list"
            className="hidden items-center gap-1.5 rounded-md bg-accent-fill px-2.5 py-1 font-display text-sm font-medium text-white hover:bg-accent-fill/90 lg:inline-flex"
          >
            <IconPlayerPlayFilled size={11} />
            Practice
          </Link>
        )}
      </div>

      {list.length === 0 && !shelfDrag ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-3 py-6 text-center">
          <p className="font-display font-bold text-ink">Nothing queued yet</p>
          <p className="text-sm text-ink-soft">Press + on a piece, or drag it here.</p>
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
          {list.map((id, i) => {
            const p = byId.get(id)!
            const done = practicedToday.has(id)
            return (
              <div key={id}>
                {dropAt === i && ghost}
                <div
                  ref={(el) => {
                    if (el) rowRefs.current.set(id, el)
                    else rowRefs.current.delete(id)
                  }}
                  className={`group flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-paper-hover ${
                    reorderId === id ? 'bg-paper-hover shadow-sm' : ''
                  }`}
                >
                  <span
                    onPointerDown={(e) => onGripDown(e, id)}
                    className="flex shrink-0 cursor-grab touch-none text-ink-faint"
                    aria-label="Drag to reorder"
                  >
                    <IconGripVertical size={15} />
                  </span>
                  <button
                    type="button"
                    onClick={() => navigate('/mockup/piece-details')}
                    className="flex min-w-0 flex-1 cursor-pointer flex-col text-left"
                  >
                    <span
                      className={`truncate font-display text-sm font-medium ${done ? 'text-ink-soft' : 'text-ink'}`}
                    >
                      {p.title}
                    </span>
                    <span className="truncate text-xs text-ink-soft">{p.composer}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPracticedToday((cur) => {
                        const next = new Set(cur)
                        if (next.has(id)) next.delete(id)
                        else next.add(id)
                        return next
                      })
                    }
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
                    onClick={() => removeFromList(id)}
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
          {dropAt === list.length && ghost}
          {/* How pieces get here, always in view under the rows; while a
              piece is being dragged over it says what letting go does.
              Text only: the gap above is the one drop marker. */}
          <p
            className={`px-1 pt-3 pb-1 text-center text-xs ${
              dropAt != null ? 'text-accent' : 'text-ink-faint'
            }`}
          >
            {dropAt != null
              ? 'Let go to add it where the gap is'
              : 'Drag pieces here, or press + on a piece'}
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
            <span className="tabular-nums">{formatMinutes(totalSeconds)}</span>
            {/* Clear moved here when Practice took the header. */}
            <button
              type="button"
              onClick={clearList}
              className="cursor-pointer text-accent hover:underline"
            >
              Clear
            </button>
          </span>
        </div>
      )}
    </div>
  )

  return (
    <div className={`${CONTENT_MAX_W} flex flex-1 flex-col gap-5 px-4 py-6 md:px-8`}>
      {/* The page's title. Its Practice button lives with the list it
          plays (D of https://claude.ai/artifact/My1kLD9LpjNwCKsDrejseh): in
          the list's header on a wide screen, where the column is pinned, and
          in a bar pinned to the bottom on a narrow one. */}
      <h1 className="font-display text-2xl font-bold text-ink">Practice</h1>

      <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
        Mockup only: gigs{' '}
        {(['two', 'one', 'none'] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGigPreview(g)}
            className={`mx-0.5 cursor-pointer rounded px-1.5 ${gigPreview === g ? 'bg-accent-soft font-semibold text-accent' : 'hover:text-ink'}`}
          >
            {g === 'two' ? 'Two' : g === 'one' ? 'One' : 'None'}
          </button>
        ))}
        — tick a list row to mark it practiced today, and today’s circle fills.
      </div>

      {/* Narrow: gigs, week + list, shelves. Wide: gigs and shelves on the
          left, the week and list pinned on the right for the whole page. */}
      <div className="grid grid-cols-1 gap-6 [grid-template-areas:'gigs'_'rail'_'shelves'] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:[grid-template-areas:'gigs_rail'_'shelves_rail']">
        {gigs.length > 0 ? (
          <div className="@container [grid-area:gigs]">
            {/* Two across only where the column has room for them. */}
            <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
              {gigs.map((s) => (
                <GigCard key={s.id} setlist={s} />
              ))}
            </div>
          </div>
        ) : (
          <div className="hidden [grid-area:gigs] lg:block lg:h-0" />
        )}

        {/* Pinned on a wide screen, and sized to the room it has there
            (hooks/useFitToScreen): it starts under the title row, so a
            fixed screen-height column ran off the bottom. */}
        <div
          ref={railRef}
          className="flex flex-col gap-4 [grid-area:rail] lg:sticky lg:top-6 lg:h-[calc(100dvh-3rem)] lg:self-start"
        >
          <WeekBox practicedDays={practicedDays} settings={week} onSettings={setWeek} />
          {practiceList}
        </div>

        <div className="flex min-w-0 flex-col gap-6 [grid-area:shelves]">
          {shelves
            .filter((s) => s.pieces.length > 0)
            .map((s) => (
              <Shelf
                key={s.key}
                title={s.title}
                seeAll={(s.total ?? s.pieces.length) > s.pieces.length ? s.seeAll : undefined}
              >
                {() =>
                  s.pieces.map((p) => (
                    <ShelfCard
                      key={p.id}
                      piece={p}
                      detail={s.detail(p)}
                      showStatus={s.showStatus(p)}
                      onList={onList.has(p.id)}
                      onAdd={() => addToList(p.id)}
                      onRemove={() => removeFromList(p.id)}
                      onDragStart={() => setShelfDrag(true)}
                      onDragEnd={() => {
                        setShelfDrag(false)
                        setDropAt(null)
                      }}
                      menuItems={menuFor(p)}
                      onStatus={(st) => setStatus(p.id, st)}
                    />
                  ))
                }
              </Shelf>
            ))}
          {/* The footer mark ends the shelves column rather than the page
              (lib/appFooter.ts' PAGES_WITH_OWN_FOOTER), so the pinned column runs
              the page's full height. */}
          <AppFooter className="mt-6" />
        </div>
      </div>
      {/* Narrow screens: the list isn't pinned there, so Practice rides in a
          bar pinned to the bottom of the screen, with what it will play. */}
      {list.length > 0 && (
        <div className="sticky bottom-0 z-10 -mx-4 -mb-6 flex items-center justify-between gap-3 border-t border-border bg-paper-raised px-4 pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom,0px))] md:-mx-8 md:px-8 lg:hidden">
          <span className="text-sm text-ink-soft">
            {list.length} {list.length === 1 ? 'piece' : 'pieces'}
            {totalSeconds > 0 ? ` • ${formatMinutes(totalSeconds)}` : ''}
          </span>
          <Link
            to="/mockup/sheet-viewer?from=list"
            className="inline-flex items-center gap-1.5 rounded-md bg-accent-fill px-3 py-1.5 font-display text-sm font-medium text-white hover:bg-accent-fill/90"
          >
            <IconPlayerPlayFilled size={12} />
            Practice
          </Link>
        </div>
      )}
    </div>
  )
}
