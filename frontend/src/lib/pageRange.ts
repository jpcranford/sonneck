// The piece libraries' Pages filter (design A of
// https://claude.ai/artifact/2uohZcztpi3ajke7bsZCrP, on a 1 to "12+" scale):
// a range of shown pages — the pages the Sheet Viewer shows, skipped ones
// left out (Manage Pages). No markup, so the Library, its mockup and the
// drawer share it.

/** The slider's top stop, meaning "this many or more". */
export const PAGES_TOP = 12

/** A range of shown pages; `max` at PAGES_TOP has no upper limit. */
export interface PageRange {
  min: number
  max: number
}

export const ANY_PAGES: PageRange = { min: 1, max: PAGES_TOP }

/** Whether the range filters nothing out (the whole slider). */
export function isAnyPages(r: PageRange): boolean {
  return r.min <= 1 && r.max >= PAGES_TOP
}

/** A stop as shown: "12+" at the top. */
export function pageStopText(n: number): string {
  return n >= PAGES_TOP ? `${PAGES_TOP}+` : String(n)
}

/** The range in words, for its filter chip and the drawer: "1 page",
 * "4 pages", "3–8 pages", "5+ pages". */
export function pageRangeText(r: PageRange): string {
  if (r.max >= PAGES_TOP) return `${r.min}+ pages`
  if (r.min === r.max) return r.min === 1 ? '1 page' : `${r.min} pages`
  return `${r.min}–${r.max} pages`
}

/** Whether a piece showing `pages` pages is in the range. */
export function inPageRange(pages: number, r: PageRange): boolean {
  return pages >= r.min && (r.max >= PAGES_TOP || pages <= r.max)
}

/** The API's params for a range: none for the whole slider. */
export function pageRangeParams(r: PageRange | null): { minPages?: number; maxPages?: number } {
  if (!r || isAnyPages(r)) return {}
  return {
    minPages: r.min > 1 ? r.min : undefined,
    maxPages: r.max < PAGES_TOP ? r.max : undefined,
  }
}

/** How many pieces a range holds, from the facet's counts by shown pages
 * (each count's `pages` capped at PAGES_TOP). */
export function countInPageRange(
  counts: readonly { pages: number; count: number }[],
  r: PageRange,
): number {
  return counts.reduce((n, c) => (inPageRange(c.pages, r) ? n + c.count : n), 0)
}

/** A typed stop ("8", "12+", " 3 ") as a number within 1–PAGES_TOP, or
 * null when it isn't one. */
export function parsePageStop(text: string): number | null {
  const m = /^\s*(\d+)\s*\+?\s*$/.exec(text)
  if (!m) return null
  return Math.min(PAGES_TOP, Math.max(1, Number(m[1])))
}
