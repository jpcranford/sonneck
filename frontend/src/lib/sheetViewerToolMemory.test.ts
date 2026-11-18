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
})
