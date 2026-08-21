import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  IconArrowLeft,
  IconExternalLink,
  IconFileX,
  IconHeartFilled,
  IconLayoutGridFilled,
  IconLayoutListFilled,
  IconPencil,
} from '@tabler/icons-react'
import { getBook, getBookFileUrl, getBookPageThumbnailUrl } from '../api/books'
import { getPieceThumbnailUrl, searchPieces } from '../api/pieces'
import { ApiError } from '../api/client'
import type { Piece } from '../api/types'
import { bookComposerPart } from '../lib/formatBookMeta'
import { hyphenateISBN } from '../lib/isbn'
import { ClickableCard } from '../components/ClickableCard'
import { EditBookModal } from '../components/EditBookModal'
import { PieceContextMenu } from '../components/PieceContextMenu'
import { TagPills } from '../components/TagPills'

// Book Details page — no design-doc spec (new ground, same as the Books
// library view before it). Built from the "Book Details — Consolidated
// Design" artifact via the locked mockup, /mockup/book-details
// (BookDetailsSample.tsx) — kept in sync by hand per that file's own
// convention. Header is its own card; the pieces grid/list below it is
// deliberately NOT a card (no border/radius/shadow, just spacing) —
// verified against the artifact directly, see BookDetailsSample.tsx's own
// file comment for the two regressions that got this wrong along the way.

function imslpReverseLookupUrl(imslpNumber: string): string {
  return `https://imslp.org/index.php?title=Special:ReverseLookup&action=submit&indexsearch=${encodeURIComponent(imslpNumber)}`
}

// "pp. 22–24" / "p. 22" from the piece's own historical provenance fields
// (design doc §14: purely cosmetic, not necessarily in sync with the
// current file's actual pageCount after a replace) — not derived from
// pageCount, which is the current file's real page count and can
// legitimately diverge from this range. Academic "p."/"pp." convention
// (standing rule, 2026-08-20): singular "p." for one page, "pp." for a
// range — matches PiecePage.tsx's own "Source pages" row.
function pageRangeLabel(piece: Piece): string {
  if (piece.sourcePageStart == null) return '—'
  const end = piece.sourcePageEnd ?? piece.sourcePageStart
  return end > piece.sourcePageStart
    ? `pp. ${piece.sourcePageStart}–${end}`
    : `p. ${piece.sourcePageStart}`
}

function pagesLabel(piece: Piece): string {
  return `${piece.pageCount} ${piece.pageCount === 1 ? 'page' : 'pages'}`
}

// piece.composer is already an EffectiveField — the backend has already
// resolved the book fallback, so no client-side fallback logic is needed
// here the way the mockup's hardcoded data required.
//
// Arranger rides on the composer segment itself (", arr. Arranger"), same
// fragment as formatPieceMeta.ts/PieceGridCard.tsx's own composerPart — not
// factored into a shared helper since those two callers also each carry
// their own different surrounding fields (opus/sourceBook/year vs. just
// year), same as this one carries pages instead.
//
// Three-way fallback (composer-or-arranger, 2026-08-20): falls back to
// "arr. Arranger" when only an arranger is set — this is a case that comes
// up specifically here, since a book with only an arranger set is common
// (composer-or-arranger is required at the book level too) and every piece
// without its own override inherits exactly that arranger-only value. The
// old two-way ternary rendered a blank composer line (pages only) for
// every such piece — an exception to "don't show inherited data" (unlike
// the TagPills gating below): the composer/arranger line is this row's one
// piece of identifying information, not decorative clutter, so it must
// show the inherited value rather than hide it.
function pieceMetaLine(piece: Piece): string {
  const composerPart =
    piece.composer.value && piece.arranger.value
      ? `${piece.composer.value}, arr. ${piece.arranger.value}`
      : piece.composer.value
        ? piece.composer.value
        : piece.arranger.value
          ? `arr. ${piece.arranger.value}`
          : null
  return [composerPart, pagesLabel(piece)].filter((part): part is string => !!part).join(' • ')
}

// Right-click/long-press menu (2026-08-20, direct instruction): shares
// PieceContextMenu with the Piece Library's own cards (PieceGridCard/
// PieceListCard) rather than a separate copy — same favorite/edit/delete
// items, same hideTriggerButton convention (no visible "⋯" trigger; touch
// users get ContextMenu's built-in long-press instead, same as the
// library's own cards).
function PieceGrid({ pieces }: { pieces: Piece[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3">
      {pieces.map((piece) => (
        <PieceContextMenu key={piece.id} piece={piece} hideTriggerButton>
          <ClickableCard
            to={`/pieces/${piece.id}`}
            className="overflow-hidden rounded-lg border border-border bg-paper-raised text-left transition-colors hover:border-accent"
          >
            {/* 2026-08-20 (direct instruction): the page-range badge that
                used to overlay the thumbnail is gone — its content moved
                down to the bottom line in its place (below), and the
                composer/arranger row is gone entirely. Too little room in a
                112px-wide card for three lines of text plus a badge; the
                page range is the one fact worth keeping over the piece
                count pagesLabel used to show. */}
            <div className="relative aspect-[180/132] bg-border">
              <img
                src={getPieceThumbnailUrl(piece.id, piece.thumbnailPage)}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover object-top"
              />
            </div>
            <div className="flex flex-col gap-0.5 px-2 py-1.5">
              <p className="truncate font-display text-[0.8rem] font-medium text-ink">{piece.title}</p>
              <p className="text-[0.65rem] text-ink-soft/80">{pageRangeLabel(piece)}</p>
            </div>
          </ClickableCard>
        </PieceContextMenu>
      ))}
    </div>
  )
}

// Tailwind v4 compiles an arbitrary max-width variant to the modern range
// syntax (`@media (width < 500px)`) — exclusive of the boundary itself,
// not the traditional inclusive `max-width: 500px`. `max-[501px]:*`
// (verified against the served CSS) is what actually makes the drop
// happen *at* 500px and below.
const THUMB_HIDE_CLASS = 'max-[501px]:hidden'
const ROW_COLLAPSE_CLASS = 'max-[501px]:grid-cols-[84px_1fr]'

// 84px (was 60px) — a two-piece range like "pp. 123–145" was clipping
// against the old width once source pages ran past double digits.
function PieceList({ pieces }: { pieces: Piece[] }) {
  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-[84px_1fr_56px] gap-3 px-1.5 pb-2.5 text-[0.7rem] font-medium tracking-wide text-ink-soft uppercase">
        <div>Page</div>
        <div>Title</div>
        <div className={THUMB_HIDE_CLASS} />
      </div>
      {pieces.map((piece) => (
        <PieceContextMenu key={piece.id} piece={piece} hideTriggerButton>
          <ClickableCard
            to={`/pieces/${piece.id}`}
            className={`grid grid-cols-[84px_1fr_56px] items-center gap-3 border-t border-border px-1.5 py-2.5 text-left first:border-t-0 hover:rounded-md hover:bg-accent-soft ${ROW_COLLAPSE_CLASS}`}
          >
            <div className="text-sm font-medium tabular-nums text-ink">{pageRangeLabel(piece)}</div>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-1.5 font-display text-[0.92rem] font-medium text-ink">
                {piece.title}
                {piece.favorite && (
                  <span className="text-accent" title="Favorite">
                    <IconHeartFilled size={13} />
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-xs text-ink-soft">{pieceMetaLine(piece)}</p>
              {/* sheetType/instruments only shown when they're this piece's
                  own override, not the resolved/effective (book-inherited)
                  value (2026-08-20, direct instruction: "don't show pills
                  from inherited information, they'll just clutter the
                  view") — every piece in a book sharing the same inherited
                  sheet type/instruments would otherwise repeat the
                  identical pill on every single row, adding nothing the
                  book header above the piece list hasn't already shown
                  once. Keys/userTags were never book-inheritable to begin
                  with (design doc §3), so passing them through unfiltered
                  is unchanged. */}
              <TagPills
                keys={piece.keys}
                sheetType={piece.sheetType.inherited ? null : piece.sheetType.value}
                instruments={piece.instruments.inherited ? [] : piece.instruments.values}
                userTags={piece.userTags}
                className="mt-1.5"
              />
            </div>
            <div
              className={`relative h-[42px] w-14 overflow-hidden rounded-md border border-border ${THUMB_HIDE_CLASS}`}
            >
              <img
                src={getPieceThumbnailUrl(piece.id, piece.thumbnailPage)}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover object-top"
              />
            </div>
          </ClickableCard>
        </PieceContextMenu>
      ))}
    </div>
  )
}

export function BookDetailsPage() {
  const { id } = useParams<{ id: string }>()
  const bookId = Number(id)

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [bookEditOpen, setBookEditOpen] = useState(false)

  const {
    data: book,
    isLoading: bookLoading,
    isError: bookIsError,
    error: bookError,
  } = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => getBook(bookId),
  })

  const { data: pieces, isLoading: piecesLoading } = useQuery({
    queryKey: ['pieces', { sourceBookId: bookId }],
    queryFn: () => searchPieces({ sourceBookId: bookId }),
    enabled: !!book,
  })

  const notFound = bookError instanceof ApiError && bookError.code === 'NOT_FOUND'

  const fields: { label: string; value: React.ReactNode }[] = []
  if (book) {
    if (book.publisher || book.publisherId) {
      fields.push({
        label: 'Publisher',
        value: [book.publisher, book.publisherId ? `#${book.publisherId}` : null].filter(Boolean).join(' '),
      })
    }
    if (book.imslpNumber) {
      fields.push({
        label: 'IMSLP no.',
        value: (
          <a
            href={imslpReverseLookupUrl(book.imslpNumber)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-accent hover:underline"
          >
            {book.imslpNumber}
            <IconExternalLink size={12} />
          </a>
        ),
      })
    }
    // ISBN sits between IMSLP no. and Original filename (2026-08-20,
    // direct instruction) — but only when imslpNumber is blank. IMSLP
    // always wins the fallback over ISBN, same rule buildCitation applies
    // to ISBN in the citation string: showing both identifiers on a
    // details page that already has a dedicated IMSLP row would be
    // redundant, not additive. Unlike Piece View's book card (which
    // substitutes "IMSLP #{number}" in ISBN's place when hidden), this is
    // a full field-per-row details list that already has its own IMSLP
    // no. row above — nothing to substitute, the row simply doesn't
    // render.
    if (!book.imslpNumber && book.isbn) {
      fields.push({ label: 'ISBN', value: hyphenateISBN(book.isbn) })
    }
    if (book.originalFilename) {
      fields.push({ label: 'Original filename', value: book.originalFilename })
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 md:p-8">
      <Link to="/books" className="inline-flex w-fit items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
        <IconArrowLeft size={24} />
        Back to Books
      </Link>

      {bookLoading && <p className="text-ink-soft">Loading…</p>}

      {bookIsError && notFound && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <h1 className="font-display text-3xl font-medium text-ink">Book not found</h1>
          <p className="text-ink-soft">It may have been deleted or moved.</p>
        </div>
      )}

      {bookIsError && !notFound && (
        <p className="text-ink-soft">
          {bookError instanceof ApiError ? bookError.message : 'Could not load this book.'}
        </p>
      )}

      {book && (
        <div>
          {/* Header is its own card. items-start on the header row: without
              it, the cover's flex cross-axis defaults to stretch, which
              fights its own aspect-[2/3] the moment a sibling column grows
              taller than the cover, distorting its shape. */}
          <div className="overflow-hidden rounded-2xl border border-border bg-paper-raised shadow-sm">
            <div className="flex items-start gap-6 p-7">
              <div className="aspect-[2/3] w-[110px] shrink-0 overflow-hidden rounded-md border border-border bg-paper-sunken">
                {book.fileHash ? (
                  <img
                    src={getBookPageThumbnailUrl(book.id, 1)}
                    alt=""
                    className="h-full w-full object-cover object-top"
                  />
                ) : (
                  // file-x on flat-sunken, locked in the "No-File Cover" design
                  // review. Solid pre-blended hex, not a translucent opacity
                  // utility — see the matching comment in BookGridCard.tsx.
                  <div className="flex h-full w-full items-center justify-center">
                    <IconFileX size={28} className="text-[#aea8a0]" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex items-start justify-between gap-4">
                  <div>
                    <h1 className="font-display text-[1.35rem] font-medium text-ink">
                      {book.bookTitle}
                      {book.workOpusNumber ? ` (${book.workOpusNumber})` : ''}
                    </h1>
                    <p className="text-[0.92rem] text-ink-soft">
                      {[bookComposerPart(book), book.yearWritten].filter(Boolean).join(' • ')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-stretch gap-2.5">
                    <button
                      type="button"
                      onClick={() => setBookEditOpen(true)}
                      aria-label="Edit book properties"
                      className="flex w-[38px] items-center justify-center rounded-md border border-border bg-paper-raised text-ink-soft hover:border-accent hover:text-ink"
                    >
                      <IconPencil size={16} />
                    </button>
                    {book.fileHash ? (
                      <a
                        href={getBookFileUrl(book.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 font-display text-sm text-white hover:bg-accent/90"
                      >
                        <IconExternalLink size={16} />
                        Open Book PDF
                      </a>
                    ) : (
                      <span
                        title="No original file on record"
                        // text-[#e8ece8] is a solid pre-blend of white/70
                        // against this span's own bg-accent/40-over-card
                        // background (not the icon's opacity alone) — see
                        // feedback-icon-color-preblend; icon+text share one
                        // color here since IconExternalLink is multi-path.
                        className="flex cursor-not-allowed items-center gap-1.5 rounded-md bg-accent/40 px-4 py-2 font-display text-sm text-[#e8ece8]"
                      >
                        <IconExternalLink size={16} />
                        Open Book PDF
                      </span>
                    )}
                  </div>
                </div>

                {(book.sheetType || book.instruments.length > 0) && (
                  <div className="mt-1 mb-1.5 flex flex-wrap gap-1.5">
                    {book.sheetType && (
                      <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-ink-soft">
                        {book.sheetType.name}
                      </span>
                    )}
                    {book.instruments.map((instrument) => (
                      <span
                        key={instrument.id}
                        className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-ink-soft"
                      >
                        {instrument.name}
                      </span>
                    ))}
                  </div>
                )}

                {book.description && (
                  <p className="mt-3.5 max-w-[60ch] text-[0.88rem] text-ink-soft">{book.description}</p>
                )}

                {fields.length > 0 && (
                  <div className="mt-3.5 flex flex-wrap gap-x-8 gap-y-3">
                    {fields.map((field) => (
                      <div key={field.label}>
                        <dt className="mb-0.5 text-[0.7rem] tracking-wide text-ink-soft uppercase">
                          {field.label}
                        </dt>
                        <dd className="text-[0.88rem] text-ink">{field.value}</dd>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Pieces — deliberately NOT a card, just spacing below the header
              card. */}
          <div className="mt-6 bg-paper">
            <div className="flex flex-wrap items-center justify-between gap-4 px-6 pb-4">
              <h2 className="font-display text-[0.95rem] font-semibold text-ink-soft">
                {pieces ? `${pieces.length} ${pieces.length === 1 ? 'piece' : 'pieces'} in this book` : '…'}
              </h2>
              <div className="flex shrink-0 items-center gap-1 rounded-md border border-border p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  aria-label="Grid view"
                  aria-pressed={viewMode === 'grid'}
                  className={`flex size-8 items-center justify-center rounded ${
                    viewMode === 'grid' ? 'bg-accent-soft text-accent' : 'text-ink-soft'
                  }`}
                >
                  <IconLayoutGridFilled size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  aria-label="List view"
                  aria-pressed={viewMode === 'list'}
                  className={`flex size-8 items-center justify-center rounded ${
                    viewMode === 'list' ? 'bg-accent-soft text-accent' : 'text-ink-soft'
                  }`}
                >
                  <IconLayoutListFilled size={16} />
                </button>
              </div>
            </div>
            <div className="px-6 pb-5">
              {piecesLoading && <p className="text-ink-soft">Loading…</p>}
              {pieces && pieces.length === 0 && (
                <div className="py-6 text-center">
                  <p className="font-display text-ink">No pieces yet</p>
                  <p className="mt-1 text-sm text-ink-soft">
                    Pieces added to this book will appear here, sorted by their start page.
                  </p>
                </div>
              )}
              {pieces &&
                pieces.length > 0 &&
                (viewMode === 'grid' ? <PieceGrid pieces={pieces} /> : <PieceList pieces={pieces} />)}
            </div>
          </div>
        </div>
      )}
      {book && (
        <EditBookModal book={book} open={bookEditOpen} onClose={() => setBookEditOpen(false)} />
      )}
    </div>
  )
}
