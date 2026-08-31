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

/**
 * A Person credit (composer/arranger overhaul, migration 00020) — see
 * PersonResponse (internal/api/dto.go). "Should be very minimal" per the
 * original brief: Name/Bio/BirthYear/DeathYear plus an optional custom
 * portrait (mirrors Book's own hasCustomCover/coverImageHash pair) and a
 * pieceCount for the People Library's own listing/default filter.
 */
export interface Person {
  id: number
  name: string
  bio: string | null
  birthYear: number | null
  deathYear: number | null
  hasCustomPortrait: boolean
  portraitImageHash: string | null
  pieceCount: number
  createdAt: string
}

export interface PersonCreateRequest {
  name: string
  birthYear?: number | null
  deathYear?: number | null
}

export interface PersonWriteRequest {
  name: string
  bio?: string | null
  birthYear?: number | null
  deathYear?: number | null
}

export interface PersonSplitRequest {
  replacementNames: string[]
}

export interface Piece {
  id: number
  title: string
  // Composer/Arranger (composer/arranger overhaul, migration 00020) are
  // ordered many-to-many now — same EffectiveTagRefs wire shape
  // Instruments already used, not a plain EffectiveField string. Each
  // Tag here is a Person's {id, name} — full Person detail (bio/years/
  // portrait) isn't included, since display sites only ever need the name.
  composer: EffectiveTagRefs
  /** Book-inheritable (backend: ResolveEffective). */
  arranger: EffectiveTagRefs
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
   * (design doc §14 addition) — user-selectable from the Piece Details page,
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
  // Composer/Arranger (composer/arranger overhaul, migration 00020):
  // ordered, plain Tag[] — no Effective* wrapper, since Book is the top of
  // the inheritance chain (nothing to fall back to), matching how
  // Instruments below already works for Book.
  composer: Tag[]
  /** Book-inheritable-source field — a Piece's own arranger falls back to
   * this. */
  arranger: Tag[]
  yearWritten: string | null
  workOpusNumber: string | null
  sheetType: Tag | null
  publisher: string | null
  publisherId: string | null
  description: string | null
  imslpNumber: string | null
  /** Plain digits, no hyphens (backend: models.Book.ISBN) — hyphenated for
   * display via lib/isbn.ts's hyphenateISBN. */
  isbn: string | null
  instruments: Tag[]
  // Nullable (backend migration 00014) — a manually created book (Books
  // library view's "New Book" button) has no underlying file.
  originalFilename: string | null
  fileHash: string | null
  // True when a manually uploaded cover image (backend migration 00018)
  // overrides the derived first-page-of-PDF thumbnail — independent of
  // fileHash. Render an <img src={getBookCoverUrl(id, ...)}> when this OR
  // fileHash is set, the "No-File Cover" placeholder otherwise; the
  // backend resolves which source to actually serve.
  hasCustomCover: boolean
  // Exposed so getBookCoverUrl can be cache-busted — see that function's
  // own comment for why the URL needs a version key at all.
  coverImageHash: string | null
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
  // Composers/Arrangers (composer/arranger overhaul, migration 00020):
  // ordered names, same full-replace-by-name convention as Instruments
  // elsewhere — resolved server-side via repo.FindOrCreatePerson. Arrangers
  // is included alongside Composers (unlike publisher/yearWritten below)
  // since ValidateBook requires one of composer/arranger — leaving it out
  // here would make that requirement satisfiable only via composer at
  // creation time.
  composers: string[]
  arrangers: string[]
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
  // Composers/Arrangers (composer/arranger overhaul, migration 00020):
  // ordered names, same full-replace-by-name convention as Keys/
  // Instruments/UserTags below — resolved server-side via
  // repo.FindOrCreatePerson, preserving submission order as credit order.
  composers: string[]
  arrangers: string[]
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
  composers: string[]
  arrangers: string[]
  yearWritten?: string | null
  workOpusNumber?: string | null
  sheetTypeName?: string | null
  publisher?: string | null
  publisherId?: string | null
  description?: string | null
  imslpNumber?: string | null
  /** Normalized server-side on save (handleUpdateBook's normalizeISBN) —
   * whatever punctuation/label is typed here, only digits (+ a possible
   * trailing check-digit X) are actually stored. */
  isbn?: string | null
  instruments: string[]
}

export interface UploadBookResult {
  book: Book
  pageCount: number
}

export interface ConfirmImportRequest {
  ranges: { start: number; end: number }[]
  pieces: PieceWriteRequest[]
  pageOffset: number
}

export interface ConfirmImportResult {
  pieces: Piece[]
}
