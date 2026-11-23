import { describe, expect, it } from 'vitest'
import type { MarkPoint } from './sheetViewerMarks'
import {
  FULL_PAGE,
  TRIM_MIN,
  clipStroke,
  dragTrim,
  isTrimmed,
  placeTrimmed,
  placeTrimmedInCell,
  trimExtent,
  trimmedAspect,
} from './sheetViewerTrim'

const LETTER = 612 / 792

describe('trimExtent', () => {
  it('takes the widest width and the tallest height, even from two pages', () => {
    const wide = { left: 0.05, top: 0.2, right: 0.95, bottom: 0.8 }
    const tall = { left: 0.2, top: 0.05, right: 0.8, bottom: 0.95 }
    const e = trimExtent([wide, tall])
    expect(e.width).toBeCloseTo(0.9)
    expect(e.height).toBeCloseTo(0.9)
  })
  it('is the whole page with no frames', () => {
    expect(trimExtent([])).toEqual({ width: 1, height: 1 })
  })
})

describe('placeTrimmed', () => {
  const extent = { width: 0.8, height: 0.9 }
  const aspect = trimmedAspect(LETTER, extent)
  const slot = { width: 800, height: 800 / aspect }

  it('draws every page at one scale', () => {
    const a = placeTrimmed(slot, { left: 0.1, top: 0.05, right: 0.9, bottom: 0.95 }, extent)
    const b = placeTrimmed(slot, { left: 0.3, top: 0.3, right: 0.7, bottom: 0.6 }, extent)
    expect(a.page.width).toBeCloseTo(b.page.width)
    expect(a.page.height).toBeCloseTo(b.page.height)
    expect(a.page.width).toBeCloseTo(1000)
  })
  it('fills the slot with the extent-sized frame', () => {
    const p = placeTrimmed(slot, { left: 0.1, top: 0.05, right: 0.9, bottom: 0.95 }, extent)
    expect(p.clip.left).toBeCloseTo(0)
    expect(p.clip.top).toBeCloseTo(0)
    expect(p.clip.width).toBeCloseTo(slot.width)
    expect(p.clip.height).toBeCloseTo(slot.height)
  })
  it('centers a smaller frame and keeps the page in register with it', () => {
    const box = { left: 0.3, top: 0.3, right: 0.7, bottom: 0.6 }
    const p = placeTrimmed(slot, box, extent)
    expect(p.clip.left + p.clip.width / 2).toBeCloseTo(slot.width / 2)
    expect(p.clip.top + p.clip.height / 2).toBeCloseTo(slot.height / 2)
    // The frame's top-left corner of the page sits at the clip's corner.
    expect(p.page.left + box.left * p.page.width).toBeCloseTo(0)
    expect(p.page.top + box.top * p.page.height).toBeCloseTo(0)
  })
  it('keeps an untrimmed piece as it was', () => {
    const s = { width: 612, height: 792 }
    const p = placeTrimmed(s, FULL_PAGE, trimExtent([]))
    expect(p.page).toEqual({ left: -0, top: -0, width: 612, height: 792 })
  })
})

describe('dragTrim', () => {
  const box = { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 }
  it('moves one edge, or a corner’s two', () => {
    expect(dragTrim(box, 'left', 0.05, 0.3)).toEqual({ ...box, left: 0.15000000000000002 })
    const c = dragTrim(box, 'bottom-right', -0.1, -0.2)
    expect(c.right).toBeCloseTo(0.8)
    expect(c.bottom).toBeCloseTo(0.7)
    expect(c.left).toBe(0.1)
  })
  it('stays on the page and never smaller than TRIM_MIN', () => {
    expect(dragTrim(box, 'top', -1, -1).top).toBe(0)
    expect(dragTrim(box, 'right', -5, 0).right).toBeCloseTo(0.1 + TRIM_MIN)
  })
})

describe('isTrimmed', () => {
  it('is false for the whole page or none', () => {
    expect(isTrimmed(undefined)).toBe(false)
    expect(isTrimmed(FULL_PAGE)).toBe(false)
    expect(isTrimmed({ ...FULL_PAGE, left: 0.01 })).toBe(true)
  })
})

describe('clipStroke', () => {
  const box = { left: 0.2, top: 0.2, right: 0.8, bottom: 0.8 }
  const p = (x: number, y: number, z = 0.5): MarkPoint => [x, y, z]
  it('keeps a stroke wholly inside', () => {
    const s = [p(0.3, 0.3), p(0.5, 0.5)]
    expect(clipStroke(s, box)).toEqual([s])
  })
  it('drops a stroke wholly outside', () => {
    expect(clipStroke([p(0, 0), p(0.1, 0.1)], box)).toEqual([])
    expect(clipStroke([p(0.9, 0.5)], box)).toEqual([])
  })
  it('ends a stroke at the edge it leaves by', () => {
    const [run, ...rest] = clipStroke([p(0.5, 0.5, 0), p(1, 0.5, 1)], box)
    expect(rest).toEqual([])
    expect(run[1][0]).toBeCloseTo(0.8)
    expect(run[1][2]).toBeCloseTo(0.6)
  })
  it('splits a stroke that goes out and comes back', () => {
    const runs = clipStroke([p(0.5, 0.5), p(0.9, 0.5), p(0.9, 0.6), p(0.5, 0.6)], box)
    expect(runs).toHaveLength(2)
    expect(runs[0].at(-1)![0]).toBeCloseTo(0.8)
    expect(runs[1][0][0]).toBeCloseTo(0.8)
    expect(runs[1].at(-1)).toEqual(p(0.5, 0.6))
  })
  it('keeps the part of a segment that passes through', () => {
    const runs = clipStroke([p(0, 0.5), p(1, 0.5)], box)
    expect(runs).toHaveLength(1)
    expect(runs[0][0][0]).toBeCloseTo(0.2)
    expect(runs[0][1][0]).toBeCloseTo(0.8)
  })
})

describe('placeTrimmedInCell', () => {
  const extent = { width: 0.8, height: 0.9 }
  const box = { left: 0.1, top: 0.05, right: 0.9, bottom: 0.95 }
  it('fits the trimmed shape in a wide cell, centered across', () => {
    const p = placeTrimmedInCell({ width: 1200, height: 800 }, box, extent, LETTER)
    expect(p.clip.height).toBe(800)
    expect(p.clip.top).toBe(0)
    expect(Math.abs(p.clip.left + p.clip.width / 2 - 600)).toBeLessThanOrEqual(1)
    // The whole page is the frame's size over its share.
    expect(p.page.height).toBe(Math.round(800 / 0.9))
  })
  it('fits it in a tall cell, centered down', () => {
    const p = placeTrimmedInCell({ width: 600, height: 1400 }, box, extent, LETTER)
    expect(p.clip.width).toBe(600)
    expect(Math.abs(p.clip.top + p.clip.height / 2 - 700)).toBeLessThanOrEqual(1)
  })
})
