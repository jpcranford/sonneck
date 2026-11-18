// Annotate's last-used tool settings — each drawing tool's color and size,
// the eraser's size, and the drawing tool last picked (the zoomed bar's
// tool) — kept in this browser's storage, per device (user, 2026-11-17),
// so they carry across sessions and pieces instead of starting from the
// defaults each time. Which tool is picked isn't kept: Annotate still opens
// with none. The real viewer and its mockup share it, as they share the
// tips' count (lib/sheetViewerTips.ts).

const KEY = 'sonneck-sheet-viewer-tools'

type ColorTool = 'pen' | 'highlighter' | 'text'
type Size = 'S' | 'M' | 'L'
type Style = { color: number; size: Size }

export type ToolMemory = {
  toolStyle: Record<ColorTool, Style>
  eraserSize: Size
  lastDrawTool: ColorTool
}

const COLOR_TOOLS: ColorTool[] = ['pen', 'highlighter', 'text']
const SIZES: Size[] = ['S', 'M', 'L']
/** The palette's length (sheetViewerTools' LAYER_COLORS). */
const COLORS = 6

const isSize = (v: unknown): v is Size => SIZES.includes(v as Size)
const isColor = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < COLORS

/** What's stored, each part checked and any missing or invalid one taken
 * from the defaults (`start`). */
export function loadToolMemory(start: ToolMemory): ToolMemory {
  let stored: Partial<ToolMemory>
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ToolMemory>
  } catch {
    return start
  }
  const toolStyle = { ...start.toolStyle }
  for (const tool of COLOR_TOOLS) {
    const s = stored.toolStyle?.[tool]
    toolStyle[tool] = {
      color: isColor(s?.color) ? s.color : start.toolStyle[tool].color,
      size: isSize(s?.size) ? s.size : start.toolStyle[tool].size,
    }
  }
  return {
    toolStyle,
    eraserSize: isSize(stored.eraserSize) ? stored.eraserSize : start.eraserSize,
    lastDrawTool: COLOR_TOOLS.includes(stored.lastDrawTool as ColorTool)
      ? (stored.lastDrawTool as ColorTool)
      : start.lastDrawTool,
  }
}

/** Saves part of the settings, keeping the rest as stored: the colors and
 * sizes live in the viewer's session, the last drawing tool in each
 * piece's viewer, and each saves its own. */
export function saveToolMemory(part: Partial<ToolMemory>) {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ToolMemory>
    localStorage.setItem(KEY, JSON.stringify({ ...stored, ...part }))
  } catch {
    // Storage blocked: the settings last this session only.
  }
}
