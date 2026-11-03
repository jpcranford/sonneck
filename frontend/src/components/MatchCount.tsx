import type { ReactNode } from 'react'

/** "37 pieces" at the start of a library's filter row (Pieces, Books,
 * People): how many results match the current filters and search. */
export function MatchCount({
  count,
  singular,
  plural,
  children,
}: {
  count: number
  singular: string
  plural: string
  /** Anything to add after the count (People's "• 12 hidden"). */
  children?: ReactNode
}) {
  return (
    <span className="mr-1 text-xs font-medium tabular-nums text-ink-soft">
      {count.toLocaleString()} {count === 1 ? singular : plural}
      {children}
    </span>
  )
}
