// A date-only "YYYY-MM-DD" value (a setlist's gigDate) is a calendar day,
// not an instant. JavaScript has no date-only type, and `new Date(iso)`
// reads a date-only string as midnight UTC — so formatting it in the
// viewer's own timezone (toLocaleDateString's default) shows the previous
// day anywhere west of UTC. These helpers keep such values calendar days:
// formatted in UTC (only the locale — month names, order — follows the
// viewer), and compared as strings or whole days, matching the server's own
// `gigDate < today` string comparison (repo.Setlist.EffectiveArchived).

// formatDateOnly formats a date-only value in the viewer's locale.
export function formatDateOnly(iso: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleDateString(undefined, { ...options, timeZone: 'UTC' })
}

// todayDateOnly is the viewer's own local calendar date as "YYYY-MM-DD".
export function todayDateOnly(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// daysUntil is the number of whole calendar days from the viewer's today to
// a date-only value — 0 on the day itself, negative once it has passed.
export function daysUntil(iso: string): number {
  const toUTCDay = (value: string) => {
    const [y, m, d] = value.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((toUTCDay(iso) - toUTCDay(todayDateOnly())) / 86_400_000)
}
