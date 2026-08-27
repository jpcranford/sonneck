import { describe, expect, it } from 'vitest'
import { nameCase, titleCase } from './textCase'

describe('titleCase', () => {
  it('capitalizes major words and lowercases minor ones', () => {
    expect(titleCase('the sound of music')).toBe('The Sound of Music')
  })

  it('always capitalizes the first and last word, even if minor', () => {
    expect(titleCase('a tale of the sea')).toBe('A Tale of the Sea')
  })

  it('capitalizes the word right after a colon', () => {
    expect(titleCase('prelude: an introduction')).toBe('Prelude: An Introduction')
  })

  it('normalizes ALL CAPS input', () => {
    expect(titleCase('SONATA IN C MINOR')).toBe('Sonata in C Minor')
  })

  it('capitalizes after internal hyphens', () => {
    expect(titleCase('well-tempered clavier')).toBe('Well-Tempered Clavier')
  })

  it('capitalizes the letter right after an opening parenthesis', () => {
    expect(titleCase('somewhere (reprise)')).toBe('Somewhere (Reprise)')
  })

  it('leaves blank input untouched', () => {
    expect(titleCase('')).toBe('')
    expect(titleCase('   ')).toBe('   ')
  })

  it('collapses extra internal whitespace', () => {
    expect(titleCase('waltz   in   a-flat')).toBe('Waltz in A-Flat')
  })
})

describe('nameCase', () => {
  it('capitalizes each part of a plain name', () => {
    expect(nameCase('johann sebastian bach')).toBe('Johann Sebastian Bach')
  })

  it('keeps a mid-name particle lowercase', () => {
    expect(nameCase('ludwig van beethoven')).toBe('Ludwig van Beethoven')
  })

  it('capitalizes a particle when it is the first word', () => {
    expect(nameCase('van beethoven')).toBe('Van Beethoven')
  })

  it('capitalizes both letters of a two-initial abbreviation', () => {
    expect(nameCase('j.s. bach')).toBe('J.S. Bach')
  })

  it('normalizes ALL CAPS input', () => {
    expect(nameCase('FRÉDÉRIC CHOPIN')).toBe('Frédéric Chopin')
  })

  it('leaves blank input untouched', () => {
    expect(nameCase('')).toBe('')
  })
})
