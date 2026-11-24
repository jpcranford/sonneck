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
import { Link, useNavigate } from 'react-router-dom'
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
import { ContextMenu, type ContextMenuItem } from '../components/ContextMenu'
import { PracticeStatusIcon } from '../components/PracticeStatusIcon'
import { AppFooter } from '../components/AppFooter'
import { Radio } from '../components/Radio'
import { useDismiss } from '../hooks/useDismiss'
import { useFitToScreen } from '../hooks/useFitToScreen'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { PracticeStatusStrip } from './AddToSetlistMockup'
import { CONTENT_MAX_W } from '../lib/layout'
import { daysUntil, formatDateOnly, todayDateOnly } from '../lib/dateOnly'
import { ALL_MOCK_SETLISTS, daysFromNow, getUpcomingSetlists } from '../lib/setlistsMockupFixture'
import { confirmAction } from '../lib/dialogs'
import { practiceHeading } from '../lib/practiceHeading'
import { finishTip, tipDone } from '../lib/sheetViewerTips'
import { useMockupTitle } from '../lib/useMockupTitle'
import { estimateTotal } from '../lib/setlistEstimate'
import { shuffledBy, useShelfShuffles } from '../lib/shelfShuffle'

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

// Mockup stand-in for each gig's pieces (mock setlists have no entries):
// the first gig, the second, and so on, by their order on the page.
const MOCK_GIG_PIECES = [
  [3, 1, 6, 9, 12],
  [2, 5, 8, 14, 17, 20],
]

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
/** The added-piece nudge: the fly into the tab, then how long the tab stays
 * lit and its message shows. */
const FLY_MS = 450
/** The drawer tip's id in lib/sheetViewerTips.ts. */
const DRAWER_TIP = 'practice-list-drawer'
const NUDGE_MS = 3000
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

// The box's seven days: the last seven, or this week from its first day.
function weekDaysFor(settings: WeekSettings): string[] {
  if (settings.mode === 'daily') return Array.from({ length: 7 }, (_, i) => daysFromNow(i - 6))
  const weekday = new Date().getDay() // 0 = Sunday
  const back = settings.weekStart === 'monday' ? (weekday + 6) % 7 : weekday
  return Array.from({ length: 7 }, (_, i) => daysFromNow(i - back))
}

// Mockup-only: which practice history the page shows, to see each heading.
type HistoryPreview = 'week' | 'earlier' | 'lapsed' | 'never'
const HISTORY_PREVIEWS: { key: HistoryPreview; label: string }[] = [
  { key: 'week', label: 'This week' },
  { key: 'earlier', label: 'Earlier this month' },
  { key: 'lapsed', label: 'Over a month ago' },
  { key: 'never', label: 'Never' },
]

type GigPreview = 'two' | 'one' | 'none'

// The practiced days the page shows: the fixture's history, or the
// preview's stand-in (days 10–23 ago: this month, never this week; 35–40
// ago: lapsed; or none). Today comes from today's marks only (the
// fixture's last days never include today), so ticking a list row fills it.
function practicedDaysFor(
  pieces: MockPiece[],
  history: HistoryPreview,
  practicedToday: Set<number>,
): Set<string> {
  const s = new Set<string>()
  if (history === 'week') {
    for (const p of pieces) if (p.playedDaysAgo != null) s.add(daysFromNow(-p.playedDaysAgo))
    for (const d of EXTRA_PRACTICE_DAYS) s.add(daysFromNow(-d))
  } else if (history === 'earlier') {
    for (const d of [10, 16, 23]) s.add(daysFromNow(-d))
  } else if (history === 'lapsed') {
    for (const d of [35, 40]) s.add(daysFromNow(-d))
  }
  s.delete(todayDateOnly())
  if (practicedToday.size > 0) s.add(todayDateOnly())
  return s
}

// The gig cards: under 4 weeks away, as many as the preview asks for.
function gigsFor(preview: GigPreview) {
  const upcoming = getUpcomingSetlists(ALL_MOCK_SETLISTS).filter(
    (s) => daysUntil(s.gigDate) < GIG_WINDOW_DAYS,
  )
  return preview === 'none' ? [] : preview === 'one' ? upcoming.slice(0, 1) : upcoming
}

// The heading for the page as it loads (lib/practiceHeading.ts).
function mockHeading(o: {
  pieces: MockPiece[]
  history: HistoryPreview
  practicedToday: Set<number>
  gigPreview: GigPreview
  week: WeekSettings
  listLength: number
  trackPractice: boolean
}) {
  const gig = gigsFor(o.gigPreview)[0]
  return practiceHeading({
    today: todayDateOnly(),
    practicedDays: practicedDaysFor(o.pieces, o.history, o.practicedToday),
    weekDays: weekDaysFor(o.week),
    weekMode: o.week.mode === 'daily' ? 'daily' : 'target',
    weekTarget: o.week.target,
    nextGig: gig?.gigDate ? { name: gig.name, gigDate: gig.gigDate } : null,
    listLength: o.listLength,
    trackPractice: o.trackPractice,
  })
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

  const days = weekDaysFor(settings)
  const done = days.filter((d) => d <= today && practicedDays.has(d)).length
  const lastDay = formatDateOnly(days[6], { weekday: 'long' })
  const target = settings.target

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
                    checked={settings.mode === mode}
                    onChange={() => onSettings({ ...settings, mode })}
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
// Gig card (G2)

function GigCard({
  setlist,
  pieceIds,
  onList,
  onAddMissing,
}: {
  setlist: {
    id: string
    name: string
    gigDate: string
    entryCount: number
    totalDurationSeconds?: number
  }
  /** The set's pieces, in its order (custom entries have none). */
  pieceIds: number[]
  onList: Set<number>
  onAddMissing: (ids: number[]) => void
}) {
  const navigate = useNavigate()
  const days = daysUntil(setlist.gigDate)
  const missing = pieceIds.filter((id) => !onList.has(id))
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => navigate('/mockup/setlist-details')}
      onKeyDown={(e) => e.key === 'Enter' && navigate('/mockup/setlist-details')}
      className="flex cursor-pointer items-center gap-[19px] rounded-lg border border-gig-border bg-gig p-4 hover:border-accent"
    >
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
        <div className="font-display text-lg leading-snug font-bold text-ink">{setlist.name}</div>
        <div className="text-sm text-ink-soft">
          {formatDateOnly(setlist.gigDate, { weekday: 'long', month: 'long', day: 'numeric' })}
          {setlist.totalDurationSeconds ? ` • ${formatMinutes(setlist.totalDurationSeconds)}` : ''}
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/mockup/sheet-viewer?from=setlist"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent-fill px-3 py-1.5 font-display text-sm font-medium text-white hover:bg-accent-fill/90"
          >
            <IconPlayerPlayFilled size={13} />
            Practice
          </Link>
          {/* Small beside Practice: the set's pieces not yet on the
              Practice List, added in the set's order. Once they're all on
              it, a quiet check in the same place, so Practice never moves.
              Practice's height either way, so the card never changes
              height when it's done; only its width follows what it shows. */}
          {pieceIds.length > 0 && (
            <button
              type="button"
              disabled={missing.length === 0}
              onClick={(e) => {
                e.stopPropagation()
                onAddMissing(missing)
              }}
              aria-label={
                missing.length
                  ? `Add ${missing.length} missing ${missing.length === 1 ? 'piece' : 'pieces'} to the Practice List`
                  : 'All of this set’s pieces are on the Practice List'
              }
              title={
                missing.length
                  ? `Add ${missing.length} missing ${missing.length === 1 ? 'piece' : 'pieces'} to the Practice List`
                  : 'All of this set’s pieces are on the Practice List'
              }
              className="inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1 px-2 rounded-md border border-gig-border bg-paper-raised text-sm leading-none font-medium text-accent tabular-nums hover:border-accent disabled:cursor-default disabled:text-ink-faint disabled:hover:border-gig-border"
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
  /** The + button's box, for the narrow layout's fly into the bar. */
  onAdd: (from: DOMRect) => void
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
            onList ? 'bg-paper' : 'group-hover:border-accent'
          }`}
        >
          {/* Faded over the paper, not a grey fill (--onlist-fade). */}
          <div className={onList ? 'h-full opacity-(--onlist-fade)' : 'h-full'}>
            <PageThumb seed={piece.id} />
          </div>
          {showStatus && piece.status && (
            <span
              className={`absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full border border-accent/30 bg-accent-soft px-1.5 py-px text-[0.65rem] font-medium text-accent ${
                onList ? 'opacity-55' : ''
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
                onAdd(e.currentTarget.getBoundingClientRect())
              }}
              className="absolute top-1.5 right-1.5 flex size-6 cursor-pointer items-center justify-center rounded-full bg-accent-fill text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 focus-visible:opacity-100 touch:opacity-100"
            >
              <IconPlus size={15} stroke={2.5} />
            </button>
          )}
        </div>
        <div className={onList ? 'opacity-55' : ''}>
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
  shuffled,
  onShuffle,
  children,
}: {
  title: string
  seeAll?: string
  /** Random order is on; the button toggles it (a new order each time on). */
  shuffled: boolean
  onShuffle: () => void
  children: () => ReactNode[]
}) {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const cards = children()
  const tile = seeAll ? <SeeAllTile key="see-all" to={seeAll} /> : null
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

// The list with the dragged piece moved to where clientY points (the same
// array when that's where it already is).
function movedTo(rows: Map<number, HTMLDivElement>, list: number[], id: number, clientY: number) {
  const others = list.filter((x) => x !== id)
  const next = [...others]
  next.splice(rowIndexAt(rows, clientY, others), 0, id)
  return next.some((v, i) => v !== list[i]) ? next : list
}

export function PracticeDashboardMockup() {
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
  useEffect(() => {
    if (!drawerShown) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerShown])
  useMockupTitle('Practice Dashboard')
  const navigate = useNavigate()
  const [pieces, setPieces] = useState(PIECES)
  const [list, setList] = useState<number[]>(INITIAL_LIST)
  const onListSet = useMemo(() => new Set(list), [list])
  const [practicedToday, setPracticedToday] = useState<Set<number>>(new Set())
  const [week, setWeek] = useState<WeekSettings>({ mode: 'daily', target: 4, weekStart: 'monday' })
  // Mockup-only preview switches.
  const [gigPreview, setGigPreview] = useState<GigPreview>('two')
  const [historyPreview, setHistoryPreview] = useState<HistoryPreview>('week')
  const [trackPractice, setTrackPractice] = useState(true)

  const byId = useMemo(() => new Map(pieces.map((p) => [p.id, p])), [pieces])
  const onList = useMemo(() => new Set(list), [list])

  const practicedDays = useMemo(
    () => practicedDaysFor(pieces, historyPreview, practicedToday),
    [pieces, practicedToday, historyPreview],
  )
  const gigs = useMemo(() => gigsFor(gigPreview), [gigPreview])

  // The heading is picked once, when the page loads, and then stays: adding,
  // ticking or clearing in the list doesn't change it. The preview switches
  // stand for loading the page in another situation, so they pick it again
  // (previewLoad).
  const [heading, setHeading] = useState(() =>
    mockHeading({
      pieces,
      history: historyPreview,
      practicedToday,
      gigPreview,
      week,
      listLength: list.length,
      trackPractice,
    }),
  )
  function previewLoad(change: {
    gigPreview?: GigPreview
    historyPreview?: HistoryPreview
    trackPractice?: boolean
  }) {
    const next = {
      gigPreview: change.gigPreview ?? gigPreview,
      historyPreview: change.historyPreview ?? historyPreview,
      trackPractice: change.trackPractice ?? trackPractice,
    }
    setGigPreview(next.gigPreview)
    setHistoryPreview(next.historyPreview)
    setTrackPractice(next.trackPractice)
    setHeading(
      mockHeading({
        pieces,
        history: next.historyPreview,
        practicedToday,
        gigPreview: next.gigPreview,
        week,
        listLength: list.length,
        trackPractice: next.trackPractice,
      }),
    )
  }

  // Each shelf's random order (lib/shelfShuffle.ts), per device.
  const { seedOf, toggle: toggleShuffle } = useShelfShuffles()
  const shelves: ShelfDef[] = useMemo(() => {
    // A shuffled shelf: a shelf drawn from a whole view (a status,
    // Favorites) picks at random from all of it; one defined by recency
    // (the latest played, the newest added) shuffles that same set.
    const order = (key: string, list: MockPiece[]) => {
      const seed = seedOf(key)
      return seed ? shuffledBy(list, seed) : list
    }
    const practicing = pieces
      .filter((p) => p.status && PRACTICING.includes(p.status))
      // Latest practiced first, never practiced last, then the latest
      // status change (the real page's order). With Track practice off
      // there are no practiced days to go by: the status change alone.
      .sort(
        (a, b) =>
          (trackPractice ? (a.playedDaysAgo ?? Infinity) - (b.playedDaysAgo ?? Infinity) : 0) ||
          a.statusDaysAgo - b.statusDaysAgo,
      )
    const practicingIds = new Set(practicing.map((p) => p.id))
    const byTitle = (a: MockPiece, b: MockPiece) => a.title.localeCompare(b.title)
    const all: ShelfDef[] = [
      {
        key: 'practicing',
        title: 'Currently Practicing',
        pieces: order('practicing', practicing),
        detail: (p) => p.composer,
        showStatus: (p) => p.status === 'Stalled',
        seeAll: '/practicing',
      },
      {
        key: 'played',
        title: 'Other Recently Played',
        pieces: order(
          'played',
          pieces
            .filter((p) => p.playedDaysAgo != null && !practicingIds.has(p.id))
            .sort((a, b) => a.playedDaysAgo! - b.playedDaysAgo!)
            .slice(0, 15),
        ),
        detail: (p) => dayLabel(p.playedDaysAgo!),
        showStatus: () => true,
      },
      {
        key: 'added',
        title: 'Recently Added',
        pieces: order(
          'added',
          [...pieces].sort((a, b) => a.addedDaysAgo - b.addedDaysAgo).slice(0, 10),
        ),
        detail: (p) =>
          `Added ${dayLabel(p.addedDaysAgo).replace(/^(Today|Yesterday)$/, (m) => m.toLowerCase())}`,
        showStatus: () => true,
      },
      {
        key: 'favorites',
        title: 'Favorites',
        // The real shelf: the most recently edited first. Mock pieces have no
        // edit dates, so the day each was added stands in.
        pieces: order(
          'favorites',
          pieces
            .filter((p) => p.favorite)
            .sort((a, b) => a.addedDaysAgo - b.addedDaysAgo || byTitle(a, b)),
        ),
        detail: (p) => p.composer,
        showStatus: () => true,
        seeAll: '/favorites',
        total: 23,
      },
      {
        key: 'want',
        title: 'Want to Learn',
        pieces: order(
          'want',
          pieces
            .filter((p) => p.status === 'Want to Learn')
            .sort((a, b) => a.statusDaysAgo - b.statusDaysAgo || byTitle(a, b)),
        ),
        detail: (p) => p.composer,
        showStatus: () => false,
        seeAll: '/want-to-learn',
      },
      {
        key: 'learned',
        title: 'Learned',
        pieces: order(
          'learned',
          pieces
            .filter((p) => p.status === 'Learned')
            .sort((a, b) => a.statusDaysAgo - b.statusDaysAgo || byTitle(a, b)),
        ),
        detail: (p) => p.composer,
        showStatus: () => false,
        seeAll: '/learned',
        total: 31,
      },
    ]
    // Other Recently Played is ordered by practiced days, so it goes with
    // Track practice off.
    return trackPractice ? all : all.filter((s) => s.key !== 'played')
  }, [pieces, seedOf, trackPractice])

  // E of https://claude.ai/artifact/3WcfhJoJXhAaH7v1cM3SU7: with the list in
  // a drawer, adding a piece says where it went — a small page flies from
  // the card's + into the tab (not with Reduce Motion, nor from a menu or a
  // gig's +N), the tab lights up, and a message offers to show the list.
  const tabRef = useRef<HTMLButtonElement>(null)
  const [fly, setFly] = useState<{ key: number; from: DOMRect; to: DOMRect } | null>(null)
  const [nudge, setNudge] = useState(0)
  const nudgeKey = useRef(0)
  useEffect(() => {
    if (!nudge) return
    const t = window.setTimeout(() => setNudge(0), NUDGE_MS)
    return () => window.clearTimeout(t)
  }, [nudge])
  // F of the same page: the first time the list is a drawer on this device,
  // a tip points at the tab, the page above dimmed, until it's dismissed —
  // Got it, a tap on the page, Escape, or opening the drawer — for good
  // (lib/sheetViewerTips.ts, so "Show tips again" brings it back).
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

  function addedNudge(from?: DOMRect) {
    if (isWide) return
    nudgeKey.current += 1
    const key = nudgeKey.current
    const to = tabRef.current?.getBoundingClientRect()
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (from && to && !reduced) setFly({ key, from, to })
    else setNudge(key)
  }
  function openDrawerFromBar() {
    setDrawerOpen(true)
    closeTip()
  }
  function addFromCard(id: number, from: DOMRect) {
    addToList(id)
    addedNudge(from)
  }

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
        : {
            label: 'Add to Practice List',
            onSelect: () => {
              addToList(p.id)
              addedNudge()
            },
          },
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

  const indexAt = (clientY: number, ids: number[]) => rowIndexAt(rowRefs.current, clientY, ids)
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
  function onGripDown(e: ReactPointerEvent, id: number) {
    e.preventDefault()
    const row = rowRefs.current.get(id)?.getBoundingClientRect()
    if (!row) return
    listRef.current?.setPointerCapture(e.pointerId)
    lastPointerY.current = e.clientY
    setReorderId(id)
    setDragCard({
      x: e.clientX,
      y: e.clientY,
      offsetX: e.clientX - row.left,
      offsetY: e.clientY - row.top,
      width: row.width,
    })
  }
  function onListPointerMove(e: ReactPointerEvent) {
    if (reorderId == null) return
    lastPointerY.current = e.clientY
    setDragCard((c) => c && { ...c, x: e.clientX, y: e.clientY })
    setList((cur) => movedTo(rowRefs.current, cur, reorderId, e.clientY))
  }
  function endReorder() {
    setDragCard(null)
    setReorderId(null)
  }
  // Held near the list's top or bottom edge, the list scrolls, moving the
  // row along with it.
  useEffect(() => {
    if (reorderId == null) return
    const id = reorderId
    document.body.style.cursor = 'grabbing'
    const rows = rowRefs.current
    const EDGE = 48
    const SPEED = 10
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
          if (el.scrollTop !== before) setList((cur) => movedTo(rows, cur, id, y))
        }
      }
      frame = requestAnimationFrame(tick)
    })
    return () => {
      cancelAnimationFrame(frame)
      document.body.style.cursor = ''
    }
  }, [reorderId])

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

  // A piece with no duration counts as the typical length setlists assume
  // (2:30, lib/setlistEstimate.ts), so the list's "about" total isn't short.
  const totalSeconds = estimateTotal(
    list.map((id) => ({ isMusic: true, durationSeconds: byId.get(id)?.durationSeconds })),
  ).seconds
  const practicedCount = list.filter((id) => practicedToday.has(id)).length
  // The bar beside the tab (which names the list and counts it): the time,
  // and what's practiced today when tracking.
  const barSummary =
    list.length > 0
      ? [
          totalSeconds > 0 ? formatMinutes(totalSeconds) : null,
          trackPractice ? `${practicedCount} practiced today` : null,
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
        {/* Wide, the header holds Practice; narrow, Practice is on the bar
            right under the drawer, so Clear comes up here, well away from
            it. */}
        {list.length > 0 &&
          (isWide ? (
            <Link
              to="/mockup/sheet-viewer?from=list"
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent-fill px-2.5 font-display text-sm font-medium text-white hover:bg-accent-fill/90"
            >
              <IconPlayerPlayFilled size={11} />
              Practice
            </Link>
          ) : (
            <button
              type="button"
              onClick={clearList}
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
          {list.map((id, i) => {
            const p = byId.get(id)!
            // Track practice off: no practiced marks, as in the viewer's queue.
            const done = trackPractice && practicedToday.has(id)
            return (
              <div key={id}>
                {dropAt === i && ghost}
                <div
                  ref={(el) => {
                    if (el) rowRefs.current.set(id, el)
                    else rowRefs.current.delete(id)
                  }}
                  className={`group flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-paper-hover ${
                    reorderId === id ? 'opacity-40' : ''
                  }`}
                >
                  {/* The grip's area runs the row's full height and its left
                      padding, wider on a touch screen, so a finger finds it;
                      the rest of the row scrolls the list. */}
                  <span
                    onPointerDown={(e) => onGripDown(e, id)}
                    className="-my-1.5 -ml-1 flex shrink-0 cursor-grab touch-none items-center justify-center self-stretch pl-1 text-ink-faint touch:w-9"
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
                  {trackPractice && (
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
                  )}
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
          {dragCard &&
            reorderId != null &&
            createPortal(
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
                    {byId.get(reorderId)!.title}
                  </span>
                  <span className="truncate text-xs text-ink-soft">
                    {byId.get(reorderId)!.composer}
                  </span>
                </span>
              </div>,
              document.body,
            )}
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
            {trackPractice && ` • ${practicedCount} practiced today`}
          </span>
          <span className="flex items-center gap-2">
            <span className="tabular-nums">{formatMinutes(totalSeconds)}</span>
            {/* Wide, Clear sits here, since Practice took the header. */}
            {isWide && (
              <button
                type="button"
                onClick={clearList}
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

  return (
    <div className={`${CONTENT_MAX_W} flex flex-1 flex-col gap-5 px-4 py-6 md:px-8`}>
      {/* The page's title. Its Practice button lives with the list it
          plays (D of https://claude.ai/artifact/My1kLD9LpjNwCKsDrejseh): in
          the list's header on a wide screen, where the column is pinned, and
          in a bar pinned to the bottom on a narrow one. */}
      {/* The heading is an instruction with a line of help, like the book
          upload steps, picked from what the page shows
          (lib/practiceHeading.ts). */}
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-medium text-ink">{heading.title}</h1>
        <p className="text-sm text-ink-soft">{heading.help}</p>
      </div>

      <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
        Mockup only: gigs{' '}
        {(['two', 'one', 'none'] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => previewLoad({ gigPreview: g })}
            className={`mx-0.5 cursor-pointer rounded px-1.5 ${gigPreview === g ? 'bg-accent-soft font-semibold text-accent' : 'hover:text-ink'}`}
          >
            {g === 'two' ? 'Two' : g === 'one' ? 'One' : 'None'}
          </button>
        ))}
        • practiced{' '}
        {HISTORY_PREVIEWS.map((h) => (
          <button
            key={h.key}
            type="button"
            onClick={() => previewLoad({ historyPreview: h.key })}
            className={`mx-0.5 cursor-pointer rounded px-1.5 ${historyPreview === h.key ? 'bg-accent-soft font-semibold text-accent' : 'hover:text-ink'}`}
          >
            {h.label}
          </button>
        ))}
        • Track practice{' '}
        {([true, false] as const).map((on) => (
          <button
            key={String(on)}
            type="button"
            onClick={() => previewLoad({ trackPractice: on })}
            className={`mx-0.5 cursor-pointer rounded px-1.5 ${trackPractice === on ? 'bg-accent-soft font-semibold text-accent' : 'hover:text-ink'}`}
          >
            {on ? 'On' : 'Off'}
          </button>
        ))}
        • drawer tip{' '}
        <button
          type="button"
          onClick={() => setTipOpen(true)}
          className="mx-0.5 cursor-pointer rounded px-1.5 hover:text-ink"
        >
          Show again
        </button>
        (narrow only) — tick a list row to mark it practiced today, and today’s circle fills; Clear
        empties the list.
      </div>

      {/* Narrow: gigs, week + list, shelves. Wide: gigs and shelves on the
          left, the week and list pinned on the right for the whole page. */}
      <div className="grid grid-cols-1 gap-6 [grid-template-areas:'gigs'_'rail'_'shelves'] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:[grid-template-areas:'gigs_rail'_'shelves_rail']">
        {gigs.length > 0 ? (
          <div className="@container [grid-area:gigs]">
            {/* Two across only where the column has room for them. */}
            <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
              {gigs.map((s, i) => (
                <GigCard
                  key={s.id}
                  setlist={s}
                  pieceIds={MOCK_GIG_PIECES[i % MOCK_GIG_PIECES.length]}
                  onList={onListSet}
                  onAddMissing={(ids) => {
                    ids.forEach((id) => addToList(id))
                    addedNudge()
                  }}
                />
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
          className="relative z-10 flex flex-col gap-4 [grid-area:rail] lg:sticky lg:top-6 lg:h-[calc(100dvh-3rem)] lg:self-start"
        >
          {/* Nothing is recorded with Track practice off, so no week. */}
          {trackPractice && (
            <WeekBox practicedDays={practicedDays} settings={week} onSettings={setWeek} />
          )}
          {isWide && practiceList}
        </div>

        <div className="flex min-w-0 flex-col gap-6 [grid-area:shelves]">
          {shelves
            .filter((s) => s.pieces.length > 0)
            .map((s) => (
              <Shelf
                key={s.key}
                title={s.title}
                seeAll={(s.total ?? s.pieces.length) > s.pieces.length ? s.seeAll : undefined}
                shuffled={!!seedOf(s.key)}
                onShuffle={() => toggleShuffle(s.key)}
              >
                {() =>
                  s.pieces.map((p) => (
                    <ShelfCard
                      key={p.id}
                      piece={p}
                      detail={s.detail(p)}
                      showStatus={s.showStatus(p)}
                      onList={onList.has(p.id)}
                      onAdd={(from) => addFromCard(p.id, from)}
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
            // B of https://claude.ai/artifact/3WcfhJoJXhAaH7v1cM3SU7: a pull
            // tab that says what it opens, with the list's count; lit for a
            // moment when a piece goes in.
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
                {trackPractice
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
              to="/mockup/sheet-viewer?from=list"
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
              if (!el) return
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
