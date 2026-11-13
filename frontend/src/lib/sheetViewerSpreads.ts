// The Sheet Viewer showing more than one page at a time: how many fit, and
// how pages group into spreads. No markup, so the viewer and its mockup
// share it. Designed on https://claude.ai/artifact/J9T8zCieMcc82cRqRJXKFD.

/** A page shows beside others only while each stays at least this share of
 * the size it would be alone on the screen… */
export const SPREAD_MIN_SHARE = 0.9
/** …and at least this wide, in CSS px (keeps phones to one page). */
export const SPREAD_MIN_WIDTH = 400
/** Space between pages on screen, in CSS px. */
export const SPREAD_GAP = 8

export type SpreadAxis = 'row' | 'column'

export interface PageFit {
  /** How many pages show at once. */
  count: number
  /** Side by side on a landscape screen, stacked on a portrait one. */
  axis: SpreadAxis
  /** Each page's width on screen, and its width alone, in CSS px. */
  width: number
  alone: number
}

/** How many pages of the given shape (width ÷ height) fit in the area: the
 * most that keep each page at SPREAD_MIN_SHARE of its size alone and at
 * least SPREAD_MIN_WIDTH wide, up to `max` (the piece's page count). */
export function fitPages(
  area: { width: number; height: number },
  aspect: number,
  max: number,
): PageFit {
  const { width: W, height: H } = area
  const axis: SpreadAxis = W >= H ? 'row' : 'column'
  const alone = Math.min(W, H * aspect)
  const widthFor = (n: number) =>
    axis === 'row'
      ? Math.min((W - (n - 1) * SPREAD_GAP) / n, H * aspect)
      : Math.min(W, ((H - (n - 1) * SPREAD_GAP) / n) * aspect)
  let count = 1
  for (let n = 2; n <= max; n++) {
    const w = widthFor(n)
    if (w < SPREAD_MIN_SHARE * alone || w < SPREAD_MIN_WIDTH) break
    count = n
  }
  return { count, axis, width: widthFor(count), alone }
}

const range = (from: number, to: number) =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i)

/** Groups a piece's pages into spreads of up to `perScreen`, for turning by
 * spread. `links` holds each page linked to the next (a link on 4 keeps 4
 * and 5 together); `firstAlone` shows page 1 by itself, as printed books
 * do. A spread that already holds a link stays as it is; a link a spread
 * would split pulls the pages before it back until the linked pages share
 * a spread — placed so the run before it fills whole screens when it can,
 * else ending at the link — with the lone page first. A chain of links
 * longer than one screen can't stay together and splits as usual. A link
 * between pages 1 and 2 overrides `firstAlone`. */
export function groupSpreads(
  pageCount: number,
  perScreen: number,
  firstAlone: boolean,
  links: ReadonlySet<number>,
): number[][] {
  if (perScreen < 2) return range(1, pageCount).map((p) => [p])
  const out: number[][] = []
  // Pages before `floor` are settled; later ones may still move.
  let floor = 1
  if (firstAlone && pageCount > 1 && !links.has(1)) {
    out.push([1])
    floor = 2
  }
  let cur = floor
  while (cur <= pageCount) {
    const end = Math.min(cur + perScreen - 1, pageCount)
    if (end < pageCount && links.has(end)) {
      // The chain of linked pages this spread would split.
      let a = end
      while (a > floor && links.has(a - 1)) a--
      let b = end + 1
      while (b < pageCount && links.has(b)) b++
      if (b - a + 1 <= perScreen) {
        let start = Math.max(floor, b - perScreen + 1)
        for (let s = start; s <= a; s++) {
          if ((s - floor) % perScreen === 0) {
            start = s
            break
          }
        }
        const stop = Math.min(start + perScreen - 1, pageCount)
        while (out.length && out[out.length - 1][0] >= floor) out.pop()
        const before: number[][] = []
        for (let e = start - 1; e >= floor; e -= perScreen) {
          before.unshift(range(Math.max(floor, e - perScreen + 1), e))
        }
        out.push(...before, range(start, stop))
        floor = stop + 1
        cur = stop + 1
        continue
      }
    }
    const spread = range(cur, end)
    out.push(spread)
    // A spread holding a link is settled.
    if (spread.some((p, i) => i < spread.length - 1 && links.has(p))) floor = end + 1
    cur = end + 1
  }
  return out
}

/** The pages on screen: the spread holding `page` when turning by spread,
 * or `perScreen` pages from `page` when sliding (fewer only if the piece is
 * shorter). */
export function pagesShown(
  page: number,
  pageCount: number,
  perScreen: number,
  slide: boolean,
  spreads: number[][],
): number[] {
  if (slide || perScreen < 2) {
    const first = Math.max(1, Math.min(page, pageCount - perScreen + 1))
    return range(first, Math.min(pageCount, first + perScreen - 1))
  }
  return spreads.find((s) => s.includes(page)) ?? [page]
}

/** Where a turn goes: the first page of the next or previous spread, or one
 * page along when sliding; null past either end. */
export function turnTarget(
  page: number,
  dir: -1 | 1,
  pageCount: number,
  perScreen: number,
  slide: boolean,
  spreads: number[][],
): number | null {
  if (slide || perScreen < 2) {
    const first = pagesShown(page, pageCount, perScreen, slide, spreads)[0]
    const next = first + dir
    return next < 1 || next > Math.max(1, pageCount - perScreen + 1) ? null : next
  }
  const at = spreads.findIndex((s) => s.includes(page))
  return spreads[at + dir]?.[0] ?? null
}
