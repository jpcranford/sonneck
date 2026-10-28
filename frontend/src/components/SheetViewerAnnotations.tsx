import type { ReactNode } from 'react'
import { useRef } from 'react'
import { MarkdownText } from './MarkdownText'
import {
  markAnchor,
  strokePath,
  TEXT_LINE_HEIGHT,
  type Mark,
  type StrokeMark,
  type TextMark,
} from '../lib/sheetViewerMarks'
import { LAYER_COLORS, layerColor, textBoxStyle, type PageLook } from '../lib/sheetViewerTools'

// The Sheet Viewer's annotation layer (routes/SheetViewerPage.tsx): the
// marks drawn over a page — strokes, and text as real text. Ported from
// /mockup/sheet-viewer (SheetViewerMockup.tsx keeps its own copies, as the
// design's frozen reference); the mark logic is lib/sheetViewerMarks.ts, the
// tools lib/sheetViewerTools.ts.

// The page's text marks, as real text over it (plan: DOM elements, through
// MarkdownText with the :shortcode: symbols), in Quintessential. Hidden
// colors' text shows as a ghost like any mark. With the Text tool picked
// (onDragEnd and the rest), a text mark takes the pointer: a tap edits it, a drag moves it.
// Children (the open text box) share its page-wide container.
export function TextMarks({
  marks,
  hidden,
  ghosts,
  look,
  drag,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
  children,
}: {
  marks: TextMark[]
  hidden: number[]
  ghosts: boolean
  look: PageLook
  drag: { id: string; dx: number; dy: number } | null
  // With the Text tool picked: a press on a text mark, its drag, its lift
  // (moved, or a tap) and a cancel. Without them, text marks ignore the
  // pointer.
  onDragStart?: () => void
  onDragMove?: (id: string, dx: number, dy: number) => void
  onDragEnd?: (m: TextMark, dx: number, dy: number, moved: boolean) => void
  onDragCancel?: () => void
  children?: ReactNode
}) {
  const press = useRef<{ x: number; y: number; moved: boolean; dx: number; dy: number } | null>(
    null,
  )
  const shown = ghosts ? marks : marks.filter((m) => !hidden.includes(m.layer))
  return (
    <div className="pointer-events-none absolute inset-0" style={{ containerType: 'inline-size' }}>
      {shown.map((m) => {
        const ghost = hidden.includes(m.layer)
        const live = !!onDragEnd && !ghost
        const at = drag?.id === m.id ? { ...m, x: m.x + drag.dx, y: m.y + drag.dy } : m
        return (
          <div
            key={m.id}
            data-text-mark={m.id}
            className={`absolute w-max [overflow-wrap:anywhere] ${
              live ? 'pointer-events-auto cursor-move touch-none' : ''
            }`}
            style={{
              ...textBoxStyle(at),
              lineHeight: TEXT_LINE_HEIGHT,
              color: ghost ? '#7a746e' : layerColor(m.layer, look),
              opacity: ghost ? GHOST_OPACITY : 1,
              fontStyle: m.italic ? 'italic' : undefined,
            }}
            onPointerDown={
              live
                ? (event) => {
                    event.stopPropagation()
                    if (event.button !== 0) return
                    onDragStart?.()
                    event.currentTarget.setPointerCapture(event.pointerId)
                    press.current = {
                      x: event.clientX,
                      y: event.clientY,
                      moved: false,
                      dx: 0,
                      dy: 0,
                    }
                  }
                : undefined
            }
            onPointerMove={
              live
                ? (event) => {
                    const p = press.current
                    const page = event.currentTarget.parentElement?.getBoundingClientRect()
                    if (!p || !page?.width) return
                    const mx = event.clientX - p.x
                    const my = event.clientY - p.y
                    if (!p.moved && Math.hypot(mx, my) < 8) return
                    p.moved = true
                    p.dx = mx / page.width
                    p.dy = my / page.height
                    onDragMove?.(m.id, p.dx, p.dy)
                  }
                : undefined
            }
            onPointerUp={
              live
                ? (event) => {
                    event.stopPropagation()
                    const p = press.current
                    press.current = null
                    if (p) onDragEnd?.(m, p.dx, p.dy, p.moved)
                  }
                : undefined
            }
            onPointerCancel={
              live
                ? () => {
                    press.current = null
                    onDragCancel?.()
                  }
                : undefined
            }
          >
            {/* Paragraphs (a blank line) sit 0.5em apart — MarkdownText's
                0.5rem, at the mark's own size, so the gap scales with the
                text on every screen, as annotated PDFs draw it. */}
            <MarkdownText className="font-hand! [&_:is(p,ul,ol)]:mb-[0.5em]">{m.text}</MarkdownText>
          </div>
        )
      })}
      {children}
    </div>
  )
}

// The page's marks over it, in each layer's color for the page's look. A
// hidden layer's marks stay as a faint gray ghost (H2) in Play and
// Annotate, so hiding never reads as "nothing here"; in Annotate each ghost
// is a 48pt tap area that shows its layer again (I). Those taps never turn
// the page. The stroke being drawn, and the eraser's reach while it's down,
// draw on top.
export function PageMarks({
  marks,
  live,
  eraserAt,
  eraserRadius,
  hidden,
  ghosts,
  aspect,
  look,
  onShowLayer,
}: {
  marks: Mark[]
  live: StrokeMark | null
  eraserAt: [number, number] | null
  eraserRadius: number
  hidden: number[]
  // Hidden colors' marks as faint ghosts; off (User Settings), not at all.
  ghosts: boolean
  aspect: number
  look: PageLook
  onShowLayer?: (layer: number) => void
}) {
  const w = MARKS_W
  const h = w / aspect
  const shown = ghosts ? marks : marks.filter((m) => !hidden.includes(m.layer))
  return (
    <>
      {/* Strokes only; text marks are real text (TextMarks). */}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        {shown.map(
          (m) =>
            m.kind === 'stroke' && (
              <MarkShape
                key={m.id}
                mark={m}
                ghost={hidden.includes(m.layer)}
                look={look}
                aspect={aspect}
              />
            ),
        )}
        {live && (
          <MarkShape
            mark={live}
            ghost={hidden.includes(live.layer)}
            look={look}
            aspect={aspect}
            live
          />
        )}
        {eraserAt && (
          <circle
            cx={eraserAt[0] * w}
            cy={eraserAt[1] * h}
            r={eraserRadius * w}
            fill="rgb(122 116 110 / 0.12)"
            stroke="#7a746e"
            strokeWidth={1.5}
          />
        )}
      </svg>
      {onShowLayer &&
        shown.map((m) => {
          if (!hidden.includes(m.layer)) return null
          const [x, y] = markAnchor(m)
          return (
            <button
              key={m.id}
              type="button"
              data-hit
              aria-label={`Show ${LAYER_COLORS[m.layer].name}`}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
              onClick={() => onShowLayer(m.layer)}
              className="absolute size-12 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full hover:bg-ink/5"
              style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
            />
          )
        })}
    </>
  )
}

// One mark. Its own component, so a finished stroke's outline is worked
// out once (the compiler keeps it) rather than again on every frame of the
// stroke being drawn.
const MARKS_W = 1000
// Ghost marks: warm grey at 12% on every page look (tuned in the ghost
// playground, https://claude.ai/artifact/Sjh9udhJz2mLTLuZf2CrSS).
const GHOST_OPACITY = 0.12
function MarkShape({
  mark: m,
  ghost,
  look,
  aspect,
  live = false,
}: {
  mark: Mark
  ghost: boolean
  look: PageLook
  aspect: number
  live?: boolean
}) {
  const w = MARKS_W
  const color = ghost ? '#7a746e' : layerColor(m.layer, look)
  if (m.kind === 'text') return null
  const highlight = m.tool === 'highlighter'
  return (
    <path
      d={strokePath(m, w, aspect, !live)}
      fill={color}
      opacity={ghost ? GHOST_OPACITY : highlight ? (look === 'dark' ? 0.55 : 0.42) : 1}
      // Highlighter: multiplied on light pages, screened on dark ones.
      style={
        highlight && !ghost ? { mixBlendMode: look === 'dark' ? 'screen' : 'multiply' } : undefined
      }
    />
  )
}
