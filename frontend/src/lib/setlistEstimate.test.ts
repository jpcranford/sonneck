import { describe, expect, it } from 'vitest'
import { estimateTotal } from './setlistEstimate'

describe('estimateTotal', () => {
  it('assumes 150s for music and 90s for other entries without a duration', () => {
    // A 4:00 piece, two pieces without a duration, an "Offering" custom
    // entry, and a custom entry counted as music — none of those set.
    const total = estimateTotal([
      { isMusic: true, durationSeconds: 240 },
      { isMusic: true, durationSeconds: null },
      { isMusic: true, durationSeconds: undefined },
      { isMusic: false, durationSeconds: null },
      { isMusic: true, durationSeconds: null },
    ])
    expect(total).toEqual({ seconds: 240 + 150 + 150 + 90 + 150, estimated: true }) // 13:00
  })

  it('is not an estimate when every entry has a duration, zero included', () => {
    expect(
      estimateTotal([
        { isMusic: true, durationSeconds: 240 },
        { isMusic: false, durationSeconds: 0 },
      ]),
    ).toEqual({ seconds: 240, estimated: false })
  })

  it('is zero and not an estimate for an empty program', () => {
    expect(estimateTotal([])).toEqual({ seconds: 0, estimated: false })
  })
})
