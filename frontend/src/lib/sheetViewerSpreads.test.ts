import { describe, expect, it } from 'vitest'
import { fitPages, groupSpreads, pagesShown, turnTarget } from './sheetViewerSpreads'

const LETTER = 612 / 792
const fmt = (spreads: number[][]) => spreads.map((s) => s.join('-')).join(' ')

describe('fitPages', () => {
  it('puts two pages side by side on a landscape tablet', () => {
    // iPad 11" landscape, under the toolbar.
    const fit = fitPages({ width: 1194, height: 777 }, LETTER, 8)
    expect(fit.count).toBe(2)
    expect(fit.axis).toBe('row')
  })
  it('keeps phones to one page, however much room is left', () => {
    expect(fitPages({ width: 852, height: 336 }, LETTER, 8).count).toBe(1)
    expect(fitPages({ width: 393, height: 795 }, LETTER, 8).count).toBe(1)
  })
  it('stacks only when stacking keeps the pages large', () => {
    // Upright pages stacked on a portrait tablet halve in size.
    expect(fitPages({ width: 834, height: 1137 }, LETTER, 8).count).toBe(1)
    // A wide landscape page (a 2:1 part) stacks well.
    const fit = fitPages({ width: 834, height: 1137 }, 2, 8)
    expect(fit.count).toBe(2)
    expect(fit.axis).toBe('column')
  })
  it('shows three on an ultrawide monitor, but never more than the piece has', () => {
    // A 1440p monitor fits only two at 90% (three would be 88%).
    expect(fitPages({ width: 2560, height: 1243 }, LETTER, 8).count).toBe(2)
    expect(fitPages({ width: 3440, height: 1300 }, LETTER, 8).count).toBe(3)
    expect(fitPages({ width: 3440, height: 1300 }, LETTER, 2).count).toBe(2)
  })
})

describe('groupSpreads', () => {
  it('pairs from page 1 with no links', () => {
    expect(fmt(groupSpreads(5, 2, false, new Set()))).toBe('1-2 3-4 5')
  })
  it('shows page 1 alone, pairing the rest from page 2', () => {
    expect(fmt(groupSpreads(9, 2, true, new Set()))).toBe('1 2-3 4-5 6-7 8-9')
  })
  it('shifts the pages before a link a spread would split (lone page first)', () => {
    expect(fmt(groupSpreads(8, 2, false, new Set([4])))).toBe('1 2-3 4-5 6-7 8')
  })
  it('leaves a spread that already holds its link alone', () => {
    expect(fmt(groupSpreads(10, 2, false, new Set([3, 8])))).toBe('1-2 3-4 5 6-7 8-9 10')
    expect(fmt(groupSpreads(9, 3, false, new Set([4])))).toBe('1-2-3 4-5-6 7-8-9')
  })
  it('keeps screens as full as it can when a link forces a shift', () => {
    expect(fmt(groupSpreads(9, 3, false, new Set([3])))).toBe('1 2-3-4 5-6-7 8-9')
    expect(fmt(groupSpreads(12, 3, false, new Set([6])))).toBe('1 2-3-4 5-6-7 8-9-10 11-12')
    expect(fmt(groupSpreads(12, 3, false, new Set([5, 6])))).toBe('1 2-3-4 5-6-7 8-9-10 11-12')
  })
  it('lets a 1–2 link win over page 1 alone', () => {
    expect(fmt(groupSpreads(4, 2, true, new Set([1])))).toBe('1-2 3-4')
  })
  it('splits a chain longer than one screen as usual', () => {
    expect(fmt(groupSpreads(6, 2, false, new Set([2, 3])))).toBe('1-2 3-4 5-6')
  })
  it('gives one page per spread on a one-page screen', () => {
    expect(fmt(groupSpreads(3, 1, true, new Set([1])))).toBe('1 2 3')
  })
})

describe('pagesShown and turnTarget', () => {
  const spreads = groupSpreads(8, 2, false, new Set([4]))
  it('shows the spread holding the page, and turns a spread at a time', () => {
    expect(pagesShown(3, 8, 2, false, spreads)).toEqual([2, 3])
    expect(turnTarget(3, 1, 8, 2, false, spreads)).toBe(4)
    expect(turnTarget(1, -1, 8, 2, false, spreads)).toBeNull()
    expect(turnTarget(8, 1, 8, 2, false, spreads)).toBeNull()
  })
  it('slides a page at a time, ignoring links, and stops with the last page on screen', () => {
    expect(pagesShown(3, 8, 2, true, spreads)).toEqual([3, 4])
    expect(turnTarget(3, 1, 8, 2, true, spreads)).toBe(4)
    expect(turnTarget(7, 1, 8, 2, true, spreads)).toBeNull()
    expect(pagesShown(8, 8, 2, true, spreads)).toEqual([7, 8])
  })
})
