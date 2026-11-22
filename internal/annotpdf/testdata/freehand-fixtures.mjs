// Outlines from the real perfect-freehand, for internal/annotpdf's Go port
// (freehand_test.go). From the repo root, after `npm install` in frontend/:
//   node internal/annotpdf/testdata/freehand-fixtures.mjs > internal/annotpdf/testdata/freehand.json
import {
  getStroke,
  getStrokeOutlinePoints,
  getStrokePoints,
} from '../../../frontend/node_modules/perfect-freehand/dist/esm/index.mjs'
let seed = 7
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const walk = (n, pressure) => {
  const pts = []; let x = 200, y = 300, a = 0
  for (let i = 0; i < n; i++) { a += (rand() - 0.5) * 0.6; x += Math.cos(a) * 4 * rand(); y += Math.sin(a) * 4 * rand(); pts.push([x, y, pressure ? 0.2 + 0.7 * rand() : 0.5]) }
  return pts
}
const zigzag = [[100, 100, 0.5], [140, 100, 0.5], [180, 100, 0.5], [220, 100, 0.5], [180, 101, 0.5], [140, 102, 0.5], [100, 103, 0.5], [120, 130, 0.5], [160, 160, 0.5]]
const cases = [
  { name: 'pen walk simulated', points: walk(60, false), opts: { size: 3.9, thinning: 0.5, pressure: false } },
  { name: 'pen walk pressure', points: walk(80, true), opts: { size: 5.8, thinning: 0.5, pressure: true } },
  { name: 'highlighter walk', points: walk(50, false), opts: { size: 20, thinning: 0, pressure: false } },
  { name: 'pen zigzag', points: zigzag, opts: { size: 3.9, thinning: 0.5, pressure: false } },
  { name: 'highlighter zigzag', points: zigzag, opts: { size: 30, thinning: 0, pressure: false } },
  { name: 'pen dot', points: [[400, 400, 0.5]], opts: { size: 3.9, thinning: 0.5, pressure: false } },
  { name: 'pen two points', points: [[400, 400, 0.5], [430, 410, 0.5]], opts: { size: 2.5, thinning: 0.5, pressure: false } },
  { name: 'highlighter dot', points: [[10, 10, 0.5]], opts: { size: 12, thinning: 0, pressure: false } },
  { name: 'pen short', points: walk(4, true), opts: { size: 3.9, thinning: 0.5, pressure: true } },
]
const out = cases.map((c) => ({
  name: c.name, points: c.points, size: c.opts.size, thinning: c.opts.thinning, pressure: c.opts.pressure,
  smoothing: 0.5, streamline: 0.5, viewer: false,
  outline: getStroke(c.points, { size: c.opts.size, thinning: c.opts.thinning, smoothing: 0.5, streamline: 0.5, simulatePressure: !c.opts.pressure, last: true }),
}))
// The viewer's own pipeline (sheetViewerMarks.ts's strokePath): points
// traced with no size, then outlined, at 10x scale, with the pen's tuning.
const x10 = (pts) => pts.map(([x, y, p]) => [x * 10, y * 10, p])
const tick = Array.from({ length: 7 }, (_, i) => [500 + i, 500, 0.5])
const viewerCases = [
  { name: 'viewer pen walk pressure', points: x10(walk(80, true)), size: 58, thinning: 0.5, pressure: true, smoothing: 0.25, streamline: 0.2 },
  { name: 'viewer pen zigzag', points: x10(zigzag), size: 39, thinning: 0.5, pressure: false, smoothing: 0.25, streamline: 0.2 },
  { name: 'viewer pen tick', points: x10(tick), size: 39, thinning: 0.5, pressure: false, smoothing: 0.25, streamline: 0.2 },
  { name: 'viewer pen short pressure', points: x10(walk(5, true)), size: 39, thinning: 0.5, pressure: true, smoothing: 0.25, streamline: 0.2 },
  { name: 'viewer pen dot', points: x10([[400, 400, 0.5]]), size: 39, thinning: 0.5, pressure: false, smoothing: 0.25, streamline: 0.2 },
  { name: 'viewer highlighter walk', points: x10(walk(50, false)), size: 200, thinning: 0, pressure: false, smoothing: 0.5, streamline: 0.5 },
]
for (const c of viewerCases) {
  const traced = getStrokePoints(c.points, { size: Number.EPSILON, streamline: c.streamline, last: true })
  out.push({
    ...c,
    viewer: true,
    outline: getStrokeOutlinePoints(traced, {
      size: c.size, thinning: c.thinning, smoothing: c.smoothing, simulatePressure: !c.pressure, last: true,
      start: { taper: 0, cap: true }, end: { taper: 0, cap: true },
    }),
  })
}
console.log(JSON.stringify(out))
