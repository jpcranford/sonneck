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
    composer: piece.composer.value,
    // Book-inheritable as of 2026-08-20 — same inherited-blank convention
    // as every other field below now, not a raw echo of the resolved
    // value. Previously a plain string, so this used to be a correct
    // direct assignment; left as one after arranger's type changed, this
    // silently sent a {value, inherited} object as the write body's
    // arranger field, which the backend can't decode as its expected
    // string — every favorite toggle failed outright.
    arranger: piece.arranger.inherited ? '' : piece.arranger.value,
    favorite: piece.favorite,
    // sourceBookId follows the same full-replace rule as every other
    // field (see CLAUDE.md's "sourceBookId itself became editable" entry)
    // — omitting it here isn't neutral, it silently clears the book link.
    // This was previously missing, which meant any full-replace write that
    // went through this helper (the Piece Details header's favorite toggle,
    // PieceContextMenu's favorite toggle — neither touches sourceBookId
    // intentionally) unlinked the piece's book as a side effect.
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
