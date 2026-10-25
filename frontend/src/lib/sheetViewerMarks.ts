import { getStroke } from 'perfect-freehand'

// The Sheet Viewer's annotation marks, shared by the mockup and (from Phase
// 18) the real viewer. Every position is a share of the page — x of its
// width, y of its height, both 0–1 — so a mark lands in the same place at
// any render size; sizes are a percent of the page's width.

export type MarkPoint = [x: number, y: number, pressure: number]
export type StrokeMark = {
  id: string
  kind: 'stroke'
  tool: 'pen' | 'highlighter'
  layer: number
  size: number
  points: MarkPoint[]
  // Drawn with a stylus: its pressure shapes the line. Otherwise the
  // pressure is simulated from speed.
  pressure: boolean
}
export type TextMark = {
  id: string
  kind: 'text'
  layer: number
  x: number
  // The baseline.
  y: number
  size: number
  text: string
  italic?: boolean
}
export type Mark = StrokeMark | TextMark

// The stroke's outline as an SVG path, in a box `width` units wide and
// `width / aspect` tall. The pen thins with pressure; the highlighter keeps
// one width, like a chisel tip (the size playground's settings).
export function strokePath(mark: StrokeMark, width: number, aspect: number, last = true) {
  const h = width / aspect
  const outline = getStroke(
    mark.points.map(([x, y, p]) => [x * width, y * h, p]),
    {
      size: (mark.size / 100) * width,
      thinning: mark.tool === 'highlighter' ? 0 : 0.5,
      smoothing: 0.5,
      streamline: 0.5,
      simulatePressure: !mark.pressure,
      last,
    },
  )
  return pathFromOutline(outline)
}

// perfect-freehand's own outline-to-path helper (its README): quadratic
// curves through the midpoints, closed.
function pathFromOutline(points: number[][]) {
  if (points.length < 4) return ''
  const mid = (a: number, b: number) => ((a + b) / 2).toFixed(2)
  let [a, b] = points
  const c = points[2]
  let d = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${mid(b[0], c[0])},${mid(b[1], c[1])} T`
  for (let i = 2; i < points.length - 1; i++) {
    a = points[i]
    b = points[i + 1]
    d += `${mid(a[0], b[0])},${mid(a[1], b[1])} `
  }
  return `${d}Z`
}

// Where a mark's "show this layer" tap area goes: the middle of a stroke's
// path, the middle of a text's line.
export function markAnchor(mark: Mark): [number, number] {
  if (mark.kind === 'text') return [mark.x + textWidth(mark) / 2, mark.y - mark.size / 200]
  const p = mark.points[Math.floor(mark.points.length / 2)]
  return [p[0], p[1]]
}

// A text's rough width, as a share of the page width (about half an em a
// character).
const textWidth = (mark: TextMark) => (mark.size / 100) * 0.5 * mark.text.length

// Does an eraser moved from a to b (page shares) with the given radius (a
// share of the page width) touch the mark? Measured in page-width units, so
// a circle stays round on any page shape.
export function eraserTouches(
  mark: Mark,
  a: [number, number],
  b: [number, number],
  radius: number,
  aspect: number,
) {
  const u = (p: readonly number[]): Vec => [p[0], p[1] / aspect]
  const ea = u(a)
  const eb = u(b)
  if (mark.kind === 'text') {
    const s = mark.size / 100
    const top = u([0, mark.y])[1] - s
    const box = { left: mark.x, right: mark.x + textWidth(mark), top, bottom: top + s * 1.2 }
    return segmentBoxDistance(ea, eb, box) <= radius
  }
  const reach = radius + mark.size / 200
  const pts = mark.points.map(u)
  if (pts.length === 1) return pointSegmentDistance(pts[0], ea, eb) <= reach
  for (let i = 0; i < pts.length - 1; i++) {
    if (segmentDistance(ea, eb, pts[i], pts[i + 1]) <= reach) return true
  }
  return false
}

type Vec = [number, number]
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]]
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1]
const cross = (a: Vec, b: Vec) => a[0] * b[1] - a[1] * b[0]

function pointSegmentDistance(p: Vec, a: Vec, b: Vec) {
  const ab = sub(b, a)
  const len = dot(ab, ab)
  const t = len ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / len)) : 0
  return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t)
}

function segmentDistance(a: Vec, b: Vec, c: Vec, d: Vec) {
  const ab = sub(b, a)
  const cd = sub(d, c)
  const denom = cross(ab, cd)
  if (denom !== 0) {
    const t = cross(sub(c, a), cd) / denom
    const s = cross(sub(c, a), ab) / denom
    if (t >= 0 && t <= 1 && s >= 0 && s <= 1) return 0
  }
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  )
}

function segmentBoxDistance(
  a: Vec,
  b: Vec,
  box: { left: number; right: number; top: number; bottom: number },
) {
  const inside = (p: Vec) =>
    p[0] >= box.left && p[0] <= box.right && p[1] >= box.top && p[1] <= box.bottom
  if (inside(a) || inside(b)) return 0
  const tl: Vec = [box.left, box.top]
  const tr: Vec = [box.right, box.top]
  const br: Vec = [box.right, box.bottom]
  const bl: Vec = [box.left, box.bottom]
  return Math.min(
    segmentDistance(a, b, tl, tr),
    segmentDistance(a, b, tr, br),
    segmentDistance(a, b, br, bl),
    segmentDistance(a, b, bl, tl),
  )
}

// One step of the undo history: the marks a stroke added, or the marks an
// eraser gesture removed with where each sat in the page's list (so an undo
// puts it back at the same depth). `key` names the page it happened on.
export type MarkChange = {
  key: string
  added: Mark[]
  removed: { mark: Mark; index: number }[]
}

// The page's marks with a change undone or redone.
export function applyChange(marks: Mark[], change: MarkChange, direction: 'undo' | 'redo') {
  if (direction === 'redo') {
    const gone = new Set(change.removed.map((r) => r.mark.id))
    return [...marks.filter((m) => !gone.has(m.id)), ...change.added]
  }
  const added = new Set(change.added.map((m) => m.id))
  const out = marks.filter((m) => !added.has(m.id))
  for (const { mark, index } of [...change.removed].sort((x, y) => x.index - y.index)) {
    out.splice(Math.min(index, out.length), 0, mark)
  }
  return out
}

// What an eraser gesture took: the marks in the page's list as the gesture
// began (`before`) that are no longer there, with their places in it.
export function removedSince(before: Mark[], removedIds: ReadonlySet<string>) {
  return before.map((mark, index) => ({ mark, index })).filter((r) => removedIds.has(r.mark.id))
}
