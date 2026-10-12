export interface EmptyMessage {
  title: string
  detail?: string
}

/** A library search or filter that found nothing: names the search when
 * there is one, and only suggests fewer filters when some are on. */
export function noMatchMessage(noun: string, query: string, hasFilters: boolean): EmptyMessage {
  const q = query.trim()
  if (q) {
    return {
      title: `No ${noun} match “${q}”`,
      detail: hasFilters ? 'Check the spelling, or try fewer filters.' : 'Check the spelling.',
    }
  }
  return { title: `No ${noun} match these filters`, detail: 'Try fewer filters.' }
}
