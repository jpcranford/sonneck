import type { CSSProperties } from 'react'
import { IconBallpen, IconEraser, IconHighlight, IconTypography } from '@tabler/icons-react'
import type { MarkChange, TextMark } from './sheetViewerMarks'

// The Sheet Viewer's annotation tools (routes/SheetViewerPage.tsx, drawn by
// components/SheetViewerAnnotations.tsx): the tools, their colors and sizes,
// and helpers for text boxes and undo pills. From /mockup/sheet-viewer,
// which keeps its own copies as the design's frozen reference.

export const TOOLS = [
  { key: 'pen', label: 'Pen', Icon: IconBallpen },
  { key: 'highlighter', label: 'Highlighter', Icon: IconHighlight },
  { key: 'text', label: 'Text', Icon: IconTypography },
  // Last, after the three tools that draw in a color.
  { key: 'eraser', label: 'Eraser', Icon: IconEraser },
] as const
export type Tool = (typeof TOOLS)[number]['key']
// See toolsInline.
export const TOOLS_INLINE_MIN_WIDTH = 720
/** From this width Layers, Undo and Redo join the tools on the right of
 * Annotate's one-row toolbar: the whole group (with a tool's circle) first
 * clears the centered page cyclers at 1080px, and keeps 10px from them here. */
export const TOOLS_ALL_RIGHT_MIN_WIDTH = 1100
// The annotation palette (Phases 11–13): six colors, each its own layer.
// Each is tuned so a mark reads as well where it crosses a note as on blank
// paper, which lands on nearly the same value on a white page and on Dark
// Mode Scores — one set for both — and a little deeper on the dark theme's
// dimmed page. Ink is the exception: it's for correcting the print, so it
// stays close to (not quite) the printed ink, and on an inverted page it's
// that ink as the page's own invert shows it. Yellow is the highlighter's;
// it sits behind the notes, multiplied on light pages and screened on dark
// ones.
export const LAYER_COLORS: { name: string; light: string; dim: string; dark: string }[] = [
  { name: 'Red', light: '#d73d2d', dim: '#c43426', dark: '#d63a2a' },
  { name: 'Yellow', light: '#f2c12e', dim: '#f2c12e', dark: '#f2c12e' },
  { name: 'Blue', light: '#2c71e2', dim: '#1d64d8', dark: '#2a70e2' },
  { name: 'Green', light: '#1b8749', dim: '#187941', dark: '#1a8548' },
  { name: 'Purple', light: '#8e5fc3', dim: '#8350bd', dark: '#8d5ec3' },
  { name: 'Ink', light: '#2b2622', dim: '#2b2622', dark: '#d3cfcb' },
]
// How the page currently looks: white, the dark theme's dimmed page, or
// inverted (Dark Mode Scores, or the photo panel's Invert).
export type PageLook = 'light' | 'dim' | 'dark'
export const layerColor = (layer: number, look: PageLook) => LAYER_COLORS[layer][look]
// A letter drawn on a color's dot (the size letter on the color-and-size
// button): Ink's dark brown on a light dot, white on a dark one, judged by
// the dot as it shows on this page — Yellow always, and Ink once the page
// is inverted, take the dark letter.
export function labelColorOn(hex: string): string {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
  return luminance > 0.4 ? LAYER_COLORS[5].light : '#ffffff'
}
export const layerLabelColor = (layer: number, look: PageLook) =>
  labelColorOn(layerColor(layer, look))
// The tools' sizes, as a share of the page's width (picked in the size
// playground; the pen's retuned on the iPad), so a mark keeps its weight at
// any screen size. The eraser's is the width of its reach; its L is about
// 28pt across on an iPad in landscape.
//
// The pen and eraser have four: a smaller S under what were S, M and L,
// which moved up a step to M, L and XL keeping their numbers
// (https://claude.ai/artifact/6xe2m4JqWWz6W376tZhb4y). A saved mark keeps
// its own number, never a letter, so no mark changed; each device's
// remembered letters moved up with them (lib/sheetViewerToolMemory.ts).
// The highlighter and text keep their three.
export type Size = 'S' | 'M' | 'L' | 'XL'
export const SIZES: Record<Tool, Partial<Record<Size, number>>> = {
  pen: { S: 0.15, M: 0.25, L: 0.39, XL: 0.58 },
  highlighter: { S: 1.2, M: 2, L: 3 },
  text: { S: 1.4, M: 1.8, L: 2.4 },
  eraser: { S: 1.9, M: 3, L: 5, XL: 8 },
}
export const SIZE_NAMES: Record<Size, string> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra large',
}
/** A tool's sizes, smallest first. */
export const sizesOf = (tool: Tool) => Object.keys(SIZES[tool]) as Size[]
/** A size's number for a tool; for a size it doesn't have, its largest. */
export function sizeValue(tool: Tool, size: Size): number {
  const own = SIZES[tool][size]
  if (own !== undefined) return own
  const list = sizesOf(tool)
  return SIZES[tool][list[list.length - 1]]!
}
// Each tool remembers its own color and size; these are where they start:
// the pen in Ink, the highlighter in Yellow, text in Blue.
export type ColorTool = 'pen' | 'highlighter' | 'text'
export const TOOL_START: Record<ColorTool, { color: number; size: Size }> = {
  pen: { color: 5, size: 'L' },
  highlighter: { color: 1, size: 'M' },
  text: { color: 2, size: 'M' },
}

// What an undo step did, for its pill: marks added, erased, or a text mark
// edited or moved (one replaced by another).
export function describeChange(change: MarkChange) {
  const added = change.added[0]
  if (change.added.length && change.removed.length) return 'text edit'
  if (!added)
    return change.removed.length > 1
      ? 'erase'
      : change.removed[0]?.mark.kind === 'text'
        ? 'text removed'
        : 'erase'
  if (added.kind === 'text') return 'text'
  return added.tool === 'highlighter' ? 'highlight' : 'pen stroke'
}

// An open text box (Phase 17): a new one (original null) or an existing
// text mark being edited, which is hidden while its box is open.
export type TextEdit = {
  key: string
  x: number
  y: number
  layer: number
  size: number
  italic?: boolean
  text: string
  original: TextMark | null
}
// Where a text mark (or its box) sits: its left edge at x, its first line's
// box one size above the baseline, at its size (a percent of the page's
// width, so cqw on the page-wide text layer), wrapping at the page's edge.
export function textBoxStyle(m: { x: number; y: number; size: number }): CSSProperties {
  return {
    left: `${m.x * 100}%`,
    top: `calc(${m.y * 100}% - ${m.size}cqw)`,
    fontSize: `${m.size}cqw`,
    maxWidth: `calc(${(1 - m.x) * 100}% - 1cqw)`,
    // Not the app's Cabin tracking (body's 0.02em, inherited as a fixed
    // 0.32px), which would set a note tighter or looser with the screen and
    // so wrap it differently: plain Lexend, as annotated PDFs draw it.
    letterSpacing: 'normal',
    // Lexend Medium (bold is its 700): heavy enough to read from the stand.
    fontWeight: 500,
  }
}
// How far above the keyboard an open text box stays, in px.
export const LIFT_GAP = 16
