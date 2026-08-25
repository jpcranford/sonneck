import type { Piece, PieceWriteRequest } from '../api/types'

/**
 * PATCH /api/pieces/:id is a full replace, not a sparse patch (see
 * PieceWriteRequest's own doc comment) — every field must be resent or it's
 * cleared. Piece's book-inheritable fields are *resolved effective* values
 * (own value falling back to the book's), so naively echoing them back on
 * every edit would silently convert an inherited field into an explicit
 * override, permanently opting the piece out of future book-level
 * inheritance the next time the book changes. Blank instead for any
 * inherited field this call doesn't intend to touch, so an edit only ever
 * changes what was actually edited.
 */
export function pieceToWriteRequest(piece: Piece): PieceWriteRequest {
  return {
    title: piece.title,
    // Book-inheritable, same inherited-blank convention as every other
    // field below — not a raw echo of the resolved {value, inherited}
    // object, which the backend can't decode as the plain string its
    // write request expects. (Real bug, found live: this line used to
    // just be `piece.composer.value` with no `.inherited` check, so
    // pressing Favorite on a piece with an inherited composer silently
    // froze it into a permanent per-piece override.)
    composer: piece.composer.inherited ? '' : piece.composer.value,
    arranger: piece.arranger.inherited ? '' : piece.arranger.value,
    favorite: piece.favorite,
    // sourceBookId follows the same full-replace rule as every other
    // field (see CLAUDE.md's "sourceBookId itself became editable" entry)
    // — omitting it here isn't neutral, it silently clears the book link,
    // even for a write (like a favorite toggle) that never meant to touch it.
    sourceBookId: piece.sourceBookId,
    workOpusNumber: piece.workOpusNumber.inherited ? '' : piece.workOpusNumber.value,
    keys: piece.keys.map((k) => k.name),
    sheetTypeName: piece.sheetType.inherited ? '' : (piece.sheetType.value?.name ?? ''),
    publisher: piece.publisher.inherited ? '' : piece.publisher.value,
    publisherId: piece.publisherId.inherited ? '' : piece.publisherId.value,
    yearWritten: piece.yearWritten.inherited ? '' : piece.yearWritten.value,
    description: piece.description.inherited ? '' : piece.description.value,
    userNotes: piece.userNotes,
    instruments: piece.instruments.inherited ? [] : piece.instruments.values.map((t) => t.name),
    userTags: piece.userTags.map((t) => t.name),
    practiceStatus: piece.practiceStatus,
    imslpNumber: piece.imslpNumber.inherited ? '' : piece.imslpNumber.value,
    sourcePageStart: piece.sourcePageStart,
    sourcePageEnd: piece.sourcePageEnd,
    duration: piece.duration,
    bpm: piece.bpm,
    measureCount: piece.measureCount,
    beatsPerMeasure: piece.beatsPerMeasure,
  }
}
