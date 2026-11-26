import { beforeEach, describe, expect, it } from 'vitest'
import { loadToolMemory, saveToolMemory, type ToolMemory } from './sheetViewerToolMemory'

const START: ToolMemory = {
  toolStyle: {
    pen: { color: 5, size: 'M' },
    highlighter: { color: 1, size: 'M' },
    text: { color: 2, size: 'M' },
  },
  eraserSize: 'M',
  lastDrawTool: 'pen',
}

// A stand-in for the browser's storage.
const store = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
})

describe('Annotate tool memory', () => {
  beforeEach(() => store.clear())

  it('starts from the defaults with nothing stored', () => {
    expect(loadToolMemory(START)).toEqual(START)
  })

  it('keeps what each part saved, without one overwriting the other', () => {
    saveToolMemory({
      toolStyle: { ...START.toolStyle, pen: { color: 0, size: 'L' } },
      eraserSize: 'S',
    })
    saveToolMemory({ lastDrawTool: 'highlighter' })
    const m = loadToolMemory(START)
    expect(m.toolStyle.pen).toEqual({ color: 0, size: 'L' })
    expect(m.toolStyle.text).toEqual(START.toolStyle.text)
    expect(m.eraserSize).toBe('S')
    expect(m.lastDrawTool).toBe('highlighter')
  })

  it('takes the default for anything missing or invalid', () => {
    store.set(
      'sonneck-sheet-viewer-tools',
      JSON.stringify({
        toolStyle: { pen: { color: 9, size: 'XL' }, text: { color: 3 } },
        eraserSize: 'huge',
        lastDrawTool: 'eraser',
      }),
    )
    const m = loadToolMemory(START)
    expect(m.toolStyle.pen).toEqual(START.toolStyle.pen)
    expect(m.toolStyle.text).toEqual({ color: 3, size: 'M' })
    expect(m.eraserSize).toBe('M')
    expect(m.lastDrawTool).toBe('pen')
  })

  it('survives unreadable storage', () => {
    store.set('sonneck-sheet-viewer-tools', '{not json')
    expect(loadToolMemory(START)).toEqual(START)
  })

  it("moves the pen's and eraser's letters up a step from before four sizes, once", () => {
    store.set(
      'sonneck-sheet-viewer-tools',
      JSON.stringify({
        toolStyle: {
          pen: { color: 0, size: 'M' },
          highlighter: { color: 1, size: 'L' },
          text: { color: 2, size: 'S' },
        },
        eraserSize: 'L',
      }),
    )
    const m = loadToolMemory(START)
    // The pen's old M (0.39) is now L; the eraser's old L (8) now XL.
    expect(m.toolStyle.pen).toEqual({ color: 0, size: 'L' })
    expect(m.eraserSize).toBe('XL')
    // The highlighter and text kept their letters.
    expect(m.toolStyle.highlighter.size).toBe('L')
    expect(m.toolStyle.text.size).toBe('S')
    // Saved again, read again: not moved a second time.
    saveToolMemory({ toolStyle: m.toolStyle, eraserSize: m.eraserSize })
    expect(loadToolMemory(START).toolStyle.pen.size).toBe('L')
    expect(loadToolMemory(START).eraserSize).toBe('XL')
  })

  it("doesn't let a part saved alone mark old letters as moved", () => {
    store.set(
      'sonneck-sheet-viewer-tools',
      JSON.stringify({ toolStyle: { pen: { color: 5, size: 'S' } }, eraserSize: 'S' }),
    )
    saveToolMemory({ lastDrawTool: 'text' })
    const m = loadToolMemory(START)
    expect(m.toolStyle.pen.size).toBe('M')
    expect(m.eraserSize).toBe('M')
    expect(m.lastDrawTool).toBe('text')
  })

  it('keeps a new S once the letters are current', () => {
    saveToolMemory({
      toolStyle: { ...START.toolStyle, pen: { color: 5, size: 'S' } },
      eraserSize: 'S',
    })
    const m = loadToolMemory(START)
    expect(m.toolStyle.pen.size).toBe('S')
    expect(m.eraserSize).toBe('S')
  })
})
