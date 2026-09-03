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

/** Same fallback as EffectiveField, for an integer field (Public Domain
 * Badge feature's copyrightYear). */
export interface EffectiveIntField {
  value: number | null
  inherited: boolean
}

/** Same fallback as EffectiveField, for a boolean field (US renewal
 * follow-up's copyrightRenewed) — value is a plain boolean, not
 * nullable: "neither the piece nor its book has one set" resolves to
 * false (not renewed), not a third null state, by direct product
 * decision. */
export interface EffectiveBoolField {
  value: boolean
  inherited: boolean
}

/** The real badge states (Public Domain Badge feature) — fixed, law-derived
 * categories, never user-extensible. `possiblyPublicDomain` (US renewal
 * follow-up) is a lower-confidence sibling of `likelyPublicDomain`,
 * computed-only (never an explicit pick): en-US, a Copyright Year in
 * 1923-1963 (the window where a work's term actually depended on a renewal
 * filing), and no confirmed renewal — meaning the PD conclusion rests on an
 * *assumed* non-renewal default rather than a confirmed fact. */
export type CopyrightStatus =
  | 'publicDomain'
  | 'copyleft'
  | 'likelyPublicDomain'
  | 'possiblyPublicDomain'
  | 'inCopyright'

/**
 * Piece.copyrightStatus's wire shape — can't reuse plain EffectiveField
 * like copyrightHolder/copyrightSlug do, because the badge's displayed
 * status is never just "the piece's own pick, else the book's": it's that
 * pick corrected forward by a live calculation (backend:
 * repo.ResolveCopyrightStatus). value/inherited are the raw explicit pick
 * (same shape/meaning as every other EffectiveField — what the Edit Piece
 * dropdown should show as "currently selected" before considering the
 * calculation, "" when nothing's picked anywhere); effective is the final
 * status the badge and citation actually use, always one of the four real
 * values, never blank; expiryYear is the algorithm's own computed
 * term-expiry year (for the "as of {year}" tooltip), null when not
 * computable.
 */
export interface CopyrightStatusField {
  value: CopyrightStatus | ''
  inherited: boolean
  effective: CopyrightStatus
  expiryYear: number | null
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
  // Public Domain Badge feature (migration 00022) — copyrightYear/Holder/
  // Slug are book-inheritable (same EffectiveField family as every other
  // such field); copyrightStatus additionally carries the *effective*
  // (computed/overridden) badge status — see CopyrightStatusField's own
  // doc comment for why it can't share the plain EffectiveField shape.
  copyrightYear: EffectiveIntField
  copyrightHolder: EffectiveField
  copyrightSlug: EffectiveField
  copyrightStatus: CopyrightStatusField
  /** US renewal follow-up — book-inheritable. Only ever shown/edited when
   * COPYRIGHT_REGION is en-US (see api/config.ts) and copyrightYear falls
   * in 1923-1963 (lib/usRenewalWindow.ts), but always present on the
   * wire like every other book-inheritable field. */
  copyrightRenewed: EffectiveBoolField
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
  /** Renamed from yearWritten (Public Domain Badge feature, migration
   * 00022) — when this edition was published, not when the piece was
   * composed. Still book-inheritable to a Piece's own yearWritten,
   * unchanged. */
  yearPublished: string | null
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
  // Public Domain Badge feature (migration 00022) — plain fields, no
  // Effective* wrapper (Book is the inheritance root) and no computed/
  // "effective" variant (a Book has no live-computed default to fall back
  // to — needs an effective copyright year *and* composer death years,
  // both only reachable by resolving *through* Piece→Book inheritance,
  // which doesn't exist in the other direction).
  copyrightYear: number | null
  copyrightHolder: string | null
  copyrightSlug: string | null
  copyrightStatus: CopyrightStatus | null
  /** US renewal follow-up — plain nullable, same "no Effective* wrapper"
   * treatment as the four fields above. null means "not explicitly set
   * here," not "confirmed not renewed." */
  copyrightRenewed: boolean | null
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
  yearPublished?: string | null
  // Public Domain Badge feature: deliberately NOT included here — matches
  // this form's own existing "only what a book can meaningfully have
  // before any pieces exist" scope (already excludes sheet type/ISBN/
  // description/etc.). Set copyright fields afterward via the full Edit
  // Book form (BookWriteRequest) instead.
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
  // Public Domain Badge feature (migration 00022) — full-replace like
  // every other field here, book-inheritable.
  copyrightYear?: number | null
  copyrightHolder?: string | null
  copyrightSlug?: string | null
  copyrightStatus?: CopyrightStatus | null
  /** US renewal follow-up — full-replace like every other field here. */
  copyrightRenewed?: boolean | null
}

export interface BookWriteRequest {
  bookTitle: string
  composers: string[]
  arrangers: string[]
  yearPublished?: string | null
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
  // Public Domain Badge feature (migration 00022) — full-replace like
  // every other field here.
  copyrightYear?: number | null
  copyrightHolder?: string | null
  copyrightSlug?: string | null
  copyrightStatus?: CopyrightStatus | null
  /** US renewal follow-up — full-replace like every other field here. */
  copyrightRenewed?: boolean | null
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
