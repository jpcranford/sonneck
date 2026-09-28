import { afterEach, describe, expect, it, vi } from 'vitest'
import { daysUntil, formatDateOnly, todayDateOnly } from './dateOnly'

const originalTZ = process.env.TZ

afterEach(() => {
  process.env.TZ = originalTZ
  vi.useRealTimers()
})

const LONG: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' }

describe('formatDateOnly', () => {
  // The stored day, whatever the viewer's timezone — including the ones
  // west of UTC where `new Date(iso)` alone lands on the day before.
  for (const tz of ['America/Los_Angeles', 'America/New_York', 'UTC', 'Europe/London', 'Asia/Tokyo', 'Pacific/Kiritimati']) {
    it(`keeps the stored day in ${tz}`, () => {
      process.env.TZ = tz
      expect(new Date('2026-10-31').toLocaleDateString('en-US', { ...LONG, timeZone: 'UTC' })).toBe('October 31, 2026')
      expect(formatDateOnly('2026-10-31', LONG)).toContain('31')
    })
  }
})

describe('todayDateOnly / daysUntil', () => {
  it('uses the local calendar day, not the UTC one', () => {
    process.env.TZ = 'America/New_York'
    vi.useFakeTimers()
    // 9pm on Oct 30 in New York is already Oct 31 in UTC.
    vi.setSystemTime(new Date('2026-10-31T01:00:00Z'))
    expect(todayDateOnly()).toBe('2026-10-30')
    expect(daysUntil('2026-10-30')).toBe(0)
    expect(daysUntil('2026-10-31')).toBe(1)
    expect(daysUntil('2026-10-29')).toBe(-1)
  })

  it('counts whole days across a DST change', () => {
    process.env.TZ = 'America/New_York'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-30T16:00:00Z'))
    // US clocks fall back on Nov 1, 2026.
    expect(daysUntil('2026-11-06')).toBe(7)
  })

  it('works at the far edge of the timezone range', () => {
    process.env.TZ = 'Pacific/Kiritimati' // UTC+14
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-30T12:00:00Z')) // Oct 31, 2am local
    expect(todayDateOnly()).toBe('2026-10-31')
    expect(daysUntil('2026-10-31')).toBe(0)
  })
})
