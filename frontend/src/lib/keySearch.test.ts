import { describe, expect, it } from 'vitest'
import { matchesKeyQuery } from './keySearch'

describe('matchesKeyQuery', () => {
  it('matches the ASCII-symbol form', () => {
    expect(matchesKeyQuery('E♭ Major', 'eb major')).toBe(true)
  })

  it('matches the spelled-out-word form', () => {
    expect(matchesKeyQuery('E♭ Major', 'e flat major')).toBe(true)
  })

  it('ignores spaces in the query, matching across a word boundary', () => {
    expect(matchesKeyQuery('B♭ Major', 'bmajor')).toBe(true)
  })

  it('ignores spaces in the stored name too', () => {
    expect(matchesKeyQuery('B♭ Major', 'b major')).toBe(true)
  })

  it('still rejects a real non-match', () => {
    expect(matchesKeyQuery('B♭ Major', 'gminor')).toBe(false)
  })
})
