import { describe, expect, it } from 'vitest'
import {
  ANY_PAGES,
  PAGES_TOP,
  countInPageRange,
  inPageRange,
  isAnyPages,
  pageRangeParams,
  pageRangeText,
  parsePageStop,
} from './pageRange'

describe('pageRangeText', () => {
  it('names a single count, a range and an open top', () => {
    expect(pageRangeText({ min: 1, max: 1 })).toBe('1 page')
    expect(pageRangeText({ min: 4, max: 4 })).toBe('4 pages')
    expect(pageRangeText({ min: 3, max: 8 })).toBe('3–8 pages')
    expect(pageRangeText({ min: 5, max: PAGES_TOP })).toBe('5+ pages')
    expect(pageRangeText({ min: PAGES_TOP, max: PAGES_TOP })).toBe('12+ pages')
  })
})

describe('inPageRange', () => {
  it('treats the top stop as "or more"', () => {
    expect(inPageRange(26, { min: 5, max: PAGES_TOP })).toBe(true)
    expect(inPageRange(26, { min: 5, max: 11 })).toBe(false)
    expect(inPageRange(4, { min: 5, max: PAGES_TOP })).toBe(false)
    expect(inPageRange(5, { min: 5, max: 5 })).toBe(true)
  })
})

describe('pageRangeParams', () => {
  it('sends nothing for the whole slider, and only the ends that limit', () => {
    expect(pageRangeParams(null)).toEqual({})
    expect(pageRangeParams(ANY_PAGES)).toEqual({})
    expect(pageRangeParams({ min: 3, max: PAGES_TOP })).toEqual({
      minPages: 3,
      maxPages: undefined,
    })
    expect(pageRangeParams({ min: 1, max: 8 })).toEqual({ minPages: undefined, maxPages: 8 })
    expect(isAnyPages({ min: 1, max: 8 })).toBe(false)
  })
})

describe('countInPageRange', () => {
  it('sums the counts in the range', () => {
    const counts = [
      { pages: 1, count: 46 },
      { pages: 3, count: 15 },
      { pages: 8, count: 3 },
      { pages: 12, count: 4 },
    ]
    expect(countInPageRange(counts, { min: 3, max: 8 })).toBe(18)
    expect(countInPageRange(counts, { min: 8, max: PAGES_TOP })).toBe(7)
  })
})

describe('parsePageStop', () => {
  it('reads a typed stop, clamped to the scale', () => {
    expect(parsePageStop(' 8 ')).toBe(8)
    expect(parsePageStop('12+')).toBe(12)
    expect(parsePageStop('40')).toBe(PAGES_TOP)
    expect(parsePageStop('0')).toBe(1)
    expect(parsePageStop('abc')).toBeNull()
    expect(parsePageStop('')).toBeNull()
  })
})
