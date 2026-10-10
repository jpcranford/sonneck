import { describe, expect, it } from 'vitest'
import { imslpNumberFromFilename, isDetectedImslpNumber } from './imslpFromFilename'

describe('imslpNumberFromFilename', () => {
  it('finds the number after IMSLP', () => {
    expect(imslpNumberFromFilename('Album_Op_68_IMSLP04154.pdf')).toBe('04154')
  })
  it('is null without one', () => {
    expect(imslpNumberFromFilename('Album_Op_68.pdf')).toBeNull()
    expect(imslpNumberFromFilename(null)).toBeNull()
  })
})

describe('isDetectedImslpNumber', () => {
  it('matches the detected number, with or without an IMSLP label', () => {
    expect(isDetectedImslpNumber('04154', '04154')).toBe(true)
    expect(isDetectedImslpNumber('IMSLP 04154 ', '04154')).toBe(true)
  })
  it('does not match a different or typed number', () => {
    expect(isDetectedImslpNumber('04155', '04154')).toBe(false)
    expect(isDetectedImslpNumber('04154', null)).toBe(false)
    expect(isDetectedImslpNumber('', '04154')).toBe(false)
  })
})
