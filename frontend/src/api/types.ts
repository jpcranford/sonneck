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
  originalFilename: string
  fileHash: string
  importedAt: string
  pieceCount: number
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
  sourcePageStart?: number | null
  sourcePageEnd?: number | null
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
