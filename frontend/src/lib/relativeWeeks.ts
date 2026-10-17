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

  if (dayDiff >= 0 && dayDiff < 7) return dayDiff === 0 ? 'today' : 'this week'
  if (dayDiff < 0 && dayDiff > -7) return 'this week'

  const unit = abbreviated ? 'wk' : 'week'
  if (dayDiff > 0) {
    const weeks = Math.round(dayDiff / 7)
    return `in ${weeks} ${unit}${weeks === 1 ? '' : 's'}`
  }
  const weeksAgo = Math.round(-dayDiff / 7)
  return `${weeksAgo} ${unit}${weeksAgo === 1 ? '' : 's'} ago`
}
