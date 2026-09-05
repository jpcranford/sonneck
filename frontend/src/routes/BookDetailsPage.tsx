import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  IconArrowLeft,
  IconEditFilled,
  IconExternalLink,
  IconFileTypePdf,
  IconFileX,
  IconHeartFilled,
  IconLayoutGridFilled,
  IconLayoutListFilled,
  IconPhotoUp,
  IconTrash,
} from '@tabler/icons-react'
import {
  deleteBook,
  getBook,
  getBookCoverUrl,
  getBookFileUrl,
  removeBookCover,
  uploadBookCover,
} from '../api/books'
import { getPieceThumbnailUrl, searchPieces } from '../api/pieces'
import { ApiError } from '../api/client'
import type { Piece } from '../api/types'
import { hyphenateISBN, isbnSearchUrl } from '../lib/isbn'
import { joinNames, personCreditPart } from '../lib/joinNames'
import { CONTENT_MAX_W } from '../lib/layout'
import { usePageTitle } from '../lib/usePageTitle'
import { ClickableCard } from '../components/ClickableCard'
import { ContextMenu } from '../components/ContextMenu'
import { EditBookModal } from '../components/EditBookModal'
import { MarkdownText } from '../components/MarkdownText'
import { PersonNameLinks } from '../components/PersonNameLinks'
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
// legitimately diverge from this range. Academic "p."/"pp." convention:
// singular "p." for one page, "pp." for a range — matches PiecePage.tsx's
// own "Source pages" row.
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

// piece.composer is already an EffectiveTagRefs (composer/arranger
// overhaul, migration 00020) — the backend has already resolved the book
// fallback (both which names apply and their credit order), so no
// client-side fallback logic is needed here the way the mockup's
// hardcoded data required.
//
// Arranger rides on the composer segment itself (", arr. Arranger"), via
// the shared personCreditPart (lib/joinNames.ts) — the same helper
// formatPieceMeta.ts/PieceGridCard.tsx/PiecePage.tsx's own header row use.
// This function still isn't just a call to formatPieceMeta.ts wholesale,
// though: this row carries its own different surrounding fields (pages,
// not opus/sourceBook/year), so only the composer/arranger fusion itself
// is shared, not the whole meta-line assembly.
//
// Three-way fallback (composer-or-arranger): falls back to
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
  const composerPart = personCreditPart(
    piece.composer.values.map((p) => p.name),
    piece.arranger.values.map((p) => p.name),
  )
  return [composerPart, pagesLabel(piece)].filter((part): part is string => !!part).join(' • ')
}

// Right-click/long-press menu: shares
// PieceContextMenu with the Piece Library's own cards (PieceGridCard/
// PieceListCard) rather than a separate copy — same favorite/edit/delete
// items, same hideTriggerButton convention (no visible "⋯" trigger; touch
// users get ContextMenu's built-in long-press instead, same as the
// library's own cards).
function PieceGrid({ pieces }: { pieces: Piece[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3">
      {pieces.map((piece) => (
        <PieceContextMenu key={piece.id} piece={piece} hideTriggerButton siblingPieces={pieces}>
          <ClickableCard
            to={`/pieces/${piece.id}`}
            state={{ backLabel: 'Book' }}
            className="flex flex-col overflow-hidden rounded-lg border border-border bg-paper-raised text-left transition-colors hover:border-accent"
          >
            {/* No page-range badge overlaying the thumbnail — its content
                moved down to the bottom line in its place (below), and the
                composer/arranger row is gone entirely. Too little room in a
                112px-wide card for three lines of text plus a badge; the
                page range is the one fact worth keeping over the piece
                count pagesLabel used to show. */}
            {/* border-b hairline between thumbnail and info text — same
                treatment as the Piece Library's own grid card
                (PieceGridCard.tsx). */}
            <div className="relative aspect-[180/132] border-b border-border bg-border">
              <img
                src={getPieceThumbnailUrl(piece.id, piece.thumbnailPage)}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover object-top"
              />
            </div>
            <div className="flex flex-col gap-0.5 px-2 py-1.5">
              {/* flex + truncate-inner-span + shrink-0 icon: same pattern as
                  the Piece Library's own grid card (PieceGridCard.tsx) — a
                  plain truncating <p> can't also hold a non-truncating icon
                  sibling without this, and a fixed-size heart (13px,
                  matching every other favorite heart app-wide regardless of
                  the title's own font size) needs to never get clipped by
                  the truncation itself. */}
              <p className="flex min-w-0 items-center gap-1 font-display text-[0.8rem] font-medium text-ink">
                <span className="truncate">{piece.title}</span>
                {piece.favorite && (
                  <span className="shrink-0 text-accent" title="Favorite">
                    <IconHeartFilled size={13} />
                  </span>
                )}
              </p>
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
const ROW_COLLAPSE_CLASS = 'max-[501px]:grid-cols-[96px_1fr]'

// 96px gives a two-piece range like "pp. 123–145" enough room once source
// pages run past double digits, with breathing room around three-digit
// ranges like "pp. 159–161" too.
// A real CSS gotcha worth remembering here: a `first:border-t-0` on these
// rows does NOT do what it looks like — the "PAGE / TITLE" header row
// above the mapped pieces is also a child of the same flex-col container,
// so it, not the first piece, holds the `:first-child` slot. Each row is
// also separately wrapped in PieceContextMenu's own div for right-click/
// long-press, so `:first-child` there matches every row's own sole-child
// wrapper — deleting every divider, not just the first. Every row gets a
// plain, unconditional `border-t border-border` instead, no `first:`
// exception, which is what actually produces a line under the header too,
// not just between pieces.
//
// Title includes each piece's own effective opus number in parentheses
// (added 2026-08-30, direct instruction, ported from the same fix on the
// People Library's own Person Details page) — matches the header card's
// own `{book.bookTitle} ({book.workOpusNumber})` convention above, applied
// per-piece here since a piece's own opus can override the book's.
// PieceGrid deliberately keeps its own title-only treatment (list view
// only, per the same instruction) — no room for it in that card's much
// narrower 112px width.
function PieceList({ pieces }: { pieces: Piece[] }) {
  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-[96px_1fr_56px] gap-3 px-1.5 pb-2.5 text-[0.7rem] font-medium tracking-wide text-ink-soft uppercase">
        <div>Page</div>
        <div>Title</div>
        <div className={THUMB_HIDE_CLASS} />
      </div>
      <div>
        {pieces.map((piece) => (
          <PieceContextMenu key={piece.id} piece={piece} hideTriggerButton siblingPieces={pieces}>
            <ClickableCard
              to={`/pieces/${piece.id}`}
              state={{ backLabel: 'Book' }}
              className={`grid grid-cols-[96px_1fr_56px] items-center gap-3 border-t border-border px-1.5 py-2.5 text-left hover:rounded-md hover:bg-accent-soft ${ROW_COLLAPSE_CLASS}`}
            >
              <div className="text-sm font-medium tabular-nums text-ink">{pageRangeLabel(piece)}</div>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 font-display text-[0.92rem] font-medium text-ink">
                  {piece.title}
                  {piece.workOpusNumber.value ? ` (${piece.workOpusNumber.value})` : ''}
                  {piece.favorite && (
                    <span className="text-accent" title="Favorite">
                      <IconHeartFilled size={13} />
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-ink-soft">{pieceMetaLine(piece)}</p>
                {/* sheetType/instruments only shown when they're this piece's
                    own override, not the resolved/effective (book-inherited)
                    value — showing pills from inherited information would
                    just clutter the view: every piece in a book sharing the
                    same inherited
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
    </div>
  )
}

// Original filename value — collapsed state is always exactly one line,
// real CSS ellipsis (Tailwind's `truncate`: overflow:hidden + text-overflow:
// ellipsis + white-space:nowrap), never a wrapped second line, simplified
// from an earlier char-count `.slice()` version per direct follow-up
// (2026-09-05) — CSS truncates at whatever width the card actually
// rendered at, so there's no length to precompute or hardcode at all.
// Tap/click expands to the full value, which *can* wrap across multiple
// lines (that "never two lines" rule is specifically about the collapsed
// state) — break-words there for the same long-unbroken-run reason as
// before. Always rendered as a button regardless of whether this
// particular filename is actually long enough to be truncated right now —
// toggling is a harmless no-op when it isn't, and that's simpler than
// re-deriving "is this currently truncated" from rendered layout.
function TruncatableFilename({
  filename,
  expanded,
  onToggle,
}: {
  filename: string
  expanded: boolean
  onToggle: () => void
}) {
  return (
    // block w-full pr-2, not just pr-2 on its own: this button has no
    // other display/width overrides, so it's a plain inline-block whose
    // own width is computed via shrink-to-fit — adding padding to *that*
    // grows its own intrinsic size (and, cascading up, its unconstrained
    // flex-item ancestor) rather than shrinking the room left for text,
    // confirmed live: the button's own box ended up rendering past the
    // card's edge, worse than before. block+w-full pins the box to a real,
    // already-correctly-constrained 100% of its parent first, so pr-2 then
    // does what it's supposed to: eat into the text's own available room,
    // not the box's outer size — needed for both the collapsed state's
    // ellipsis (so it doesn't sit flush against the card edge) and the
    // expanded state's wrap (break-words only wraps exactly at the point
    // it would otherwise overflow, with no inherent margin of its own).
    <button
      type="button"
      onClick={onToggle}
      className={`block w-full cursor-pointer pr-2 text-left hover:text-ink-soft ${expanded ? 'break-words' : 'truncate'}`}
      aria-expanded={expanded}
      aria-label={expanded ? 'Show less of the original filename' : 'Show full original filename'}
    >
      {filename}
    </button>
  )
}

export function BookDetailsPage() {
  const { id } = useParams<{ id: string }>()
  const bookId = Number(id)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [bookEditOpen, setBookEditOpen] = useState(false)
  const coverFileInputRef = useRef<HTMLInputElement>(null)
  // Original filename can genuinely run long (an IMSLP-sourced scan's own
  // filename convention easily clears 50+ characters) — truncated to a
  // fixed length with a trailing "…", tap/click to reveal the rest, rather
  // than always showing the raw value (which just re-triggers the
  // min-w-0/break-words fix's own many-line wrap on a long enough name,
  // still readable but not exactly tidy).
  const [filenameExpanded, setFilenameExpanded] = useState(false)

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

  usePageTitle(book?.bookTitle)

  // aspect-[2/3] on the cover box below is a *loading-state placeholder
  // only*, not the real image's shape — same fix already applied to Piece
  // Details and the Book Upload Wizard's About step (see those files' own
  // comments). A permanently forced aspect + object-cover crops whatever
  // part of the real image doesn't fit 2:3 — most books have no custom
  // cover uploaded, so this is usually a raw rendered PDF page, not an
  // actual poster-shaped cover. Keyed on the cover's own source identifier
  // (not bookId) so switching between a custom cover and the PDF-page
  // fallback also resets it, not just navigating to a different book.
  const coverSource = book ? (book.coverImageHash ?? book.fileHash) : null
  const [coverLoaded, setCoverLoaded] = useState(false)
  useEffect(() => {
    setCoverLoaded(false)
  }, [coverSource])

  // Custom cover upload — both the header toolbar button and right-click/
  // long-press the cover call openCoverFilePicker, same shared trigger.
  // Applies regardless of whether the book already has a real file.
  // Invalidates ['books'] too, not just this one ['book', bookId] —
  // the Books library grid reads the same cover via getBookCoverUrl.
  const uploadCoverMutation = useMutation({
    mutationFn: (file: File) => uploadBookCover(bookId, file),
    onSuccess: (updated) => {
      queryClient.setQueryData(['book', bookId], updated)
      queryClient.invalidateQueries({ queryKey: ['books'] })
    },
    onError: (error) => {
      window.alert(error instanceof ApiError ? error.message : 'Could not upload this cover image.')
    },
  })

  const removeCoverMutation = useMutation({
    mutationFn: () => removeBookCover(bookId),
    onSuccess: (updated) => {
      queryClient.setQueryData(['book', bookId], updated)
      queryClient.invalidateQueries({ queryKey: ['books'] })
    },
    onError: (error) => {
      window.alert(error instanceof ApiError ? error.message : 'Could not remove this cover image.')
    },
  })

  // Same cascade-delete mutation as BookContextMenu's own "Delete Book"
  // (library right-click menu) — this toolbar button is a second entry
  // point to the identical action, not a different one, so it reuses the
  // exact confirm() wording (confirmMessage below, copied from
  // BookContextMenu.tsx). Unlike the context menu (which deletes a card out
  // of a list the user stays on), deleting from this page removes the very
  // book being viewed (and every piece in it), so success navigates back to
  // the Books library instead of just invalidating queries in place.
  const deleteMutation = useMutation({
    mutationFn: () => deleteBook(bookId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      queryClient.invalidateQueries({ queryKey: ['pieces'] })
      navigate('/books')
    },
    onError: (error) => {
      window.alert(error instanceof ApiError ? error.message : 'Could not delete this book.')
    },
  })

  function confirmDeleteMessage(): string {
    if (!book) return ''
    if (book.pieceCount === 0) {
      return `Delete "${book.bookTitle}"? This can't be undone.`
    }
    const pieceWord = book.pieceCount === 1 ? 'the 1 piece' : `all ${book.pieceCount} pieces`
    return `Delete "${book.bookTitle}"? This will also permanently delete ${pieceWord} in this book. This can't be undone.`
  }

  function handleDelete() {
    if (book && window.confirm(confirmDeleteMessage())) {
      deleteMutation.mutate()
    }
  }

  function openCoverFilePicker() {
    coverFileInputRef.current?.click()
  }

  function handleCoverFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) uploadCoverMutation.mutate(file)
    event.target.value = ''
  }

  const coverContextMenuItems = [
    { label: 'Change Cover Image', onSelect: openCoverFilePicker },
    ...(book?.hasCustomCover
      ? [{ label: 'Remove Cover Image', onSelect: () => removeCoverMutation.mutate(), destructive: true }]
      : []),
  ]

  // Keyboard shortcut: E opens the edit menu — same convention as
  // PiecePage.tsx's own E/F shortcuts (matches the header pencil button,
  // just a faster path to it). No favorite-toggle equivalent here since
  // Book has no favorite field. Skipped while the modal is already open
  // (its own fields should own keystrokes then) or while focus is in any
  // text-entry element, so typing "e" elsewhere on the page is never
  // intercepted. `repeat` guards against a held-down key re-opening the
  // (already-open, so harmless, but pointless) modal on every repeat tick.
  useEffect(() => {
    if (!book || bookEditOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return
      }
      if (event.key.toLowerCase() === 'e') {
        event.preventDefault()
        setBookEditOpen(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [book, bookEditOpen])

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
        // Matches Piece Details' own IMSLP row (PiecePage.tsx) — the
        // number itself is plain font-mono text, not a link; only the
        // external-link icon is the clickable `<a>`, styled with the
        // same muted pre-blended gray as there (never accent — that's
        // reserved for user-specific data, not a catalog identifier).
        value: (
          <span className="inline-flex items-center gap-1.5">
            <span className="font-mono">{book.imslpNumber}</span>
            <a
              href={imslpReverseLookupUrl(book.imslpNumber)}
              target="_blank"
              rel="noreferrer"
              aria-label="View on IMSLP"
              // Solid pre-blend, not opacity — overlapping icon strokes would re-blend unevenly under real translucency.
              className="text-[#9c968f] hover:text-ink-soft"
            >
              <IconExternalLink size={12} />
            </a>
          </span>
        ),
      })
    }
    // ISBN sits between IMSLP no. and Original filename, but only when
    // imslpNumber is blank. IMSLP
    // always wins the fallback over ISBN, same rule buildCitation applies
    // to ISBN in the citation string: showing both identifiers on a
    // details page that already has a dedicated IMSLP row would be
    // redundant, not additive. Unlike Piece Details page's book card (which
    // substitutes "IMSLP #{number}" in ISBN's place when hidden), this is
    // a full field-per-row details list that already has its own IMSLP
    // no. row above — nothing to substitute, the row simply doesn't
    // render.
    if (!book.imslpNumber && book.isbn) {
      fields.push({
        label: 'ISBN',
        // Matches the IMSLP no. row just above — the hyphenated number
        // itself is plain font-mono text, not a link; only the
        // external-link icon is the clickable `<a>`, same muted
        // pre-blended gray. isbnSearchUrl takes the raw digits-only value
        // (book.isbn), not the hyphenated display string.
        value: (
          <span className="inline-flex items-center gap-1.5">
            <span className="font-mono">{hyphenateISBN(book.isbn)}</span>
            <a
              href={isbnSearchUrl(book.isbn)}
              target="_blank"
              rel="noreferrer"
              aria-label="View on isbnsearch.org"
              className="text-[#9c968f] hover:text-ink-soft"
            >
              <IconExternalLink size={12} />
            </a>
          </span>
        ),
      })
    }
    if (book.originalFilename) {
      fields.push({
        label: 'Original filename',
        value: (
          <TruncatableFilename
            filename={book.originalFilename}
            expanded={filenameExpanded}
            onToggle={() => setFilenameExpanded((v) => !v)}
          />
        ),
      })
    }
  }

  return (
    <div className={`${CONTENT_MAX_W} flex flex-1 flex-col gap-6 p-6 md:p-8`}>
      {/* Edit / Change Cover / Open Book PDF live in this top toolbar row,
          mirroring Piece Details page's own toolbar (PiecePage.tsx): icon-only
          buttons first (Open Book PDF, Change Cover — identical
          bordered-square treatment), one labeled button last (Edit Book).
          flex-wrap + whitespace-nowrap below: at phone widths, "Back to
          Books" and the button group don't both fit one row, and without
          this the back link broke mid-phrase while the group held its full
          width and got silently clipped by an ancestor's overflow. Now the
          row wraps instead: the back link gets its own line, the group
          drops to a second line below it. */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          to="/books"
          className="inline-flex w-fit items-center gap-1.5 text-sm whitespace-nowrap text-ink-soft hover:text-ink"
        >
          <IconArrowLeft size={24} />
          Back to Books
        </Link>
        {book && (
          <div className="flex shrink-0 items-stretch gap-2.5">
            {/* Delete Book, icon-only, leftmost in the group, permanently
                red. Same cascade-delete action as
                BookContextMenu's "Delete Book" (library right-click menu) —
                handleDelete above reuses its exact confirm() wording — now
                also reachable directly from the page. self-center on the
                divider overrides this row's items-stretch (needed so the
                icon-only buttons, which set no height of their own,
                stretch to match Edit Book's taller px-4 py-2 box) — without
                it the divider's explicit h-6 would opt it out of stretch
                and fall back to flex-start, pinning it to the top instead
                of centering it. */}
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              aria-label="Delete Book"
              title="Delete Book"
              className="flex w-[38px] cursor-pointer items-center justify-center rounded-md border border-border bg-paper-raised text-red-700 hover:border-red-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border"
            >
              <IconTrash size={16} />
            </button>
            <span aria-hidden="true" className="h-6 w-px self-center bg-border" />
            {book.fileHash ? (
              <a
                href={getBookFileUrl(book.id)}
                target="_blank"
                rel="noreferrer"
                aria-label="Open Book PDF"
                title="Open Book PDF"
                className="flex w-[38px] items-center justify-center rounded-md border border-border bg-paper-raised text-ink-soft hover:border-accent hover:text-ink"
              >
                <IconFileTypePdf size={16} />
              </a>
            ) : (
              <span
                title="No original file on record"
                // text-[#aea9a4] is a solid pre-blend of ink-soft at 50%
                // over this span's own bg-paper-raised (white) background —
                // not a translucent text-ink-soft/50 utility. IconFileTypePdf
                // is a multi-path icon, so a translucent color would
                // re-blend (and visibly darken) at every path overlap.
                className="flex w-[38px] cursor-not-allowed items-center justify-center rounded-md border border-border bg-paper-raised text-[#aea9a4]"
              >
                <IconFileTypePdf size={16} />
              </span>
            )}
            <button
              type="button"
              onClick={openCoverFilePicker}
              aria-label="Change cover image"
              title="Change cover image"
              className="flex w-[38px] cursor-pointer items-center justify-center rounded-md border border-border bg-paper-raised text-ink-soft hover:border-accent hover:text-ink"
            >
              <IconPhotoUp size={16} />
            </button>
            <input
              ref={coverFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleCoverFileChosen}
            />
            {/* Collapses to icon-only below 360px — even after the outer
                row's flex-wrap above, this group's own natural width still
                doesn't fit the content area on the very narrowest real
                phone widths, and unlike the outer row this group has no
                second line to drop to
                without the divider ending up orphaned. Dropping the label
                instead — same icon-only treatment its siblings already
                use — shrinks it enough to fit down to 320px. */}
            <button
              type="button"
              onClick={() => setBookEditOpen(true)}
              aria-label="Edit Book"
              className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-sm whitespace-nowrap text-ink hover:border-accent max-[360px]:w-[38px] max-[360px]:px-0"
            >
              <IconEditFilled size={16} />
              <span className="max-[360px]:hidden">Edit Book</span>
            </button>
          </div>
        )}
      </div>

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
          {/* Header is its own card. Stacked (flex-col) below lg:, side-by-
              side above it — found live, 2026-09-05 (project_responsive_
              device_plan, Phase 4): the side-by-side row never collapsed at
              any width, so the info column's available width shrank along
              with the viewport (worse still, further eaten by the sidebar
              at md:+), overflowing the original filename past the card's
              own edge well before the header ever got phone-narrow — real
              breakage confirmed at both 375px and iPad-portrait's ~512px
              actual content width (post-sidebar), first genuinely clean
              row layout confirmed at iPad-landscape's ~768px. lg:items-start
              on the row itself, not the base flex-col: without it, the
              cover's flex cross-axis defaults to stretch, which fights its
              own aspect-[2/3] the moment a sibling column grows taller than
              the cover, distorting its shape — only relevant once they're
              actually side by side. */}
          <div className="overflow-hidden rounded-2xl border border-border bg-paper-raised shadow-sm">
            <div className="flex flex-col gap-6 p-7 lg:flex-row lg:items-start">
              {/* Custom cover upload — right-click (desktop) or
                  long-press (touch) the cover to change/remove it, same
                  ContextMenu component pieces already use. hideTriggerButton
                  since "D" (the top toolbar's camera button) already covers
                  the always-visible/discoverable path for the same action —
                  no "⋯" icon needed here too. hasCustomCover joins fileHash
                  as a second possible cover source; getBookCoverUrl resolves
                  which one server-side. */}
              <ContextMenu items={coverContextMenuItems} hideTriggerButton>
                {/* Longest side capped at 150px, shorter side following the
                    image's own aspect ratio — not a fixed 110px width
                    (design refined on /mockup/book-details first, see that
                    file's own comment on this same block). A landscape
                    image (most scanned pages, since most books have no
                    custom cover uploaded) is 150px wide with a shorter
                    height; a portrait image (most real book covers) is
                    150px *tall* with a narrower width — a very tall/narrow
                    scan no longer renders taller than every other cover on
                    the page. max-height/max-width + auto sizing on the
                    <img> picks whichever constraint binds, no orientation
                    detection needed. While loading, reserve a 150×150
                    square (a neutral upper bound in both directions, since
                    the real shape isn't known yet). The no-file fallback
                    (IconFileX below) has no image to derive a shape from,
                    so it keeps a fixed 2:3 placeholder capped the same way
                    (height, its longer side, at 150px). */}
                <div
                  className={`shrink-0 overflow-hidden rounded-md border border-border bg-paper-sunken ${
                    book.hasCustomCover || book.fileHash
                      ? coverLoaded
                        ? 'w-fit'
                        : 'h-[150px] w-[150px]'
                      : 'aspect-[2/3] h-[150px]'
                  }`}
                >
                  {book.hasCustomCover || book.fileHash ? (
                    <img
                      key={coverSource}
                      src={getBookCoverUrl(book.id, book.coverImageHash ?? book.fileHash)}
                      onLoad={() => setCoverLoaded(true)}
                      alt=""
                      className={
                        coverLoaded
                          ? 'block h-auto max-h-[150px] w-auto max-w-[150px]'
                          : 'invisible h-full w-full'
                      }
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
              </ContextMenu>
              <div className="min-w-0 flex-1">
                {/* Edit/Change Cover/Open Book PDF live in the top toolbar
                    above — this row is now just the title, no
                    longer needs its own justify-between wrapper since
                    there's nothing left to push to the opposite side. */}
                <div className="mb-2">
                  <h1 className="font-display text-[1.35rem] font-medium text-ink">
                    {book.bookTitle}
                    {book.workOpusNumber ? ` (${book.workOpusNumber})` : ''}
                  </h1>
                  <p className="text-[0.92rem] text-ink-soft">
                    {/* Composer/Arranger names link to their own Person
                        Details page, mirroring Piece Details' own header
                        row (PiecePage.tsx) — same bullet-fused "Composer •
                        arr. Arranger" convention as the old plain-string
                        bookComposerPart (lib/formatBookMeta.ts), just
                        JSX-capable now via PersonNameLinks. Falls back to
                        publisher (plain text, not a Person) when the book
                        has neither composer nor arranger — ValidateBook
                        requires one of composer/arranger/publisher, so this
                        is never blank. Scoped to this one header row only,
                        same as Piece Details — formatBookMeta/
                        bookComposerPart themselves are untouched and still
                        used as plain strings everywhere else (grid/list
                        cards, Piece Details' own Source Book card). */}
                    {(() => {
                      const composerNames = joinNames(book.composer.map((p) => p.name))
                      const arrangerNames = joinNames(book.arranger.map((p) => p.name))
                      const composerPart: ReactNode = composerNames ? (
                        <>
                          <PersonNameLinks people={book.composer} />
                          {arrangerNames && (
                            <>
                              {' '}
                              • arr. <PersonNameLinks people={book.arranger} />
                            </>
                          )}
                        </>
                      ) : arrangerNames ? (
                        <>
                          arr. <PersonNameLinks people={book.arranger} />
                        </>
                      ) : (
                        book.publisher
                      )
                      const parts = [composerPart, book.yearPublished].filter(
                        (part): part is NonNullable<typeof part> => !!part,
                      )
                      return parts.map((part, index) => (
                        <span key={index}>
                          {index > 0 && ' • '}
                          {part}
                        </span>
                      ))
                    })()}
                  </p>
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
                  <div className="mt-3.5 max-w-[60ch] text-[0.88rem] text-ink-soft">
                    <MarkdownText>{book.description}</MarkdownText>
                  </div>
                )}

                {fields.length > 0 && (
                  <div className="mt-3.5 flex flex-wrap gap-x-8 gap-y-3">
                    {fields.map((field) => (
                      // min-w-0 + break-words: a flex item's default
                      // min-width is `auto` (its own content's intrinsic
                      // minimum), not 0 — a long value with no natural
                      // break point (e.g. an underscore-joined filename)
                      // has an enormous min-content width, forcing this
                      // item wider than its own flex-wrap container rather
                      // than wrapping (found live testing this page's own
                      // phone-width layout, project_responsive_device_plan
                      // Phase 4 follow-up — confirmed via computed styles:
                      // this div was rendering 298px wide inside a 269px
                      // parent). min-w-0 lets it shrink to fit; break-words
                      // (overflow-wrap: break-word) is what actually gives
                      // long unbroken runs a place to wrap once it does.
                      <div key={field.label} className="min-w-0 break-words">
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
                  className={`flex size-8 cursor-pointer items-center justify-center rounded ${
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
                  className={`flex size-8 cursor-pointer items-center justify-center rounded ${
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
