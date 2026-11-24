// The Practice Dashboard's heading: an instruction picked from what the
// page shows, with a line of help under it (the book upload steps' style).
// First that applies wins:
//   1. choose — never practiced;
//   2. week   — practiced on a day of the This Week box's week;
//   3. gig    — a gig within the page's gig window (its gig cards);
//   4. choose — nothing practiced in over a month;
//   5. resume — otherwise, or `choose` again when the list is empty.
// With Track practice off there's no history to go by: gig, then resume
// (without the line about marking pieces practiced), then choose.
// The page picks the heading once, as it loads, and keeps it: changes made
// on the page (the list, a practiced tick) don't change it until the next
// visit.

import { daysUntil } from './dateOnly'

export type PracticeHeadingKind = 'choose' | 'week' | 'gig' | 'resume'

export interface PracticeHeading {
  kind: PracticeHeadingKind
  title: string
  help: string
}

export interface PracticeHeadingInput {
  /** Today, YYYY-MM-DD (the viewer's local day). */
  today: string
  /** Days practiced, YYYY-MM-DD (the page loads the last six weeks). */
  practicedDays: Iterable<string>
  /** The This Week box: its seven days, and its mode. */
  weekDays: string[]
  weekMode: 'daily' | 'target'
  weekTarget: number
  /** The soonest gig the page shows a card for, if any. */
  nextGig: { name: string; gigDate: string } | null
  listLength: number
  /** User Settings › Sheet Viewer › Track practice. */
  trackPractice: boolean
}

/** Over this many days since the last practiced day counts as starting over. */
export const PRACTICE_LAPSE_DAYS = 30

const CHOOSE: PracticeHeading = {
  kind: 'choose',
  title: 'Choose what to practice',
  help: 'Press + on a piece below to add it to your Practice List, drag the list into order, then press Practice to play through it.',
}

export function practiceHeading(input: PracticeHeadingInput): PracticeHeading {
  const { today, weekDays, weekMode, weekTarget, nextGig, listLength, trackPractice } = input

  if (!trackPractice) {
    if (nextGig) return gigHeading(nextGig, today)
    if (listLength === 0) return CHOOSE
    return {
      kind: 'resume',
      title: RESUME_TITLE,
      help: 'Your Practice List is ready to play from the top.',
    }
  }

  const days = new Set(input.practicedDays)

  // 1. New here.
  let latest: string | null = null
  for (const d of days) if (d <= today && (latest === null || d > latest)) latest = d
  if (latest === null) return CHOOSE

  // 2. Practiced this week.
  const done = weekDays.filter((d) => d <= today && days.has(d)).length
  if (done > 0) {
    const today_ = days.has(today)
    let help: string
    if (weekMode === 'daily') {
      help = today_
        ? `You’ve practiced ${dayCount(done)} of the last 7, today included.`
        : `You’ve practiced ${dayCount(done)} of the last 7. Practice today to keep it going.`
    } else if (done >= weekTarget) {
      help = `You’ve practiced ${dayCount(done)} this week, meeting your target of ${weekTarget}.`
    } else {
      const lastDay = weekdayName(weekDays[6])
      help = today_
        ? `You’ve practiced ${done} of ${weekTarget} days this week, today included.`
        : `You’ve practiced ${done} of ${weekTarget} days this week. Practice today to stay on track for ${lastDay}.`
    }
    return { kind: 'week', title: 'Keep the week going', help }
  }

  // 3. A gig coming up.
  if (nextGig) return gigHeading(nextGig, today)

  // 4. Back after a long gap.
  if (-daysUntil(latest, today) > PRACTICE_LAPSE_DAYS) return CHOOSE

  // 5. Back to the list.
  if (listLength === 0) return CHOOSE
  return {
    kind: 'resume',
    title: RESUME_TITLE,
    help: 'Your Practice List is ready to play from the top. A piece is marked practiced after 30 seconds on it in the viewer.',
  }
}

const RESUME_TITLE = 'Pick up where you left off'

function gigHeading(gig: { name: string; gigDate: string }, today: string): PracticeHeading {
  return {
    kind: 'gig',
    title: 'Get ready for your next gig',
    help: `${gig.name} is ${whenGig(daysUntil(gig.gigDate, today))}. Add its pieces to your Practice List, or press Practice on its card to run through the setlist.`,
  }
}

function dayCount(n: number): string {
  return n === 1 ? '1 day' : `${n} days`
}

function whenGig(days: number): string {
  if (days <= 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

function weekdayName(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    timeZone: 'UTC',
  })
}
