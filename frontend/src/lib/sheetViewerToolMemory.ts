// Annotate's last-used tool settings — each drawing tool's color and size,
// the eraser's size, and the drawing tool last picked (the zoomed bar's
// tool) — kept in this browser's storage, per device (user, 2026-11-17),
// so they carry across sessions and pieces instead of starting from the
// defaults each time. Which tool is picked isn't kept: Annotate still opens
// with none. The real viewer and its mockup share it, as they share the
// tips' count (lib/sheetViewerTips.ts).
//
// Sizes are stored as their letters. When the pen and eraser gained a
// smaller S (lib/sheetViewerTools.ts' SIZES), their old S, M and L became M,
// L and XL, keeping their numbers; so letters stored before that (no
// `sizes` version) move up a step as they're read, and a device opens on
// the same pen and eraser it had. The highlighter's and text's didn't move.

import { sizesOf, type Size, type Tool } from './sheetViewerTools'

const KEY = 'sonneck-sheet-viewer-tools'
/** The size letters' version: 2 since the pen and eraser have four. */
const SIZES_VERSION = 2

type ColorTool = 'pen' | 'highlighter' | 'text'
type Style = { color: number; size: Size }

export type ToolMemory = {
  toolStyle: Record<ColorTool, Style>
  eraserSize: Size
  lastDrawTool: ColorTool
}
// As read from storage: anything may be missing or wrong, so it's checked
// part by part on loading.
type Stored = {
  toolStyle?: Partial<Record<ColorTool, Partial<Style>>>
  eraserSize?: Size
  lastDrawTool?: ColorTool
  sizes?: number
}

const COLOR_TOOLS: ColorTool[] = ['pen', 'highlighter', 'text']
/** The palette's length (sheetViewerTools' LAYER_COLORS). */
const COLORS = 6

const isSize = (tool: Tool, v: unknown): v is Size => sizesOf(tool).includes(v as Size)
const isColor = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < COLORS

/** An old (three-size) letter for the pen or eraser, as it's named now. */
const MOVED_UP: Record<string, Size> = { S: 'M', M: 'L', L: 'XL' }

/** What's stored, with sizes stored before the pen and eraser had four
 * moved up a step, so it can be read and saved as today's. */
function readStored(): Stored {
  const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Stored
  if (stored.sizes === SIZES_VERSION) return stored
  const pen = stored.toolStyle?.pen
  return {
    ...stored,
    toolStyle: stored.toolStyle && {
      ...stored.toolStyle,
      pen: pen && { ...pen, size: pen.size && MOVED_UP[pen.size] },
    },
    eraserSize: stored.eraserSize && MOVED_UP[stored.eraserSize],
    sizes: SIZES_VERSION,
  }
}

/** What's stored, each part checked and any missing or invalid one taken
 * from the defaults (`start`). */
export function loadToolMemory(start: ToolMemory): ToolMemory {
  let stored: Stored
  try {
    stored = readStored()
  } catch {
    return start
  }
  const toolStyle = { ...start.toolStyle }
  for (const tool of COLOR_TOOLS) {
    const s = stored.toolStyle?.[tool]
    toolStyle[tool] = {
      color: isColor(s?.color) ? s.color : start.toolStyle[tool].color,
      size: isSize(tool, s?.size) ? s.size : start.toolStyle[tool].size,
    }
  }
  return {
    toolStyle,
    eraserSize: isSize('eraser', stored.eraserSize) ? stored.eraserSize : start.eraserSize,
    lastDrawTool: COLOR_TOOLS.includes(stored.lastDrawTool as ColorTool)
      ? (stored.lastDrawTool as ColorTool)
      : start.lastDrawTool,
  }
}

/** Saves part of the settings, keeping the rest as stored: the colors and
 * sizes live in the viewer's session, the last drawing tool in each
 * piece's viewer, and each saves its own. What's kept is moved up first if
 * it's from before four sizes, so a part saved on its own never marks old
 * letters as moved. */
export function saveToolMemory(part: Partial<ToolMemory>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readStored(), ...part, sizes: SIZES_VERSION }))
  } catch {
    // Storage blocked: the settings last this session only.
  }
}
