import { describe, expect, it } from 'vitest'
import { stageTurn } from './sheetViewerGestures'

const rect = { left: 0, top: 0, width: 900, height: 1200 }
const at = (x: number, y: number, t = 0) => ({ x, y, t })

describe('stageTurn', () => {
  it('taps by side thirds, splitting the middle column top and bottom', () => {
    expect(stageTurn(at(100, 600), at(100, 600), rect)).toBe(-1)
    expect(stageTurn(at(800, 600), at(800, 600), rect)).toBe(1)
    expect(stageTurn(at(450, 200), at(450, 200), rect)).toBe(-1)
    expect(stageTurn(at(450, 1000), at(450, 1000), rect)).toBe(1)
  })

  it('treats a small wobble as a tap', () => {
    expect(stageTurn(at(800, 600), at(808, 605, 100), rect)).toBe(1)
  })

  it('turns forward on a swipe left or up, back on a swipe right or down', () => {
    expect(stageTurn(at(600, 600), at(400, 610, 200), rect)).toBe(1)
    expect(stageTurn(at(400, 600), at(600, 590, 200), rect)).toBe(-1)
    expect(stageTurn(at(450, 800), at(455, 600, 200), rect)).toBe(1)
    expect(stageTurn(at(450, 600), at(445, 800, 200), rect)).toBe(-1)
  })

  it('takes every diagonal by its horizontal part', () => {
    expect(stageTurn(at(600, 600), at(500, 520, 200), rect)).toBe(1)
    expect(stageTurn(at(500, 520), at(600, 600, 200), rect)).toBe(-1)
    expect(stageTurn(at(500, 600), at(600, 520, 200), rect)).toBe(-1)
    expect(stageTurn(at(600, 520), at(500, 600, 200), rect)).toBe(1)
  })

  it('goes by the swipe, not where it starts', () => {
    // A swipe left starting in the left (back) third still turns forward.
    expect(stageTurn(at(250, 600), at(50, 600, 150), rect)).toBe(1)
  })

  it('does nothing for a short or slow drag', () => {
    expect(stageTurn(at(600, 600), at(570, 600, 100), rect)).toBeNull()
    expect(stageTurn(at(600, 600), at(570, 575, 100), rect)).toBeNull()
    expect(stageTurn(at(600, 600), at(400, 600, 1200), rect)).toBeNull()
  })
})
