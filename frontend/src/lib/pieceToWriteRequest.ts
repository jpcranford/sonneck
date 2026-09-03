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
    // field below — not a raw echo of the resolved {values, inherited}
    // list, which the backend would otherwise silently convert into a
    // permanent per-piece override (real bug, found live pre-overhaul: see
    // this function's own test file). Composer/Arranger are now ordered
    // Person-name lists (composer/arranger overhaul, migration 00020).
    composers: piece.composer.inherited ? [] : piece.composer.values.map((p) => p.name),
    arrangers: piece.arranger.inherited ? [] : piece.arranger.values.map((p) => p.name),
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
    // Public Domain Badge feature — same inherited-blank convention as
    // every other book-inheritable field above. copyrightStatus.value is
    // the raw explicit pick (never .effective, which is the
    // calculation-corrected value and would silently freeze that
    // correction in as a permanent override if echoed back).
    copyrightYear: piece.copyrightYear.inherited ? null : piece.copyrightYear.value,
    copyrightHolder: piece.copyrightHolder.inherited ? '' : piece.copyrightHolder.value,
    copyrightSlug: piece.copyrightSlug.inherited ? '' : piece.copyrightSlug.value,
    copyrightStatus: piece.copyrightStatus.inherited || !piece.copyrightStatus.value ? null : piece.copyrightStatus.value,
  }
}
