import { describe, expect, it } from 'vitest'
import { formatRelativeWeeks } from './relativeWeeks'

const TODAY = '2026-11-22'
// The gig date `n` days from TODAY.
const day = (n: number) => {
  const d = new Date(Date.UTC(2026, 10, 22 + n))
  return d.toISOString().slice(0, 10)
}
const label = (n: number, abbreviated = true) =>
  formatRelativeWeeks(day(n), { abbreviated, today: TODAY })

describe('formatRelativeWeeks', () => {
  it('counts days within a week either side', () => {
    expect(label(7)).toBe('in 7 days')
    expect(label(6)).toBe('in 6 days')
    expect(label(2)).toBe('in 2 days')
    expect(label(1)).toBe('tomorrow')
    expect(label(0)).toBe('today')
    expect(label(-1)).toBe('yesterday')
    expect(label(-2)).toBe('2 days ago')
    expect(label(-6)).toBe('6 days ago')
  })

  it('counts weeks beyond that', () => {
    expect(label(8)).toBe('in 1 wk')
    expect(label(14)).toBe('in 2 wks')
    expect(label(-7)).toBe('1 wk ago')
    expect(label(-15)).toBe('2 wks ago')
    expect(label(21, false)).toBe('in 3 weeks')
    expect(label(-7, false)).toBe('1 week ago')
  })
})
