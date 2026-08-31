import { describe, expect, it } from 'vitest'
import type { Piece } from '../api/types'
import { pieceToWriteRequest } from './pieceToWriteRequest'

// Real bug this covers: pressing Favorite on a piece with an *inherited*
// composer silently froze it into a permanent per-piece override, because
// pieceToWriteRequest echoed piece.composer.value straight through with no
// .inherited check — the one field missing the guard every other
// book-inheritable field here already has (see arranger, publisher, etc.).
// Composer/Arranger are now ordered Person-name lists (composer/arranger
// overhaul, migration 00020) — the same inherited-blank guard, just over a
// list instead of a single string.

function fixturePiece(overrides: Partial<Piece> = {}): Piece {
  return {
    id: 1,
    title: 'Nocturne',
    composer: { values: [{ id: 1, name: 'Fr. Chopin' }], inherited: true },
    arranger: { values: [], inherited: true },
    favorite: false,
    workOpusNumber: { value: '', inherited: true },
    keys: [],
    sheetType: { value: null, inherited: true },
    publisher: { value: '', inherited: true },
    publisherId: { value: '', inherited: true },
    yearWritten: { value: '', inherited: true },
    description: { value: '', inherited: true },
    userNotes: null,
    userTags: [],
    practiceStatus: null,
    imslpNumber: { value: '', inherited: true },
    instruments: { values: [], inherited: true },
    sourceBookId: 5,
    sourcePageStart: null,
    sourcePageEnd: null,
    duration: null,
    bpm: null,
    measureCount: null,
    beatsPerMeasure: null,
    fileHash: 'abc',
    pageCount: 1,
    thumbnailPage: 1,
    copyrightYear: null,
    publicDomain: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('pieceToWriteRequest', () => {
  it('blanks an inherited composer instead of echoing the resolved value back as an override', () => {
    const piece = fixturePiece({ composer: { values: [{ id: 1, name: 'Fr. Chopin' }], inherited: true } })
    expect(pieceToWriteRequest(piece).composers).toEqual([])
  })

  it('sends the real value when composer is the piece’s own, not inherited', () => {
    const piece = fixturePiece({
      composer: { values: [{ id: 2, name: 'Own Composer' }], inherited: false },
    })
    expect(pieceToWriteRequest(piece).composers).toEqual(['Own Composer'])
  })
})
