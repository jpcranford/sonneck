import { daysUntil } from './dateOnly'

// Setlist gig dates render as a relative "in N weeks" label rather than an
// absolute date (Setlists design pass, decision 10) — the sidebar uses the
// abbreviated "wks" form (space is tight there), the fuller Setlists
// Library page spells "weeks" out in full since it has the room. Both
// reuse this same week math rather than duplicating it.
// `today` (hooks/useToday) keeps the label current on a page left open
// across midnight.
export function formatRelativeWeeks(
  dateISO: string,
  { abbreviated = true, today }: { abbreviated?: boolean; today?: string } = {},
): string {
  const dayDiff = daysUntil(dateISO, today)

  // Within a week it counts days: "in 7 days" down to "in 2 days", then
  // "tomorrow", "today", "yesterday", "2 days ago" to "6 days ago". From 7
  // days back it's weeks again ("1 wk ago").
  if (dayDiff === 0) return 'today'
  if (dayDiff === 1) return 'tomorrow'
  if (dayDiff === -1) return 'yesterday'
  if (dayDiff > 1 && dayDiff <= 7) return `in ${dayDiff} days`
  if (dayDiff < -1 && dayDiff > -7) return `${-dayDiff} days ago`

  const unit = abbreviated ? 'wk' : 'week'
  if (dayDiff > 0) {
    const weeks = Math.round(dayDiff / 7)
    return `in ${weeks} ${unit}${weeks === 1 ? '' : 's'}`
  }
  const weeksAgo = Math.round(-dayDiff / 7)
  return `${weeksAgo} ${unit}${weeksAgo === 1 ? '' : 's'} ago`
}
