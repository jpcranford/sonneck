import { describe, expect, it } from 'vitest'
import { pieceTitleCredit } from './joinNames'

// pieceTitleCredit backs the browser tab title's "(pieceTitle) by
// (composer)" segment — no real dev-data fixture exercises the no-composer
// (arranger-only, e.g. a traditional/folk tune) case, so this locks in the
// three branches directly rather than relying on live data to happen to
// cover it.
describe('pieceTitleCredit', () => {
  it('uses the composer when present', () => {
    expect(pieceTitleCredit(['Frédéric Chopin'], [])).toBe('Frédéric Chopin')
  })

  it('falls back to the arranger, plain, with no "arr." label, when there is no composer', () => {
    expect(pieceTitleCredit([], ['Carl Tausig'])).toBe('Carl Tausig')
  })

  it('prefers the composer outright even when an arranger is also credited', () => {
    expect(pieceTitleCredit(['Frédéric Chopin'], ['Carl Tausig'])).toBe('Frédéric Chopin')
  })

  it('joins multiple composers with the shared Oxford-comma convention', () => {
    expect(pieceTitleCredit(['Jimmy Page', 'Robert Plant'], [])).toBe('Jimmy Page and Robert Plant')
  })
})
