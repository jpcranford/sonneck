import { useMemo, useRef, useState } from 'react'
import { getStroke } from 'perfect-freehand'
import { useMockupTitle } from '../lib/useMockupTitle'
import {
  STROKE_TUNING,
  strokePath,
  type MarkPoint,
  type StrokeMark,
  type StrokeTuning,
} from '../lib/sheetViewerMarks'
import { SIZES } from '../lib/sheetViewerTools'

// A place to tune the Sheet Viewer's pen with a real stylus: draw on a page
// of empty staves, move the sliders, and every stroke redraws with them.
// The shipped pen from before this round can be drawn underneath in red,
// the raw points the stylus sent on top, and the last stroke is shown
// enlarged. Copy settings puts the numbers on the clipboard to report back.

const W = 1000 // the viewer's marks box (SheetViewerAnnotations' MARKS_W)
const ASPECT = 8.5 / 11
const H = W / ASPECT

type PenTool = StrokeMark['tool']
type Size = 'S' | 'M' | 'L'

// The pen as it shipped before this round, for comparison: perfect-freehand's
// getStroke with its defaults' thresholds, worked out at the box's own size.
function legacyPath(mark: StrokeMark) {
  const h = W / ASPECT
  const outline = getStroke(
    mark.points.map(([x, y, p]) => [x * W, y * h, p]),
    {
      size: (mark.size / 100) * W,
      thinning: mark.tool === 'highlighter' ? 0 : 0.5,
      smoothing: 0.5,
      streamline: 0.5,
      simulatePressure: !mark.pressure,
      last: true,
    },
  )
  if (outline.length < 4) return ''
  const mid = (a: number, b: number) => ((a + b) / 2).toFixed(2)
  let [a, b] = outline
  const c = outline[2]
  let d = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${mid(b[0], c[0])},${mid(b[1], c[1])} T`
  for (let i = 2; i < outline.length - 1; i++) {
    a = outline[i]
    b = outline[i + 1]
    d += `${mid(a[0], b[0])},${mid(a[1], b[1])} `
  }
  return `${d}Z`
}

// Five-line staves across the page, like a blank manuscript page.
function Staves() {
  const lines: number[] = []
  const gap = 11
  for (let top = 90; top + 4 * gap < H - 60; top += 120)
    for (let i = 0; i < 5; i++) lines.push(top + i * gap)
  return (
    <g stroke="#b8b2aa" strokeWidth={1}>
      {lines.map((y) => (
        <line key={y} x1={60} x2={W - 60} y1={y} y2={y} />
      ))}
    </g>
  )
}

function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between gap-2 text-sm text-ink">
        {label}
        <span className="text-ink-soft tabular-nums">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-(--color-accent-fill)"
      />
      <span className="text-xs text-ink-soft">{hint}</span>
    </label>
  )
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-(--color-accent-fill)"
      />
      {label}
    </label>
  )
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex rounded-md border border-border">
      {options.map((o, i) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`flex-1 cursor-pointer px-2.5 py-1.5 text-sm capitalize ${i > 0 ? 'border-l border-border' : ''} ${
            value === o
              ? 'bg-accent-fill text-white'
              : 'bg-paper-raised text-ink-soft hover:bg-paper-hover'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

export function PenPlaygroundMockup() {
  useMockupTitle('Pen Playground')
  const [tool, setTool] = useState<PenTool>('pen')
  const [size, setSize] = useState<Size>('M')
  const [tuning, setTuning] = useState<Record<PenTool, StrokeTuning>>(() => ({
    pen: { ...STROKE_TUNING.pen },
    highlighter: { ...STROKE_TUNING.highlighter },
  }))
  const [strokes, setStrokes] = useState<StrokeMark[]>([])
  const [live, setLive] = useState<StrokeMark | null>(null)
  const [showLegacy, setShowLegacy] = useState(false)
  const [showPoints, setShowPoints] = useState(false)
  const [fingerDraws, setFingerDraws] = useState(false)
  const [copied, setCopied] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const drawing = useRef<{ id: number; mark: StrokeMark } | null>(null)

  // The drawing takes every one-finger and stylus drag itself, as the
  // viewer's page does while a drawing tool is picked (touch-action:
  // pinch-zoom): browsers apply touch-action to a stylus too, so any
  // panning allowed here made a stylus stroke scroll the page. A finger drag
  // (unless "A finger draws too") scrolls the page by hand instead.
  const fingerScroll = useRef<{ id: number; y: number; el: HTMLElement | null } | null>(null)
  function scrollParent(el: HTMLElement | null): HTMLElement | null {
    for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
      const o = getComputedStyle(n).overflowY
      if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n
    }
    return document.scrollingElement as HTMLElement | null
  }

  const t = tuning[tool]
  const set = (patch: Partial<StrokeTuning>) =>
    setTuning((old) => ({ ...old, [tool]: { ...old[tool], ...patch } }))

  function point(e: { clientX: number; clientY: number; pressure: number }): MarkPoint | null {
    const r = boxRef.current?.getBoundingClientRect()
    if (!r?.width) return null
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.pressure || 0.5]
  }

  function onDown(e: React.PointerEvent<HTMLDivElement>) {
    if (drawing.current) return
    if (e.pointerType === 'touch' && !fingerDraws) {
      if (!fingerScroll.current)
        fingerScroll.current = { id: e.pointerId, y: e.clientY, el: scrollParent(boxRef.current) }
      return
    }
    if (e.button !== 0) return
    const p = point(e)
    if (!p) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const mark: StrokeMark = {
      id: String(Date.now()),
      kind: 'stroke',
      tool,
      layer: tool === 'pen' ? 0 : 1,
      size: SIZES[tool][size],
      pressure: e.pointerType === 'pen',
      points: [p],
    }
    drawing.current = { id: e.pointerId, mark }
    setLive(mark)
  }
  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const f = fingerScroll.current
    if (f && f.id === e.pointerId) {
      f.el?.scrollBy(0, f.y - e.clientY)
      f.y = e.clientY
      return
    }
    const d = drawing.current
    if (!d || d.id !== e.pointerId) return
    const events = e.nativeEvent.getCoalescedEvents?.() ?? []
    const all = events.length ? events : [e.nativeEvent]
    const added = all.map(point).filter((p): p is MarkPoint => p !== null)
    d.mark = { ...d.mark, points: [...d.mark.points, ...added] }
    setLive(d.mark)
  }
  function onUp(e: React.PointerEvent<HTMLDivElement>) {
    if (fingerScroll.current?.id === e.pointerId) fingerScroll.current = null
    const d = drawing.current
    if (!d || d.id !== e.pointerId) return
    drawing.current = null
    setLive(null)
    setStrokes((s) => [...s, d.mark])
  }

  const last = live ?? strokes[strokes.length - 1] ?? null
  // The last stroke's box, padded, for the enlarged view.
  const zoomBox = useMemo(() => {
    if (!last) return null
    const xs = last.points.map((p) => p[0] * W)
    const ys = last.points.map((p) => p[1] * H)
    const pad = (last.size / 100) * W * 2 + 6
    const x0 = Math.min(...xs) - pad
    const y0 = Math.min(...ys) - pad
    const w = Math.max(...xs) + pad - x0
    const h = Math.max(...ys) + pad - y0
    const side = Math.max(w, h)
    return `${x0 - (side - w) / 2} ${y0 - (side - h) / 2} ${side} ${side}`
  }, [last])

  const ink = (m: StrokeMark) => (m.tool === 'pen' ? 'var(--color-ink)' : '#e8c93a')
  const drawn = (m: StrokeMark, isLive = false) => (
    <g key={m.id}>
      {showLegacy && <path d={legacyPath(m)} fill="#d0453a" opacity={0.45} />}
      <path
        d={strokePath(m, W, ASPECT, !isLive, tuning[m.tool])}
        fill={ink(m)}
        opacity={m.tool === 'highlighter' ? 0.5 : showLegacy ? 0.75 : 1}
        style={m.tool === 'highlighter' ? { mixBlendMode: 'multiply' } : undefined}
      />
      {showPoints &&
        m.points.map(([x, y], i) => (
          <circle key={i} cx={x * W} cy={y * H} r={0.6} fill="#2f7fd0" />
        ))}
    </g>
  )

  // Over plain HTTP (the iPad on the local network) there's no clipboard,
  // so the numbers are also shown, selectable, under the buttons.
  const settingsText = JSON.stringify(tuning, null, 2)
  async function copySettings() {
    try {
      await navigator.clipboard.writeText(settingsText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Select the text below instead.
    }
  }

  return (
    <div className="flex min-h-full flex-col gap-4 px-4 py-6 md:px-8">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-medium text-ink">Pen Playground</h1>
        <p className="max-w-[70ch] text-sm text-ink-soft">
          Write on the staves with the Pencil: ticks, commas, fingering, slurs. Every stroke redraws
          as you move a slider. The page is drawn at the viewer’s own scale.
        </p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div
            ref={boxRef}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            className={`relative w-full overflow-hidden rounded-md border border-border bg-white touch-pinch-zoom select-none [-webkit-touch-callout:none]`}
            style={{ aspectRatio: `${ASPECT}` }}
          >
            <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full">
              <Staves />
              {strokes.map((m) => drawn(m))}
              {live && drawn(live, true)}
            </svg>
          </div>
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-5 lg:sticky lg:top-6 lg:w-80">
          <div className="flex flex-col gap-2">
            <Segmented options={['pen', 'highlighter'] as const} value={tool} onChange={setTool} />
            <Segmented options={['S', 'M', 'L'] as const} value={size} onChange={setSize} />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs tracking-wider text-ink-soft uppercase">
              Last stroke, enlarged
            </span>
            <div className="aspect-square w-full overflow-hidden rounded-md border border-border bg-white">
              {last && zoomBox && (
                <svg viewBox={zoomBox} className="h-full w-full">
                  <Staves />
                  {drawn(last, last === live)}
                </svg>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <Slider
              label="Streamline"
              hint="How far the line lags behind the pen. Lower traces closer; higher is steadier."
              value={t.streamline}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => set({ streamline: v })}
            />
            <Slider
              label="Smoothing"
              hint="How far apart the outline’s nodes are. Lower keeps more detail in tight turns."
              value={t.smoothing}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => set({ smoothing: v })}
            />
            <Slider
              label="Thinning"
              hint="How much light pressure thins the line. 0 is one even width."
              value={t.thinning}
              min={0}
              max={0.9}
              step={0.05}
              onChange={(v) => set({ thinning: v })}
            />
            <Slider
              label="Taper at the start"
              hint="Share of the page width. Asked for 0."
              value={t.taperStart}
              min={0}
              max={0.05}
              step={0.005}
              onChange={(v) => set({ taperStart: v })}
            />
            <Slider
              label="Taper at the end"
              hint="Share of the page width. Asked for 0."
              value={t.taperEnd}
              min={0}
              max={0.05}
              step={0.005}
              onChange={(v) => set({ taperEnd: v })}
            />
            <Check
              label="Round start"
              checked={t.capStart}
              onChange={(v) => set({ capStart: v })}
            />
            <Check label="Round end" checked={t.capEnd} onChange={(v) => set({ capEnd: v })} />
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <Check
              label="Show the old pen underneath (red)"
              checked={showLegacy}
              onChange={setShowLegacy}
            />
            <Check
              label="Show the points the stylus sent (blue)"
              checked={showPoints}
              onChange={setShowPoints}
            />
            <Check label="A finger draws too" checked={fingerDraws} onChange={setFingerDraws} />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setStrokes((s) => s.slice(0, -1))}
              className="cursor-pointer rounded-md border border-border bg-paper-raised px-3 py-1.5 text-sm text-ink hover:border-accent"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={() => setStrokes([])}
              className="cursor-pointer rounded-md border border-border bg-paper-raised px-3 py-1.5 text-sm text-ink hover:border-accent"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => set({ ...STROKE_TUNING[tool] })}
              className="cursor-pointer rounded-md border border-border bg-paper-raised px-3 py-1.5 text-sm text-ink hover:border-accent"
            >
              Reset {tool}
            </button>
            <button
              type="button"
              onClick={copySettings}
              className="cursor-pointer rounded-md bg-accent-fill px-3 py-1.5 text-sm text-white"
            >
              {copied ? 'Copied' : 'Copy settings'}
            </button>
          </div>
          <pre className="overflow-x-auto rounded-md bg-paper-sunken p-3 text-xs text-ink-soft select-all">
            {settingsText}
          </pre>
        </aside>
      </div>
    </div>
  )
}
