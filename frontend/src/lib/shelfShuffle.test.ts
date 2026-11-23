import { describe, expect, it } from 'vitest'
import { shuffledBy } from './shelfShuffle'

const list = Array.from({ length: 200 }, (_, i) => i)

describe('shuffledBy', () => {
  it('keeps every item, in an order fixed by the seed', () => {
    const a = shuffledBy(list, 12345)
    expect([...a].sort((x, y) => x - y)).toEqual(list)
    expect(shuffledBy(list, 12345)).toEqual(a)
    expect(a).not.toEqual(list)
  })

  it('gives a new seed a new order', () => {
    expect(shuffledBy(list, 1)).not.toEqual(shuffledBy(list, 2))
  })

  it('draws the first 15 from across the whole list', () => {
    // Over many seeds, the first 15 come from every part of the list, not
    // just its start.
    const seen = new Set<number>()
    for (let seed = 1; seed <= 200; seed++)
      for (const n of shuffledBy(list, seed).slice(0, 15)) seen.add(n)
    expect(seen.size).toBeGreaterThan(190)
    expect([...seen].some((n) => n >= 150)).toBe(true)
  })
})
