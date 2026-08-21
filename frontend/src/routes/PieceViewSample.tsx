import { useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  IconArrowLeft,
  IconBook2,
  IconChevronDownFilled,
  IconChevronLeft,
  IconChevronRight,
  IconChevronRightFilled,
  IconCopy,
  IconEditFilled,
  IconDownload,
  IconExternalLink,
  IconHeart,
  IconHeartFilled,
  IconImageInPicture,
  IconMusic,
  IconRefresh,
  IconShieldCheck,
} from '@tabler/icons-react'
import type { PracticeStatus } from '../api/types'
import { InfoTooltip } from '../components/InfoTooltip'
import { PracticeStatusIcon } from '../components/PracticeStatusIcon'
import { hyphenateISBN } from '../lib/isbn'
import { useMockupTitle } from '../lib/useMockupTitle'

// ---------------------------------------------------------------------
// REFERENCE SAMPLE — unlinked from nav, not wired to the API. Ported
// straight from PiecePage.tsx (the real Piece View, §14) with hardcoded
// data standing in for real query results, so this stays a faithful,
// always-available reference for the complete design without needing a
// real piece seeded in the dev database. Visit /mockup/piece-view
// directly. Keep this in sync by hand whenever PiecePage.tsx's rendering
// changes — there's no shared component between them (a deliberate
// call: this file's whole reason to exist is being simple/self-contained,
// not a second data-fetching surface to keep correct).
//
// Interactive where it's safe to be (page cycling, disclosures, download
// dropdown, citation copy, favorite/thumbnail toggle) — but nothing here
// calls a real API. Edit (piece and book) stay inert/disabled: wiring the
// real EditPieceModal to this fake data could fire a real PATCH request
// against whatever ID happens to collide with this page's fake one.
//
// Resynced to the real build 2026-08-18: three text-ink-soft opacity
// values that had drifted from PiecePage.tsx (Tempo details/Advanced
// disclosures were /60, citation was /25 — real page uses /75 for all
// three), ActionButton's unused-but-present className prop, and a whole
// missing UI state — the "Replacing… N%" progress bar has been in
// PiecePage.tsx since its very first commit but was never ported here.
// "Choose File…" below now fakes a short progress ramp via setInterval
// (simulateReplace) instead of just closing the confirm box, so that
// state is actually reachable in this reference too.
// ---------------------------------------------------------------------

interface Tag {
  id: number
  name: string
}

// bookTitle and workOpusNumber deliberately kept as two separate fields
// (not "Album für die Jugend, Op. 68" baked into one title string) to
// exercise buildCitation's book-opus dedup logic (citation.go,
// 2026-08-17) the way it's actually meant to be used: the book's own
// opus number is a structured field the citation composes in, not free
// text a user has to remember to type into the title itself.
const sampleBook = {
  // Fake id, purely so the Source Book title can link to /books/1 like
  // the real page does — a harmless dead end if no book with that id
  // exists in whatever dev database this mockup happens to be viewed
  // against (shows the real "Book not found" state, not a bug).
  id: 1,
  bookTitle: 'Album für die Jugend',
  composer: 'Robert Schumann',
  // arranger/publisher are both never actually exercised in this fixture
  // (composer above is always set, and takes priority over both) — present
  // purely to mirror the real Book shape for bookComposerPart's fallback
  // chain and lib/formatBookMeta.ts's effectiveBookComposer.
  arranger: null as string | null,
  publisher: null as string | null,
  workOpusNumber: 'Op. 68',
  yearWritten: '1848',
  // Same value the piece's own (inherited) IMSLP no. row shows below —
  // not programmatically derived from it in this simplified fixture, but
  // narratively the same source. Drives the ISBN-vs-IMSLP substitution
  // right below (2026-08-20, direct instruction): IMSLP always wins.
  imslpNumber: 'IMSLP04154' as string | null,
  // Stored digits-only, matching the backend (models.Book.ISBN) — hyphenated
  // for display via lib/isbn.ts's hyphenateISBN, same as the real page.
  // Currently hidden by imslpNumber above being set — see the book card's
  // own comment for why, and how to preview this instead.
  isbn: '9783795345352' as string | null,
}

// Book's own composer/arranger fallback chain for the Source Book card's
// meta line — composer+arranger fused (", arr. Arranger") when both are
// set, arranger alone when composer is blank (composer-or-arranger,
// 2026-08-20 — a Book can now have neither/either), falling back further
// to publisher only when the book has neither (effectiveBookComposer's own
// existing pre-arranger fallback, lib/formatBookMeta.ts).
function bookComposerPart(book: typeof sampleBook): string | null {
  if (book.composer && book.arranger) return `${book.composer}, arr. ${book.arranger}`
  if (book.composer) return book.composer
  if (book.arranger) return `arr. ${book.arranger}`
  return book.publisher
}

// The book card's right-hand identifier slot (design option D) shows
// either ISBN or IMSLP no. — never both. IMSLP always wins when both are
// set (2026-08-20, direct instruction, same "IMSLP wins the fallback"
// rule buildCitation already applies to publisherId/ISBN in the citation
// string): "IMSLP #{number}" takes the ISBN's own slot rather than the
// ISBN just being hidden with nothing replacing it, since this is a
// single-line summary that always wants exactly one identifier shown, not
// a full field list like Book Details (where the row simply doesn't
// render at all — a details list has room to just omit a field, this
// slot doesn't have a second row to fall back to).
function bookIdentifierLabel(book: typeof sampleBook): string | null {
  if (book.imslpNumber) return `IMSLP #${book.imslpNumber.replace(/^\s*imslp[\s:#-]*/i, '')}`
  if (book.isbn) return hyphenateISBN(book.isbn)
  return null
}

// Deliberately mixes inherited and overridden book-inheritable fields —
// composer/sheetType/instruments/publisher/publisherId/yearWritten/
// imslpNumber are inherited (blank on the piece itself); workOpusNumber
// and description are the piece's own explicit values. Two keys, to show
// the multi-key pill rendering, not just the single-key case.
const samplePiece = {
  title: 'No. 9, Volksliedchen (Little Folk Song)',
  composer: { value: 'Robert Schumann', inherited: true },
  // Book-inheritable as of 2026-08-20 (backend: ResolveEffective) — was a
  // plain string here before, matching the real API's old shape.
  arranger: { value: 'Louis Köhler', inherited: false },
  favorite: true,
  workOpusNumber: { value: 'Op. 68, No. 9', inherited: false },
  keys: [
    { id: 1, name: 'A Minor' },
    { id: 2, name: 'C Major' },
  ] as Tag[],
  sheetType: { value: { id: 4, name: 'PVG Score' }, inherited: true },
  publisher: { value: 'G. Schirmer', inherited: true },
  publisherId: { value: 'HL50252950', inherited: true },
  yearWritten: { value: '1848', inherited: true },
  description: {
    value: "A short, wistful A-minor miniature from the Album — one of the more melancholy entries among the collection's otherwise sunny character pieces.",
    inherited: false,
  },
  userNotes: 'Left hand voicing in m.9 keeps tripping me up — slow it down to 60bpm next time.',
  userTags: [{ id: 1, name: 'recital candidate' }] as Tag[],
  practiceStatus: 'Learning' as PracticeStatus | null,
  imslpNumber: { value: 'IMSLP04154', inherited: true },
  instruments: { values: [{ id: 1, name: 'Piano' }] as Tag[], inherited: true },
  sourceBookId: 1,
  sourcePageStart: 22,
  sourcePageEnd: 24,
  duration: 95,
  bpm: 88,
  measureCount: 35,
  beatsPerMeasure: 3,
  fileHash: 'e71c2f9b8a4d5e6f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f',
  pageCount: 3,
  copyrightYear: null as number | null,
  createdAt: '2026-06-02T14:12:03Z',
  updatedAt: '2026-08-16T09:41:17Z',
}

// Matches buildCitation's current logic exactly (internal/handlers/
// citation.go), including the three 2026-08-17 deviations: arranger
// fused onto composer ("Robert Schumann, arr. Louis Köhler"); the book's
// own "Op. 68" dropped from the book-title segment because it's already
// contained (spaces ignored) in the piece's own "Op. 68, No. 9"; and
// imslpNumber rendered as "IMSLP #04154" — note samplePiece.imslpNumber
// below deliberately keeps the old-style "IMSLP04154" raw value (prefix
// still baked in, as real pre-2026-08-17 data would have it) specifically
// to demonstrate that buildCitation strips it at render time regardless
// of what's actually stored.
const sampleCitation =
  'Robert Schumann, arr. Louis Köhler, Album für die Jugend, "No. 9, Volksliedchen (Little Folk Song)" (Op. 68, No. 9), G. Schirmer, IMSLP #04154, 1848'

function SheetPagePlaceholder({ page }: { page: number }) {
  return (
    <svg
      viewBox="0 0 200 260"
      width={200}
      height={260}
      className="h-auto w-full"
      role="img"
      aria-label={`Page ${page} preview`}
    >
      <rect x="0.5" y="0.5" width="199" height="259" fill="#fffdf9" stroke="#e4e0d8" />
      <text x="100" y="26" textAnchor="middle" fontFamily="Georgia, serif" fontSize="9" fill="#5c5349">
        Volksliedchen
      </text>
      {[55, 88, 121, 154, 187, 220].map((y) => (
        <g key={y} stroke="#c9c2b6" strokeWidth="0.5">
          {[0, 3.5, 7, 10.5, 14].map((offset) => (
            <line key={offset} x1="18" x2="182" y1={y + offset} y2={y + offset} />
          ))}
        </g>
      ))}
      <text x="184" y="248" textAnchor="end" fontFamily="Georgia, serif" fontSize="7" fill="#8f857a">
        {page}
      </text>
    </svg>
  )
}

function formatDuration(seconds: number | null): string | null {
  if (seconds == null) return null
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// Kept in sync with PiecePage.tsx's real version — see that file's comment
// for the reasoning (built from the field's displayed value verbatim, not
// a re-derivation of the citation's own stripImslpPrefix logic).
function imslpReverseLookupUrl(imslpNumber: string): string {
  return `https://imslp.org/index.php?title=Special:ReverseLookup&action=submit&indexsearch=${encodeURIComponent(imslpNumber)}`
}

function InheritedNote({ compact }: { compact?: boolean }) {
  return (
    <InfoTooltip
      message="Inherited from book"
      ariaLabel="Why this value is shown"
      triggerClassName={
        compact
          ? 'text-[0.65rem] text-ink-soft/75 hover:text-ink'
          : 'rounded-full border border-border px-1.5 py-px text-[0.65rem] font-medium text-ink-soft/75 hover:text-ink'
      }
    >
      {compact ? '• inherited' : 'inherited'}
    </InfoTooltip>
  )
}

function EffectiveValue({ value, inherited }: { value: string | null; inherited: boolean }) {
  if (!value) return <span className="text-ink-soft/50">—</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      {value}
      {inherited && <InheritedNote />}
    </span>
  )
}

function DetailRow({
  label,
  children,
  small,
  tight,
}: {
  label: ReactNode
  children: ReactNode
  small?: boolean
  tight?: boolean
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 ${tight ? 'py-0.5' : 'py-1.5'} ${small ? 'text-xs' : 'text-sm'}`}
    >
      <span className="shrink-0 text-ink-soft">{label}</span>
      <span className="text-right text-ink">{children}</span>
    </div>
  )
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  className = '',
}: {
  icon: ReactNode
  label: string
  onClick?: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-sm text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border ${className}`}
    >
      {icon}
      {label}
    </button>
  )
}

export function PieceViewSample() {
  useMockupTitle('Piece View')

  const piece = samplePiece
  const book = sampleBook

  const [page, setPage] = useState(1)
  const [thumbnailPage, setThumbnailPage] = useState(1)
  const [favorite, setFavorite] = useState(piece.favorite)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [replaceConfirming, setReplaceConfirming] = useState(false)
  // Simulated version of PiecePage.tsx's replaceMutation.isPending state —
  // there's no real upload here, but the progress-bar UI itself is part of
  // the design this file exists to keep a faithful reference for, so
  // "Choose File…" below fakes a short progress ramp instead of just
  // closing the confirm box outright.
  const [replacePending, setReplacePending] = useState(false)
  const [replaceProgress, setReplaceProgress] = useState(0)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [tempoOpen, setTempoOpen] = useState(false)
  const [copyToast, setCopyToast] = useState<{ x: number; y: number } | null>(null)
  const replaceFileInputRef = useRef<HTMLInputElement>(null)

  function handleCopy(text: string, event: MouseEvent) {
    navigator.clipboard?.writeText(text).catch(() => {})
    setCopyToast({ x: event.clientX, y: event.clientY })
    window.setTimeout(() => setCopyToast(null), 1200)
  }

  function handleCopyCitation(event: MouseEvent) {
    handleCopy(sampleCitation, event)
  }

  function simulateReplace() {
    setReplaceConfirming(false)
    setReplacePending(true)
    setReplaceProgress(0)
    const interval = window.setInterval(() => {
      setReplaceProgress((p) => {
        const next = p + 20
        if (next >= 100) {
          window.clearInterval(interval)
          window.setTimeout(() => setReplacePending(false), 400)
          return 100
        }
        return next
      })
    }, 120)
  }

  return (
    // py- (not pt-only), kept in sync with PiecePage.tsx's real fix — see
    // that file's comment: this page had no bottom padding at all, so a
    // long citation string ran flush into the app footer.
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-6 md:px-8 md:py-8">
      {/* Edit Piece promoted from an icon-only button next to the title
          (still visible there in PiecePage.tsx as of this writing — port
          the same move over once approved) to a proper labeled button in
          this top toolbar row, matching the Title Case + icon+label
          treatment every other action button on this page already uses
          (Download PDF, Replace File, Use Page as Thumbnail) rather than
          being the one icon-only, unlabeled control on the whole page. */}
      <div className="flex items-center justify-between gap-4">
        <Link
          to="/"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-ink-soft hover:text-ink"
        >
          <IconArrowLeft size={24} />
          Back to Library
        </Link>
        <ActionButton icon={<IconEditFilled size={16} />} label="Edit Piece" disabled />
      </div>

      <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
        Reference sample — <span className="font-medium text-ink">Piece View</span> (design doc §14).
        Not wired to real data; Edit is inert here on purpose.
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* ---- Preview column (§7/§14: dominates ~half the view) ---- */}
        <div className="flex flex-col gap-3">
          {/* Same always-full-width fix as PiecePage.tsx — kept in sync
              structurally even though this sample's SVG placeholder is
              always portrait-shaped by construction. */}
          <div className="relative mx-auto flex w-full max-w-md items-center justify-center overflow-hidden rounded-lg border border-border bg-paper-raised shadow-sm">
            <SheetPagePlaceholder page={page} />

            {/* Page cycle control, floating over the bottom edge of the
                preview itself rather than as a separate row underneath
                (design review 2026-08-16, "integrated capsule" option) —
                kept in sync with PiecePage.tsx's real version. */}
            {piece.pageCount > 1 && (
              <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-ink/80 py-1 pr-1 pl-3 shadow-md backdrop-blur-sm">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  aria-label="Previous page"
                  className="flex size-6 items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-accent-on-dark disabled:pointer-events-none disabled:opacity-35"
                >
                  <IconChevronLeft size={14} />
                </button>
                <span className="text-xs tabular-nums text-white/90">
                  {page} / {piece.pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(piece.pageCount, p + 1))}
                  disabled={page === piece.pageCount}
                  aria-label="Next page"
                  className="flex size-6 items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-accent-on-dark disabled:pointer-events-none disabled:opacity-35"
                >
                  <IconChevronRightFilled size={14} />
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <div className="relative flex overflow-hidden rounded-md">
              <button
                type="button"
                className="flex items-center gap-2 bg-accent px-4 py-2 font-display text-sm text-white hover:bg-accent/90"
              >
                <IconDownload size={16} />
                Download PDF
              </button>
              <button
                type="button"
                onClick={() => setDownloadOpen((o) => !o)}
                aria-label="More download options"
                className="flex items-center justify-center border-l border-white/25 bg-accent px-2 text-white hover:bg-accent/90"
              >
                <IconChevronDownFilled size={16} />
              </button>
              {downloadOpen && (
                <div className="absolute top-full left-0 z-10 mt-1 w-64 overflow-hidden rounded-md border border-border bg-paper-raised py-1 text-left shadow-lg">
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-accent-soft"
                  >
                    Download PDF
                  </button>
                  <button
                    type="button"
                    disabled
                    className="block w-full cursor-not-allowed px-3 py-2 text-left text-sm text-ink-soft/50"
                  >
                    Download original + annotations
                    <span className="block text-xs italic">Coming with annotations (§13)</span>
                  </button>
                </div>
              )}
            </div>

            <ActionButton
              icon={<IconRefresh size={16} />}
              label="Replace File"
              onClick={() => setReplaceConfirming(true)}
            />
            <ActionButton
              icon={<IconImageInPicture size={16} />}
              label="Use Page as Thumbnail"
              onClick={() => setThumbnailPage(page)}
              disabled={page === thumbnailPage}
            />
            <input ref={replaceFileInputRef} type="file" accept="application/pdf,.pdf" className="hidden" />
          </div>

          {replaceConfirming && !replacePending && (
            <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-accent-soft/40 px-4 py-2.5 text-center text-sm">
              <span className="text-ink">
                Replace this piece's file? The old file is deleted permanently.
              </span>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setReplaceConfirming(false)}
                  className="rounded-md border border-border bg-paper-raised px-3 py-1 text-ink hover:border-accent"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={simulateReplace}
                  className="rounded-md bg-accent px-3 py-1 text-white hover:bg-accent/90"
                >
                  Choose File…
                </button>
              </div>
            </div>
          )}
          {replacePending && (
            <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-accent-soft/40 px-4 py-2.5">
              <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-accent transition-[width]"
                  style={{ width: `${Math.round(replaceProgress)}%` }}
                />
              </div>
              <span className="text-sm text-ink-soft">
                Replacing… {Math.round(replaceProgress)}%
              </span>
            </div>
          )}

          {piece.userNotes && (
            <div className="flex flex-col gap-1">
              <span className="text-sm text-ink-soft">Your notes</span>
              <p className="rounded-md bg-accent-soft/40 px-3 py-2 text-sm text-ink">{piece.userNotes}</p>
            </div>
          )}
        </div>

        {/* ---- Info column ---- */}
        <div className="flex flex-col gap-6 border-t border-border pt-6 lg:border-t-0 lg:pt-0">
          <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-4">
              <h1 className="font-display text-3xl font-medium text-ink">{piece.title}</h1>
              <div className="mt-1 flex shrink-0 items-center gap-3">
                {/* Edit moved to the top toolbar (a proper labeled button,
                    not an icon-only one) — see this file's top-of-page
                    comment. Favorite stays here; it's a one-tap toggle, not
                    an editing action, so it doesn't belong in that toolbar. */}
                <button
                  type="button"
                  onClick={() => setFavorite((f) => !f)}
                  aria-pressed={favorite}
                  aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
                  className="text-ink-soft hover:text-accent"
                >
                  {favorite ? (
                    <IconHeartFilled size={24} className="text-accent" />
                  ) : (
                    <IconHeart size={24} />
                  )}
                </button>
              </div>
            </div>

            {/* Dot separator only renders when composer is actually
                present — composer-or-arranger (2026-08-20) means a piece
                can now have an arranger with no composer at all, and the
                dot must not render with nothing on its left to separate. */}
            <p className="flex flex-wrap items-center gap-1.5 text-ink-soft">
              {piece.composer.value ? (
                <>
                  <EffectiveValue value={piece.composer.value} inherited={piece.composer.inherited} />
                  {piece.arranger.value && <span>• arr. {piece.arranger.value}</span>}
                </>
              ) : piece.arranger.value ? (
                <span className="inline-flex items-center gap-1.5">
                  arr. {piece.arranger.value}
                  {piece.arranger.inherited && <InheritedNote />}
                </span>
              ) : (
                <span className="text-ink-soft/50">—</span>
              )}
            </p>

            <div className="mt-1 flex flex-wrap items-center gap-2">
              {piece.practiceStatus && (
                <span className="flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                  <PracticeStatusIcon status={piece.practiceStatus} size={13} />
                  {piece.practiceStatus}
                </span>
              )}
              {piece.userTags.map((tag) => (
                <span
                  key={tag.id}
                  className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent"
                >
                  {tag.name}
                </span>
              ))}
              {/* One merged pill for the whole key sequence, kept in sync
                  with PiecePage.tsx's real version — see that file's
                  comment for the design rationale. */}
              {piece.keys.length > 0 && (
                <span className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-ink-soft">
                  <IconMusic size={12} className="shrink-0" />
                  <span className="flex items-center gap-1">
                    {piece.keys.map((key, i) => (
                      // Composite key (id + position), not just key.id — a
                      // modulating piece can use the same key twice in its
                      // sequence (migration 00012).
                      <span key={`${key.id}-${i}`} className="flex items-center gap-1">
                        {i > 0 && (
                          <span className="font-normal opacity-[0.55]" aria-hidden="true">
                            ›
                          </span>
                        )}
                        <span className="text-center">{key.name}</span>
                      </span>
                    ))}
                  </span>
                </span>
              )}
              {piece.sheetType.value && (
                <span className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-ink-soft">
                  {piece.sheetType.value.name}
                  {piece.sheetType.inherited && <InheritedNote compact />}
                </span>
              )}
            </div>
          </div>

          <div className="divide-y divide-border border-t border-border">
            {piece.instruments.values.length > 0 && (
              <DetailRow label="Instruments">
                <span className="inline-flex items-center gap-1.5">
                  {piece.instruments.values.map((tag) => tag.name).join(', ')}
                  {piece.instruments.inherited && <InheritedNote />}
                </span>
              </DetailRow>
            )}
            {piece.yearWritten.value && (
              <DetailRow label="Year written">
                <span className="inline-flex items-center gap-2">
                  <EffectiveValue value={piece.yearWritten.value} inherited={piece.yearWritten.inherited} />
                  <InfoTooltip
                    message="Public domain status — coming soon"
                    ariaLabel="Public domain status info"
                    // Solid pre-blend, not opacity (feedback-icon-color-preblend).
                    triggerClassName="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-[#aca7a1] hover:text-ink-soft"
                  >
                    <IconShieldCheck size={11} />
                  </InfoTooltip>
                </span>
              </DetailRow>
            )}
            {piece.workOpusNumber.value && (
              <DetailRow label="Opus / catalog no.">
                <EffectiveValue
                  value={piece.workOpusNumber.value}
                  inherited={piece.workOpusNumber.inherited}
                />
              </DetailRow>
            )}
            {piece.imslpNumber.value && (
              <DetailRow label="IMSLP no.">
                <span className="inline-flex items-center gap-1.5">
                  <EffectiveValue
                    value={piece.imslpNumber.value}
                    inherited={piece.imslpNumber.inherited}
                  />
                  {/* Comes after the "inherited" pill (inside
                      EffectiveValue), same as PiecePage.tsx's real version
                      — see that file's comment for the reasoning. */}
                  <a
                    href={imslpReverseLookupUrl(piece.imslpNumber.value)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="View on IMSLP"
                    // Solid pre-blend, not opacity (feedback-icon-color-preblend).
                    className="text-[#9c968f] hover:text-ink-soft"
                  >
                    <IconExternalLink size={13} />
                  </a>
                </span>
              </DetailRow>
            )}
            {(piece.publisher.value || piece.publisherId.value) && (
              <DetailRow label="Publisher">
                <span className="inline-flex items-center gap-1.5">
                  <EffectiveValue value={piece.publisher.value} inherited={piece.publisher.inherited} />
                  {piece.publisherId.value && (
                    <span className="text-xs text-ink-soft">• {piece.publisherId.value}</span>
                  )}
                </span>
              </DetailRow>
            )}
            {piece.sourcePageStart != null && (
              <DetailRow label="Source pages">
                {/* Ported from PiecePage.tsx's own null-safety fix: falls
                    back to sourcePageStart rather than comparing the raw
                    fields, so a piece with sourcePageEnd unset renders
                    "p. N" instead of "pp. N–null". Not reachable with this
                    file's own fixed fixture (always has both set), kept in
                    sync anyway per this file's own standing convention. */}
                {(piece.sourcePageEnd ?? piece.sourcePageStart) === piece.sourcePageStart
                  ? `p. ${piece.sourcePageStart}`
                  : `pp. ${piece.sourcePageStart}–${piece.sourcePageEnd}`}
              </DetailRow>
            )}
            {formatDuration(piece.duration) && (
              <DetailRow label="Duration">{formatDuration(piece.duration)}</DetailRow>
            )}

            {(piece.bpm != null || piece.measureCount != null || piece.beatsPerMeasure != null) && (
              <div className="py-1.5">
                <button
                  type="button"
                  onClick={() => setTempoOpen((o) => !o)}
                  // Solid pre-blend (icon + label share one color) —
                  // feedback-icon-color-preblend.
                  className="flex items-center gap-1 text-xs text-[#847d75] hover:text-ink-soft"
                >
                  <IconChevronRight
                    size={12}
                    className={`transition-transform ${tempoOpen ? 'rotate-90' : ''}`}
                  />
                  Tempo details
                </button>
                {tempoOpen && (
                  <div className="mt-1 flex flex-col pl-5">
                    <DetailRow tight label="BPM">
                      {piece.bpm ?? '—'}
                    </DetailRow>
                    <DetailRow tight label="Measures">
                      {piece.measureCount ?? '—'}
                    </DetailRow>
                    <DetailRow tight label="Beats / measure">
                      {piece.beatsPerMeasure ?? '—'}
                    </DetailRow>
                  </div>
                )}
              </div>
            )}
          </div>

          {piece.description.value && (
            <div className="flex flex-col gap-1">
              <span className="text-sm text-ink-soft">Description</span>
              <p className="text-sm text-ink">
                <EffectiveValue
                  value={piece.description.value}
                  inherited={piece.description.inherited}
                />
              </p>
            </div>
          )}

          {piece.sourceBookId && (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-paper-raised px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                  <IconBook2 size={16} />
                  Source Book
                </span>
                <button
                  type="button"
                  disabled
                  aria-label="Edit book details (coming soon)"
                  // Solid pre-blend, not opacity (feedback-icon-color-preblend).
                  className="cursor-not-allowed text-[#bebab6]"
                >
                  <IconEditFilled size={16} />
                </button>
              </div>
              <Link
                to={`/books/${book.id}`}
                className="font-display text-ink italic hover:text-accent hover:underline"
              >
                {book.bookTitle}
              </Link>
              {/* ISBN (2026-08-20, design option D — locked over A/B/C/E/F,
                  see the "ISBN Placement" design review): right-aligned
                  opposite composer/year on the same line, quiet and
                  catalog-number-styled rather than competing with composer
                  for reading order. Book-only — no per-piece override or
                  inheritance, so it's read straight off the book. Shows
                  "IMSLP #{number}" in this exact slot instead whenever
                  IMSLP is set — see bookIdentifierLabel's own comment.
                  With this fixture's current imslpNumber set, that's the
                  state actually visible by default; blank sampleBook's
                  imslpNumber locally to preview the raw-ISBN state
                  instead. */}
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm text-ink-soft">
                  {[bookComposerPart(book), book.yearWritten].filter(Boolean).join(' • ') || (
                    <span className="text-ink-soft/60 italic">No composer or publisher on file</span>
                  )}
                </p>
                {bookIdentifierLabel(book) && (
                  <span className="shrink-0 font-mono text-xs whitespace-nowrap text-ink-soft/75 tabular-nums">
                    {bookIdentifierLabel(book)}
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 text-xs text-ink-soft">
            <button
              type="button"
              onClick={() => setAdvancedOpen((o) => !o)}
              // Solid pre-blend (icon + label share one color) —
              // feedback-icon-color-preblend.
              className="flex w-fit items-center gap-1 text-[#847d75] hover:text-ink-soft"
            >
              <IconChevronRight
                size={13}
                className={`transition-transform ${advancedOpen ? 'rotate-90' : ''}`}
              />
              Advanced / Get Info (coming soon)
            </button>
            {advancedOpen && (
              <div className="flex flex-col rounded-md border border-dashed border-border px-3 py-2">
                <DetailRow small tight label="File hash">
                  <span className="inline-flex items-center gap-1">
                    <span className="font-mono">{piece.fileHash.slice(0, 16)}…</span>
                    <button
                      type="button"
                      onClick={(event) => handleCopy(piece.fileHash, event)}
                      aria-label="Copy full file hash"
                      // Solid pre-blend, not opacity (feedback-icon-color-preblend).
                      className="text-[#aca7a1] hover:text-ink-soft"
                    >
                      <IconCopy size={12} />
                    </button>
                  </span>
                </DetailRow>
                <DetailRow small tight label="Page count">
                  {piece.pageCount}
                </DetailRow>
                <DetailRow small tight label="Created">
                  {formatDate(piece.createdAt)}
                </DetailRow>
                <DetailRow small tight label="Last updated">
                  {formatDate(piece.updatedAt)}
                </DetailRow>
                <DetailRow small tight label="Copyright year">
                  {piece.copyrightYear ?? '—'}
                </DetailRow>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1 border-t border-border pt-4">
            <span className="text-[0.65rem] tracking-wide text-ink-soft/40 uppercase">Citation</span>
            <button
              type="button"
              onClick={handleCopyCitation}
              className="w-fit text-left font-display text-sm text-ink-soft/75 italic hover:text-ink-soft"
            >
              {sampleCitation}
            </button>
          </div>
        </div>
      </div>

      {copyToast && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[140%] rounded-md bg-ink px-2 py-1 text-xs text-paper shadow-md"
          style={{ left: copyToast.x, top: copyToast.y }}
        >
          Copied!
        </div>
      )}
    </div>
  )
}
