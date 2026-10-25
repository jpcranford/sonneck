import { describe, expect, it } from 'vitest'
import {
  applyChange,
  eraserTouches,
  removedSince,
  strokePath,
  type Mark,
  type StrokeMark,
  type TextMark,
} from './sheetViewerMarks'

const stroke = (id: string, points: [number, number][], size = 0.25): StrokeMark => ({
  id,
  kind: 'stroke',
  tool: 'pen',
  layer: 0,
  size,
  pressure: false,
  points: points.map(([x, y]) => [x, y, 0.5]),
})
const text: TextMark = {
  id: 't',
  kind: 'text',
  layer: 2,
  x: 0.5,
  y: 0.5,
  size: 2.4,
  text: 'cresc.',
}
const ASPECT = 8.5 / 11

describe('eraserTouches', () => {
  const line = stroke('a', [
    [0.2, 0.5],
    [0.8, 0.5],
  ])
  it('touches a stroke it crosses', () => {
    expect(eraserTouches(line, [0.5, 0.4], [0.5, 0.6], 0.01, ASPECT)).toBe(true)
  })
  it('touches a stroke within its radius plus the stroke width', () => {
    // 0.005 of the height is 0.0065 of the width on a Letter page.
    expect(eraserTouches(line, [0.5, 0.505], [0.5, 0.505], 0.01, ASPECT)).toBe(true)
    expect(eraserTouches(line, [0.5, 0.51], [0.5, 0.51], 0.01, ASPECT)).toBe(false)
  })
  it('misses a stroke out of reach', () => {
    expect(eraserTouches(line, [0.5, 0.6], [0.6, 0.6], 0.01, ASPECT)).toBe(false)
    expect(eraserTouches(line, [0.85, 0.5], [0.9, 0.5], 0.01, ASPECT)).toBe(false)
  })
  it('catches a fast swipe that jumps clean over a stroke between two moves', () => {
    expect(eraserTouches(line, [0.5, 0.3], [0.5, 0.7], 0.005, ASPECT)).toBe(true)
  })
  it('touches a single-point dot', () => {
    expect(
      eraserTouches(stroke('d', [[0.3, 0.3]]), [0.302, 0.3], [0.302, 0.3], 0.001, ASPECT),
    ).toBe(true)
  })
  it('touches text inside or near its box, not far from it', () => {
    expect(eraserTouches(text, [0.52, 0.49], [0.52, 0.49], 0.005, ASPECT)).toBe(true)
    expect(eraserTouches(text, [0.52, 0.7], [0.52, 0.7], 0.005, ASPECT)).toBe(false)
  })
})

describe('applyChange', () => {
  const a = stroke('a', [[0.1, 0.1]])
  const b = stroke('b', [[0.2, 0.2]])
  const c = stroke('c', [[0.3, 0.3]])
  it('undoes and redoes an added stroke', () => {
    const change = { key: '1:1', added: [c], removed: [] }
    expect(applyChange([a, b, c], change, 'undo')).toEqual([a, b])
    expect(applyChange([a, b], change, 'redo')).toEqual([a, b, c])
  })
  it('puts erased marks back at their own depth', () => {
    const before: Mark[] = [a, b, c, text]
    const removed = removedSince(before, new Set(['a', 'c']))
    expect(removed.map((r) => r.index)).toEqual([0, 2])
    const change = { key: '1:1', added: [], removed }
    const after = applyChange(before, change, 'redo')
    expect(after).toEqual([b, text])
    expect(applyChange(after, change, 'undo')).toEqual(before)
  })
})

describe('strokePath', () => {
  it('draws a closed outline, and a dot for a tap', () => {
    const path = strokePath(
      stroke('a', [
        [0.2, 0.5],
        [0.4, 0.52],
        [0.6, 0.5],
      ]),
      1000,
      ASPECT,
    )
    expect(path.startsWith('M')).toBe(true)
    expect(path.endsWith('Z')).toBe(true)
    expect(strokePath(stroke('d', [[0.3, 0.3]]), 1000, ASPECT)).not.toBe('')
  })
})
