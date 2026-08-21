import { describe, expect, it } from 'vitest'
import { hyphenateISBN } from './isbn'

// Mirrors internal/handlers/citation_test.go's ISBN cases exactly — same
// "Clean Code" ISBN used there, same expected output (this heuristic's own
// group-lumped-check segments, not the fully-correct publicly-documented
// hyphenation, which splits publisher from title too).
describe('hyphenateISBN', () => {
  it('hyphenates a 13-digit ISBN', () => {
    expect(hyphenateISBN('9780132350884')).toBe('978-0-13235088-4')
  })

  it('hyphenates a 10-digit ISBN', () => {
    expect(hyphenateISBN('0132350882')).toBe('0-13235088-2')
  })

  it('uses a 2-digit registration group for a leading digit outside 0-5/7', () => {
    // '6' isn't in the single-digit group set.
    expect(hyphenateISBN('6123456789')).toBe('61-2345678-9')
  })

  it('returns malformed-length input unhyphenated rather than guessing', () => {
    expect(hyphenateISBN('12345')).toBe('12345')
    expect(hyphenateISBN('')).toBe('')
  })
})
