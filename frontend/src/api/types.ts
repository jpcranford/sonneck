// Mirrors the backend's JSON wire types (internal/api/dto.go,
// internal/models). Keeping these in sync by hand is the main defense
// against frontend/backend drift called out in CLAUDE.md > Frontend —
// when a backend response shape changes, this file changes with it.

export interface Tag {
  id: number
  name: string
}

/** A book-inheritable string field, resolved to its effective value. */
export interface EffectiveField {
  value: string
  inherited: boolean
}

/** Same fallback, for a single-value tag reference (sheetType). */
export interface EffectiveTagRef {
  value: Tag | null
  inherited: boolean
}

/** Same fallback, for a many-to-many tag reference (instruments). */
export interface EffectiveTagRefs {
  values: Tag[]
  inherited: boolean
}

export type PracticeStatus = 'Want to Learn' | 'Learning' | 'Learned' | 'Stalled' | 'Dropped'

export interface Piece {
  id: number
  title: string
  composer: EffectiveField
  arranger: string | null
  favorite: boolean
  workOpusNumber: EffectiveField
  /** Many-to-many, not book-inheritable — a piece can genuinely be written
   * in more than one key (e.g. a piece that modulates, or a medley). */
  keys: Tag[]
  sheetType: EffectiveTagRef
  publisher: EffectiveField
  publisherId: EffectiveField
  yearWritten: EffectiveField
  description: EffectiveField
  userNotes: string | null
  userTags: Tag[]
  practiceStatus: PracticeStatus | null
  imslpNumber: EffectiveField
  instruments: EffectiveTagRefs
  sourceBookId: number | null
  sourceBookTitle?: string
  sourcePageStart: number | null
  sourcePageEnd: number | null
  duration: number | null
  bpm: number | null
  measureCount: number | null
  beatsPerMeasure: number | null
  fileHash: string
  pageCount: number
  /** Which rendered page is used as this piece's Library card thumbnail
   * (design doc §14 addition) — user-selectable from the Piece View,
   * defaults to 1. */
  thumbnailPage: number
  copyrightYear: number | null
  publicDomain: boolean
  createdAt: string
  updatedAt: string
}

export interface Book {
  id: number
  bookTitle: string
  composer: string | null
  yearWritten: string | null
  workOpusNumber: string | null
  sheetType: Tag | null
  publisher: string | null
  publisherId: string | null
  description: string | null
  imslpNumber: string | null
  instruments: Tag[]
  // Nullable (backend migration 00014) — a manually created book (Books
  // library view's "New Book" button) has no underlying file.
  originalFilename: string | null
  fileHash: string | null
  importedAt: string
  pieceCount: number
}

/**
 * Books library view's "New Book" button submission shape — creates a
 * Book with no underlying file, distinct from the upload/import wizard
 * (which always requires a real PDF). Deliberately narrower than
 * BookWriteRequest: only the fields a book can meaningfully have before
 * any pieces exist to classify it by. Only bookTitle is required.
 */
export interface BookCreateRequest {
  bookTitle: string
  composer?: string | null
  publisher?: string | null
  yearWritten?: string | null
}

/**
 * Full-form submission shape for both the wizard's per-piece fill step and
 * the standalone piece edit menu (design doc §5, §15) — matches
 * api.PieceWriteRequest on the backend exactly. This is a wholesale
 * replace, not a sparse patch: omitting a field clears it, it does not
 * leave the existing value alone. Tag fields are names, not IDs
 * (Calibre-style pick-existing-or-type-new).
 */
export interface PieceWriteRequest {
  title: string
  composer?: string | null
  arranger?: string | null
  favorite: boolean
  workOpusNumber?: string | null
  keys: string[]
  sheetTypeName?: string | null
  publisher?: string | null
  publisherId?: string | null
  yearWritten?: string | null
  description?: string | null
  userNotes?: string | null
  instruments: string[]
  userTags: string[]
  practiceStatus?: PracticeStatus | null
  imslpNumber?: string | null
  /** Re-matches this piece to a different existing Book, or clears the
   * association (null) — same full-replace rule as every other field here.
   * Backend rejects a non-null id that doesn't reference a real Book
   * (VALIDATION_ERROR naming this field), rather than surfacing it as an
   * opaque 500 later. */
  sourceBookId?: number | null
  sourcePageStart?: number | null
  sourcePageEnd?: number | null
  /** Directly user-entered (mm:ss in the UI, seconds on the wire) — not
   * recomputed server-side from bpm/measureCount/beatsPerMeasure, a
   * deliberate deviation from design doc §3 (see CLAUDE.md > Frontend >
   * Computed fields). Omitting this on a write clears it, same full-replace
   * rule as every other field — every write-request builder must resend it
   * to preserve the current value, not just the ones that mean to change it. */
  duration?: number | null
  bpm?: number | null
  measureCount?: number | null
  beatsPerMeasure?: number | null
}

export interface BookWriteRequest {
  bookTitle: string
  composer?: string | null
  yearWritten?: string | null
  workOpusNumber?: string | null
  sheetTypeName?: string | null
  publisher?: string | null
  publisherId?: string | null
  description?: string | null
  imslpNumber?: string | null
  instruments: string[]
}

export interface UploadBookResult {
  book: Book
  pageCount: number
}

export interface ConfirmImportRequest {
  boundaries: number[]
  pieces: PieceWriteRequest[]
}

export interface ConfirmImportResult {
  pieces: Piece[]
}
