import { useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  IconArrowLeft,
  IconEditFilled,
  IconExternalLink,
  IconFileTypePdf,
  IconHeartFilled,
  IconLayoutGridFilled,
  IconLayoutListFilled,
  IconMusic,
  IconPhotoUp,
  IconTrash,
} from '@tabler/icons-react'
import { hyphenateISBN } from '../lib/isbn'
import { useMockupTitle } from '../lib/useMockupTitle'
import { ContextMenu } from '../components/ContextMenu'
import { MarkdownText } from '../components/MarkdownText'

// ---------------------------------------------------------------------
// DESIGN MOCKUP — Book Details page, kept as a standing design reference
// (no design-doc spec to start from, same as the Books library view
// before it — see BooksLibrarySample.tsx). Visit /mockup/book-details
// directly; not wired to the real API, so Edit/Open PDF stay inert here.
//
// The header band is its own card (full border/radius/shadow). The
// pieces grid/list below is deliberately NOT a card — no border, no
// radius, no shadow, just a border-top hairline flush against the
// header card's bottom edge, same bg-paper tint as the page itself (two
// real regressions fixed along the way: an early pass rendered them as
// two separate floating cards, a later one wrongly fused them into one
// shared rounded box instead).
// No Advanced disclosure and no corner collapse toggle — Publisher/
// IMSLP no./Original filename render as one always-visible horizontal
// row of fields under the description, in the same over/under
// (small-caps label, value below) styling used everywhere else on this
// card. The grid/list toggle is real local state.
// ---------------------------------------------------------------------

interface SampleKey {
  id: number
  name: string
}

interface SamplePiece {
  id: number
  title: string
  composer: string | null
  arranger: string | null
  sourcePageStart: number
  pageCount: number
  favorite: boolean
  keys: SampleKey[]
  sheetType: string | null
  instruments: string[]
  userTags: string[]
}

const sampleBook = {
  bookTitle: 'Album für die Jugend',
  composer: 'Robert Schumann',
  // Set specifically to demonstrate the composer/arranger fusion on the
  // book header line.
  arranger: 'Theodor Kirchner' as string | null,
  yearWritten: '1848',
  workOpusNumber: 'Op. 68',
  sheetType: 'PVG Score',
  instruments: ['Piano'],
  publisher: 'Breitkopf & Härtel',
  publisherId: '8845',
  description:
    'A collection of 43 short character pieces for piano, composed for Schumann’s own children — arranged roughly in order of difficulty.',
  imslpNumber: 'IMSLP04154',
  // Stored digits-only, matching the backend (models.Book.ISBN) — see
  // bookFields' own comment for why this doesn't actually render in this
  // fixture's current committed state (imslpNumber above is set, and
  // IMSLP always wins the fallback over ISBN, same rule as
  // buildCitation's publisherId/ISBN handling).
  isbn: '9783795345352' as string | null,
  originalFilename: 'album-fur-die-jugend.pdf',
  importedAt: 'Aug 12, 2026',
}

// Deliberately mixed, same "stress the edges, not just the happy path"
// habit as the rest of this app's mockups: most pieces carry none of the
// optional fields (keys/sheetType/instruments/userTags/favorite), two do
// — enough to exercise the list view's tag-pill row and inline favorite
// without every row looking identical. "Kleine Studie" and "Armes
// Waisenkind" deliberately share sourcePageStart: 6 to demonstrate the
// sort's tie-break rule (1-page piece sorts first).
const samplePieces: SamplePiece[] = [
  {
    id: 1,
    title: 'Von fremden Ländern und Menschen',
    composer: null,
    arranger: null,
    sourcePageStart: 1,
    pageCount: 1,
    favorite: false,
    keys: [],
    sheetType: null,
    instruments: [],
    userTags: [],
  },
  {
    id: 2,
    title: 'Kuriose Geschichte',
    composer: null,
    arranger: null,
    sourcePageStart: 2,
    pageCount: 1,
    favorite: false,
    keys: [],
    sheetType: null,
    instruments: [],
    userTags: [],
  },
  {
    id: 3,
    title: 'Hasche-Mann',
    composer: null,
    arranger: 'Clara Wieck',
    sourcePageStart: 3,
    pageCount: 1,
    favorite: true,
    keys: [
      { id: 1, name: 'A Minor' },
      { id: 2, name: 'C Major' },
    ],
    sheetType: 'Solo Part',
    instruments: ['Piano'],
    userTags: ['Recital 2026'],
  },
  {
    id: 4,
    title: 'Bittendes Kind',
    composer: null,
    arranger: null,
    sourcePageStart: 4,
    pageCount: 1,
    favorite: false,
    keys: [],
    sheetType: null,
    instruments: [],
    userTags: [],
  },
  {
    id: 5,
    title: 'Glückes genug',
    composer: null,
    arranger: null,
    sourcePageStart: 5,
    pageCount: 1,
    favorite: false,
    keys: [],
    sheetType: null,
    instruments: [],
    userTags: [],
  },
  {
    id: 6,
    title: 'Kleine Studie',
    composer: null,
    arranger: null,
    sourcePageStart: 6,
    pageCount: 1,
    favorite: false,
    keys: [],
    sheetType: null,
    instruments: [],
    userTags: [],
  },
  {
    id: 7,
    title: 'Armes Waisenkind',
    composer: null,
    arranger: null,
    sourcePageStart: 6,
    pageCount: 2,
    favorite: true,
    keys: [],
    sheetType: null,
    instruments: [],
    userTags: [],
  },
]

// Primary key: sourcePageStart ascending. Tie-break: when two pieces
// share a start page, the 1-page piece sorts first.
function sortedPieces(pieces: SamplePiece[]): SamplePiece[] {
  return [...pieces].sort((a, b) => {
    if (a.sourcePageStart !== b.sourcePageStart) return a.sourcePageStart - b.sourcePageStart
    return (a.pageCount === 1 ? 0 : 1) - (b.pageCount === 1 ? 0 : 1)
  })
}

// Composer-or-arranger: a piece/book can have an arranger with no
// composer at all, so this can't just append arranger onto
// composer whenever it's set — composer blank + arranger set must still
// show "arr. Arranger" alone, not disappear entirely. Comma-fused
// ("Composer, arr. Arranger") — this is the PIECE-level convention used
// everywhere else in the app (formatPieceMeta.ts, PieceGridCard.tsx,
// BookUploadConfirmStep.tsx), mirroring the backend's citation format.
// Kept distinct from bookComposerPart below, which is bullet-separated
// instead. Factored out here (unlike those files) since this one file
// needs it in multiple places: the piece grid and the piece list.
function composerArrangerPart(composer: string | null, arranger: string | null): string | null {
  if (composer && arranger) return `${composer}, arr. ${arranger}`
  if (composer) return composer
  if (arranger) return `arr. ${arranger}`
  return null
}

// Book-level composer/arranger fusion — bullet-separated ("Composer •
// arr. Arranger"), not comma, to mirror how Piece Details shows a piece's
// own composer/arranger row (PiecePage.tsx). Mirrors
// frontend/src/lib/formatBookMeta.ts's real bookComposerPart exactly; kept
// as its own copy here rather than imported, same convention as
// composerArrangerPart above.
function bookComposerPart(composer: string | null, arranger: string | null): string | null {
  if (composer && arranger) return `${composer} • arr. ${arranger}`
  if (composer) return composer
  if (arranger) return `arr. ${arranger}`
  return null
}

// Book falls back to its own publisher when composer is blank (same
// silent-substitution convention as formatBookMeta.ts) — not shown here
// since sampleBook always has a composer, but pieceComposer below
// exercises the equivalent piece-falls-back-to-book case instead.
function pieceComposer(piece: SamplePiece): string | null {
  return piece.composer || sampleBook.composer
}

// Arranger is book-inheritable too — a piece with no arranger of its own
// falls back to the book's, same treatment as pieceComposer.
function pieceArranger(piece: SamplePiece): string | null {
  return piece.arranger || sampleBook.arranger
}

// Academic "p."/"pp." convention: singular "p." for one page, "pp." for a
// range — ported back from BookDetailsPage.tsx's own fix, same as
// pieceMetaLine's arranger fix above.
function pageRangeLabel(piece: SamplePiece): string {
  const end = piece.sourcePageStart + piece.pageCount - 1
  return piece.pageCount > 1 ? `pp. ${piece.sourcePageStart}–${end}` : `p. ${piece.sourcePageStart}`
}

function pagesLabel(piece: SamplePiece): string {
  return `${piece.pageCount} ${piece.pageCount === 1 ? 'page' : 'pages'}`
}

// Arranger rides on the composer segment itself (", arr. Arranger"), same
// convention as BookDetailsPage.tsx's own pieceMetaLine — porting that fix
// back here too since this file is the permanent design reference for the
// real page above it. Uses pieceArranger (book-inheritable), not the raw
// piece.arranger field directly, and composerArrangerPart's three-way
// fallback so an arranger-only piece still renders "arr. Arranger" instead
// of dropping arranger entirely (the old bug: appending arranger only ever
// happened onto an already-non-blank composer).
function pieceMetaLine(piece: SamplePiece): string {
  const composerPart = composerArrangerPart(pieceComposer(piece), pieceArranger(piece))
  return [composerPart, pagesLabel(piece)].filter((part): part is string => !!part).join(' • ')
}

// Realistic "black content on white page" placeholder — a title bar plus
// four staff-line groups — standing in for a real rendered PDF page.
// Used for both the book cover and every piece thumbnail, specifically
// so the page badge/thumbnail treatment can be judged against something
// closer to what most real scans will look like, not a blank box.
function SheetThumb() {
  const staffYs = [17, 31, 45, 59]
  return (
    <svg
      viewBox="0 0 100 74"
      preserveAspectRatio="xMidYMin slice"
      className="h-full w-full"
      aria-hidden="true"
    >
      <rect width="100" height="74" fill="white" />
      <rect x="8" y="7" width="30" height="3" fill="black" opacity="0.85" />
      {staffYs.map((y) => (
        <g key={y}>
          {Array.from({ length: 5 }, (_, i) => (
            <line
              key={i}
              x1="8"
              y1={y + i * 3}
              x2="92"
              y2={y + i * 3}
              stroke="black"
              strokeWidth="0.7"
            />
          ))}
        </g>
      ))}
    </svg>
  )
}

// Real TagPills.tsx order/content, ported by hand (no shared import —
// every mockup route here is deliberately self-contained): user tags →
// merged key pill (music icon, chevron-joined sequence) → sheet type →
// instruments. User tags render with no border, solid accent-soft fill,
// since they're the one genuinely user-authored category here.
//
// Deliberately reads piece.sheetType/piece.instruments directly — a
// piece's OWN value, never a book-inherited fallback: showing pills from
// inherited information would just clutter the view. Every piece in a book
// sharing the same inherited
// sheet type/instruments would otherwise repeat the identical pill on
// every single row, adding nothing the book header (above the piece list)
// hasn't already shown once. Keys and userTags were never book-inheritable
// to begin with (design doc §3), so this only actually changes behavior
// for sheetType/instruments. This is a real, currently-unfixed gap in the
// live app: BookDetailsPage.tsx's TagPills call passes
// piece.sheetType.value/piece.instruments.values — the *effective*
// (fallback-resolved) value, not gated on `.inherited` — so it currently
// shows exactly the repeated-pill clutter this mockup is deliberately
// avoiding. Needs the equivalent gate added when this ports over (step 6).
function PiecePills({ piece }: { piece: SamplePiece }) {
  if (
    !piece.keys.length &&
    !piece.sheetType &&
    !piece.instruments.length &&
    !piece.userTags.length
  ) {
    return null
  }
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {piece.userTags.map((tag) => (
        <span
          key={tag}
          className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent"
        >
          {tag}
        </span>
      ))}
      {piece.keys.length > 0 && (
        <span className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium whitespace-nowrap text-ink-soft">
          <IconMusic size={11} className="shrink-0" />
          <span>
            {piece.keys.map((key, i) => (
              <span key={key.id}>
                {i > 0 && (
                  <span className="font-normal opacity-[0.55]" aria-hidden="true">
                    {' '}
                    ›{' '}
                  </span>
                )}
                {key.name}
              </span>
            ))}
          </span>
        </span>
      )}
      {piece.sheetType && (
        <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-ink-soft">
          {piece.sheetType}
        </span>
      )}
      {piece.instruments.map((instrument) => (
        <span
          key={instrument}
          className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-ink-soft"
        >
          {instrument}
        </span>
      ))}
    </div>
  )
}

function PieceGrid({ pieces }: { pieces: SamplePiece[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3">
      {pieces.map((piece) => (
        <div
          key={piece.id}
          className="overflow-hidden rounded-lg border border-border bg-paper-raised transition-colors hover:border-accent"
        >
          {/* No page-range badge overlaying the thumbnail, and no
              composer/arranger row — too little room in a 112px-wide card
              for three lines of text plus a badge; the page range (shown
              on the bottom line below) is the one fact worth keeping. */}
          {/* border-b: a hairline between the thumbnail and the info text
              below it — without it, nothing but whitespace separates the
              two, relying entirely on the outer card border to read as
              "one card." */}
          <div className="relative aspect-[180/132] border-b border-border bg-white">
            <SheetThumb />
          </div>
          <div className="flex flex-col gap-0.5 px-2 py-1.5">
            <p className="truncate font-display text-[0.8rem] font-medium text-ink">{piece.title}</p>
            <p className="text-[0.65rem] text-ink-soft/80">{pageRangeLabel(piece)}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// Tailwind v4 compiles an arbitrary max-width variant to the modern
// range syntax (`@media (width < 500px)`) — exclusive of the boundary
// itself, not the traditional inclusive `max-width: 500px`. Using
// `max-[501px]:*` (verified via the served CSS: `@media (width < 501px)`)
// is what actually makes the drop happen *at* 500px and below, matching
// "narrow widths ≤500px" rather than silently requiring 499px first.
const THUMB_HIDE_CLASS = 'max-[501px]:hidden'
const ROW_COLLAPSE_CLASS = 'max-[501px]:grid-cols-[96px_1fr]'

function PieceList({ pieces }: { pieces: SamplePiece[] }) {
  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-[96px_1fr_56px] gap-3 px-1.5 pb-2.5 text-[0.7rem] font-medium tracking-wide text-ink-soft uppercase">
        <div>Page</div>
        <div>Title</div>
        <div className={THUMB_HIDE_CLASS} />
      </div>
      {pieces.map((piece) => (
        <div
          key={piece.id}
          className={`grid grid-cols-[96px_1fr_56px] items-center gap-3 border-t border-border px-1.5 py-2.5 first:border-t-0 hover:rounded-md hover:bg-accent-soft ${ROW_COLLAPSE_CLASS}`}
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
            <PiecePills piece={piece} />
          </div>
          <div
            className={`relative h-[42px] w-14 overflow-hidden rounded-md border border-border ${THUMB_HIDE_CLASS}`}
          >
            <SheetThumb />
          </div>
        </div>
      ))}
    </div>
  )
}

// Publisher/IMSLP no./Original filename — one always-visible
// horizontal row under the description, each in the same over/under
// (small-caps label, value below) styling. Hidden individually when
// blank, same "hide missing metadata" rule as everywhere else on this
// page — no more "always render regardless of blank" Advanced-box
// exception, since that box no longer exists.
function bookFields(): { label: string; value: ReactNode }[] {
  const fields: { label: string; value: ReactNode }[] = []
  if (sampleBook.publisher || sampleBook.publisherId) {
    fields.push({
      label: 'Publisher',
      value: [sampleBook.publisher, sampleBook.publisherId ? `#${sampleBook.publisherId}` : null]
        .filter(Boolean)
        .join(' '),
    })
  }
  if (sampleBook.imslpNumber) {
    fields.push({
      label: 'IMSLP no.',
      value: (
        <>
          {sampleBook.imslpNumber}
          {/* Solid pre-blend, not opacity — overlapping icon strokes would re-blend unevenly under real translucency. */}
          <IconExternalLink size={12} className="ml-0.5 inline text-[#605d5b]" />
        </>
      ),
    })
  }
  // ISBN sits between IMSLP no. and Original filename, but only when
  // imslpNumber is blank. IMSLP always wins
  // the fallback over ISBN, same rule buildCitation applies to ISBN in the
  // citation string: showing both identifiers on a details page that
  // already has a dedicated IMSLP row would be redundant, not additive.
  // Unlike Piece Details page's book card (which substitutes "IMSLP #{number}" in
  // ISBN's place when hidden), this is a full field-per-row details list
  // that already has its own IMSLP no. row above — nothing to substitute,
  // the row simply doesn't render.
  if (!sampleBook.imslpNumber && sampleBook.isbn) {
    fields.push({ label: 'ISBN', value: hyphenateISBN(sampleBook.isbn) })
  }
  if (sampleBook.originalFilename) {
    fields.push({ label: 'Original filename', value: sampleBook.originalFilename })
  }
  return fields
}

export function BookDetailsSample() {
  useMockupTitle('Book Details')

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

  // Custom cover upload, combining trigger "D" (header toolbar button)
  // and trigger "E" (right-click/long-press context menu) for the same
  // action. Applies regardless of whether the book already has a real
  // file — a book with a perfectly good first-page thumbnail can still
  // have it manually overridden. Neither D nor E touches the cover's own
  // visual chrome (no corner button, no dropzone styling) — the cover
  // renders exactly as it already does either way, which is what makes
  // layering two independent trigger paths onto the same action
  // reasonable instead of redundant-looking.
  const [customCoverUrl, setCustomCoverUrl] = useState<string | null>(null)
  const coverFileInputRef = useRef<HTMLInputElement>(null)

  function openCoverFilePicker() {
    coverFileInputRef.current?.click()
  }

  function handleCoverFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) {
      if (customCoverUrl) URL.revokeObjectURL(customCoverUrl)
      setCustomCoverUrl(URL.createObjectURL(file))
    }
    event.target.value = ''
  }

  function handleRemoveCustomCover() {
    if (customCoverUrl) URL.revokeObjectURL(customCoverUrl)
    setCustomCoverUrl(null)
  }

  const coverContextMenuItems = [
    { label: 'Change Cover Image', onSelect: openCoverFilePicker },
    ...(customCoverUrl
      ? [{ label: 'Remove Cover Image', onSelect: handleRemoveCustomCover, destructive: true }]
      : []),
  ]

  const pieces = sortedPieces(samplePieces)
  const title = sampleBook.workOpusNumber
    ? `${sampleBook.bookTitle} (${sampleBook.workOpusNumber})`
    : sampleBook.bookTitle
  // bookComposerPart's fallback, then the book's own composer→publisher
  // fallback (effectiveBookComposer, lib/formatBookMeta.ts) if neither
  // composer nor arranger is set — unexercised here since sampleBook always
  // has a composer, same as pieceComposer's own equivalent fallback.
  const composerLine =
    bookComposerPart(sampleBook.composer, sampleBook.arranger) || sampleBook.publisher
  const metaLine = [composerLine, sampleBook.yearWritten].filter(Boolean).join(' • ')
  const fields = bookFields()

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 md:p-8">
      <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
        Design mockup — <span className="font-medium text-ink">Book Details page</span>. Not wired
        to real data; Open Book PDF, Edit Book, and Delete Book stay inert here on purpose — this
        fixture's data doesn't correspond to any real record, so wiring these to a real API call could
        edit or delete whatever real book happens to share its id. Custom cover upload{' '}
        <em>is</em> genuinely interactive though (same for the right-click/long-press cover menu) — try
        the photo-upload icon in the top toolbar, or right-click/long-press the cover itself.
      </div>

      {/* Edit / Change Cover / Open Book PDF live in this top toolbar row,
          styled to mirror Piece Details page's own toolbar exactly
          (PiecePage.tsx: icon-only buttons first, one labeled
          ActionButton-style button last) rather than mixed styling — Open
          Book PDF uses the same bordered-square icon-only look as Change
          Cover instead of an accent-filled treatment, and Edit Book gets a
          label instead of being the odd icon-only one out. */}
      {/* flex-wrap (same fix as PieceDetailsSample's own toolbar, see that
          file's comment for the full measurement-backed reasoning): at
          phone widths "Back to Books" and the button group don't fit on
          one row (122px + 284px + 16px gap > the 311px content area), and
          the button group's own shrink-0 (needed so the icon-only buttons
          stretch to Edit Book's height, see the divider comment below) was
          making it worse — instead of shrinking or wrapping, it held its
          full width and got silently clipped by an ancestor's overflow,
          cutting "Edit Book" down to just "E" with no scrollbar to reveal
          the rest. Wrapping the outer row fixes both at once: the button
          group still won't shrink internally, but now it's not competing
          with the back link for the same line, so it just drops to its own
          full line below (adequate room there — 284px fits in 311px). */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Label reads "Back to Books" (matching BookDetailsPage.tsx's real
            copy) but actually routes to /mockup, not /books — every
            mockup's Back control returns to the mockup index rather than
            wherever the label implies, so browsing mockups never leaks
            into real app routes/state. */}
        <Link
          to="/mockup"
          className="inline-flex w-fit items-center gap-1.5 text-sm whitespace-nowrap text-ink-soft hover:text-ink"
        >
          <IconArrowLeft size={24} />
          Back to Books
        </Link>
        <div className="flex shrink-0 items-stretch gap-2.5">
          {/* Delete Book, icon-only, leftmost in the group, divider after
              it. The same cascade-delete action already reachable via
              right-click on a library card (BookContextMenu's "Delete
              Book", which also deletes every Piece in the book), also
              given a direct entry point from the page itself — this app's
              single largest-blast-radius action (whole book + every piece
              in it), so it earns visual distance from the other three via
              the divider. Permanently red (text-red-700, matching
              ContextMenu's own destructive-item color exactly — that color
              is always-on there too, not a hover-only reveal), not
              red-on-hover. Stays inert here on purpose, same as its
              siblings below — see the disclaimer banner above for why
              (this mockup is never wired to a real API call, delete
              included). */}
          <button
            type="button"
            aria-label="Delete Book"
            title="Delete Book — not wired in this mockup"
            className="flex w-[38px] cursor-not-allowed items-center justify-center rounded-md border border-border bg-paper-raised text-red-700"
          >
            <IconTrash size={16} />
          </button>
          {/* self-center overrides the container's items-stretch (needed so
              the icon-only buttons, which set no height of their own,
              stretch to match Edit Book's taller px-4 py-2 box) — without
              it, this span's explicit h-6 opts it out of stretch and falls
              back to flex-start, pinning it to the top instead of centering
              it. PieceDetailsSample's own divider doesn't need this since
              that toolbar uses items-center instead of items-stretch. */}
          <span aria-hidden="true" className="h-6 w-px self-center bg-border" />
          <button
            type="button"
            onClick={(event) => event.preventDefault()}
            aria-label="Open Book PDF"
            title="Open Book PDF — no real file in this mockup"
            className="flex w-[38px] cursor-pointer items-center justify-center rounded-md border border-border bg-paper-raised text-ink-soft hover:border-accent hover:text-ink"
          >
            <IconFileTypePdf size={16} />
          </button>
          {/* "D" from the cover-upload comparison — identical bordered-
              square treatment to Open Book PDF right beside it. */}
          <button
            type="button"
            onClick={openCoverFilePicker}
            aria-label="Change cover image"
            title="Change cover image"
            className="flex w-[38px] cursor-pointer items-center justify-center rounded-md border border-border bg-paper-raised text-ink-soft hover:border-accent hover:text-ink"
          >
            <IconPhotoUp size={16} />
          </button>
          {/* Collapses to icon-only below 360px — even
              after the outer row's flex-wrap fix above, this button group's
              own natural width (284px) still doesn't fit the content area
              on the very narrowest real phone widths (measured: breaks
              below ~348px), and unlike the outer row this group has no
              second line to drop to without the divider ending up
              orphaned. Dropping the label instead — same icon-only
              treatment its siblings (Delete/Open PDF/Change Cover) already
              use — shrinks it enough to fit down to 320px. max-[360px], not
              max-[348px]: per this project's own documented arbitrary-
              breakpoint gotcha (max-[Npx] is exclusive, so max-[Npx] alone
              would need N+1 to mean "≤N") this picks a round number with a
              little headroom rather than the exact measured threshold. */}
          <button
            type="button"
            aria-label="Edit Book"
            title="Edit Book — not wired in this mockup"
            className="flex cursor-not-allowed items-center justify-center gap-2 rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-sm whitespace-nowrap text-ink max-[360px]:w-[38px] max-[360px]:px-0"
          >
            <IconEditFilled size={16} />
            <span className="max-[360px]:hidden">Edit Book</span>
          </button>
        </div>
      </div>

      {/* Header is its own card (full border + radius + shadow). The
          pieces section below is deliberately NOT a card — no border,
          no radius, no shadow, just a border-top hairline sitting flush
          against the header card's bottom edge (an earlier pass had
          wrongly given the pieces area full card chrome of its own,
          either as a separate floating card or fused into one shared
          rounded box with the header). items-start on
          the header row specifically: without it, the cover's flex
          cross-axis defaults to stretch, which fights its own
          aspect-[2/3] the moment a sibling column grows taller than the
          cover, distorting its shape. */}
      <div>
        <div className="overflow-hidden rounded-2xl border border-border bg-paper-raised shadow-sm">
          <div className="flex items-start gap-6 p-7">
            {/* Custom cover upload, combining trigger "D" (header toolbar
                button, below) with trigger "E" (this context menu).
                The cover itself renders exactly as it already does either
                way (no corner button, no dropzone styling) — "E" wraps it
                in the same ContextMenu component piece cards already use
                (right-click on desktop, long-press on touch), with
                hideTriggerButton so no "⋯" icon competes with "D"'s
                always-visible header button for the same action. Applies
                regardless of file status — a book with a real PDF and a
                perfectly good thumbnail can still have it overridden, not
                just a book with no cover to begin with. */}
            <ContextMenu items={coverContextMenuItems} hideTriggerButton>
              <div className="aspect-[2/3] w-[110px] shrink-0 overflow-hidden rounded-md border border-border bg-white">
                {customCoverUrl ? (
                  <img src={customCoverUrl} alt="" className="h-full w-full object-cover object-top" />
                ) : (
                  <SheetThumb />
                )}
              </div>
            </ContextMenu>
            <input
              ref={coverFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleCoverFileChosen}
            />
            <div className="min-w-0 flex-1">
              {/* Edit/Change Cover/Open Book PDF live in the top toolbar
                  above — this row is now just the title, no longer needs
                  its own justify-between wrapper since there's nothing
                  left to push to the opposite side. */}
              <div className="mb-2">
                <h1 className="font-display text-[1.35rem] font-medium text-ink">{title}</h1>
                <p className="text-[0.92rem] text-ink-soft">{metaLine}</p>
              </div>

              {(sampleBook.sheetType || sampleBook.instruments.length > 0) && (
                <div className="mt-1 mb-1.5 flex flex-wrap gap-1.5">
                  {sampleBook.sheetType && (
                    <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-ink-soft">
                      {sampleBook.sheetType}
                    </span>
                  )}
                  {sampleBook.instruments.map((instrument) => (
                    <span
                      key={instrument}
                      className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-ink-soft"
                    >
                      {instrument}
                    </span>
                  ))}
                </div>
              )}

              {sampleBook.description && (
                <div className="mt-3.5 max-w-[60ch] text-[0.88rem] text-ink-soft">
                  <MarkdownText>{sampleBook.description}</MarkdownText>
                </div>
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

        {/* Pieces — NOT a card: no border/radius/shadow, no divider
            lines above or below the heading row either, just spacing. */}
        <div className="mt-6 bg-paper">
          <div className="flex flex-wrap items-center justify-between gap-4 px-6 pb-4">
            <h2 className="font-display text-[0.95rem] font-semibold text-ink-soft">
              {pieces.length} {pieces.length === 1 ? 'piece' : 'pieces'} in this book
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
            {viewMode === 'grid' ? <PieceGrid pieces={pieces} /> : <PieceList pieces={pieces} />}
          </div>
        </div>
      </div>
    </div>
  )
}
