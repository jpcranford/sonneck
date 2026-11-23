import type { MarkPoint, PageBox } from './sheetViewerMarks'

// Trim Margins (Piece Preparation's second step, designed on
// https://claude.ai/artifact/3mpmGQfJggWhAUPXV5nNVg): each page's trim
// frame as a share of the page, and how trimmed pages are laid out. No
// markup, so the viewer and its mockup share it.

/** A page's trim frame, as shares of the page (like a mark's box). */
export type TrimBox = PageBox

/** No trim: the whole page. */
export const FULL_PAGE: TrimBox = { left: 0, top: 0, right: 1, bottom: 1 }

/** Space between trimmed pages on screen, in CSS px: the edge margin's
 * width, since a trimmed page has no margin of its own to part it from the
 * next (untrimmed pages keep SPREAD_GAP). */
export const TRIMMED_GAP = 24

/** A frame is never dragged smaller than this share of the page, either way. */
export const TRIM_MIN = 0.1

/** The trims' shared extent: the widest frame's width and the tallest
 * frame's height, as shares of the page (possibly from two different
 * pages). A page with no frame counts as the whole page. */
export function trimExtent(boxes: readonly TrimBox[]): { width: number; height: number } {
  let width = 0
  let height = 0
  for (const b of boxes.length ? boxes : [FULL_PAGE]) {
    width = Math.max(width, b.right - b.left)
    height = Math.max(height, b.bottom - b.top)
  }
  return { width, height }
}

/** The shape (width ÷ height) every trimmed page is laid out in: the
 * extent's, so the pages fit and spread as if each were that size. */
export function trimmedAspect(pageAspect: number, extent: { width: number; height: number }) {
  return (extent.width * pageAspect) / extent.height
}

/** Where a trimmed page goes in its slot (a box of trimmedAspect's shape):
 * every page at the one scale the extent sets, its frame centered. `clip`
 * is the frame in the slot's pixels; `page` the whole page image in the
 * clip's pixels (mostly outside it, so the clip hides the trimmed-away
 * part, marks included). */
export function placeTrimmed(
  slot: { width: number; height: number },
  box: TrimBox,
  extent: { width: number; height: number },
) {
  const pageW = slot.width / extent.width
  const pageH = slot.height / extent.height
  const width = (box.right - box.left) * pageW
  const height = (box.bottom - box.top) * pageH
  return {
    clip: { left: (slot.width - width) / 2, top: (slot.height - height) / 2, width, height },
    page: { left: -box.left * pageW, top: -box.top * pageH, width: pageW, height: pageH },
  }
}

/** A trimmed page placed in a cell of any shape (the real viewer's cells
 * fill the screen's height or width): the trimmed shape fitted into the
 * cell and centered, then the page placed in it as placeTrimmed does, all
 * in the cell's pixels and rounded to whole ones. */
export function placeTrimmedInCell(
  cell: { width: number; height: number },
  box: TrimBox,
  extent: { width: number; height: number },
  pageAspect: number,
) {
  const shape = trimmedAspect(pageAspect, extent)
  const width = Math.min(cell.width, cell.height * shape)
  const height = width / shape
  const left = (cell.width - width) / 2
  const top = (cell.height - height) / 2
  const p = placeTrimmed({ width, height }, box, extent)
  const clip = {
    left: Math.round(left + p.clip.left),
    top: Math.round(top + p.clip.top),
    width: Math.round(p.clip.width),
    height: Math.round(p.clip.height),
  }
  return {
    clip,
    page: {
      left: Math.round(p.page.left),
      top: Math.round(p.page.top),
      width: Math.round(p.page.width),
      height: Math.round(p.page.height),
    },
  }
}

/** The sides a trim handle moves: one edge, or a corner's two. */
export type TrimHandle =
  'top' | 'bottom' | 'left' | 'right' | `${'top' | 'bottom'}-${'left' | 'right'}`

/** The frame after dragging `handle` by (dx, dy), shares of the page: kept
 * on the page and never smaller than TRIM_MIN. */
export function dragTrim(box: TrimBox, handle: TrimHandle, dx: number, dy: number): TrimBox {
  const out = { ...box }
  if (handle.startsWith('top')) out.top = Math.min(Math.max(0, box.top + dy), box.bottom - TRIM_MIN)
  if (handle.startsWith('bottom'))
    out.bottom = Math.max(Math.min(1, box.bottom + dy), box.top + TRIM_MIN)
  if (handle.endsWith('left')) out.left = Math.min(Math.max(0, box.left + dx), box.right - TRIM_MIN)
  if (handle.endsWith('right'))
    out.right = Math.max(Math.min(1, box.right + dx), box.left + TRIM_MIN)
  return out
}

/** Whether a frame trims anything. */
export function isTrimmed(box: TrimBox | undefined) {
  return !!box && (box.left > 0 || box.top > 0 || box.right < 1 || box.bottom < 1)
}

const inside = (p: MarkPoint, b: TrimBox) =>
  p[0] >= b.left && p[0] <= b.right && p[1] >= b.top && p[1] <= b.bottom

/** A stroke clipped to a frame: the runs of it inside, each ending on the
 * frame's edge where the stroke crossed it (pressure carried across). A
 * stroke wholly outside gives none. */
export function clipStroke(points: readonly MarkPoint[], box: TrimBox): MarkPoint[][] {
  const runs: MarkPoint[][] = []
  let run: MarkPoint[] = []
  // Where the segment a→b crosses the frame's edge, between t0 and t1 of
  // the way (Liang–Barsky), or null if it misses the frame.
  const cross = (a: MarkPoint, b: MarkPoint) => {
    let t0 = 0
    let t1 = 1
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const edges: [number, number][] = [
      [-dx, a[0] - box.left],
      [dx, box.right - a[0]],
      [-dy, a[1] - box.top],
      [dy, box.bottom - a[1]],
    ]
    for (const [p, q] of edges) {
      if (p === 0) {
        if (q < 0) return null
      } else {
        const t = q / p
        if (p < 0) t0 = Math.max(t0, t)
        else t1 = Math.min(t1, t)
      }
    }
    return t0 <= t1 ? [t0, t1] : null
  }
  const at = (a: MarkPoint, b: MarkPoint, t: number): MarkPoint => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]
  if (points.length === 1) return inside(points[0], box) ? [[points[0]]] : []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const span = cross(a, b)
    if (!span) continue
    const [t0, t1] = span
    if (t0 > 0 || run.length === 0) {
      if (run.length) runs.push(run)
      run = [at(a, b, t0)]
    }
    run.push(t1 < 1 ? at(a, b, t1) : b)
    if (t1 < 1) {
      runs.push(run)
      run = []
    }
  }
  if (run.length) runs.push(run)
  return runs
}
