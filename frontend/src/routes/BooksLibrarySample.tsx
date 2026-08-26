import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  IconChevronRight,
  IconFile,
  IconLayoutGridFilled,
  IconLayoutListFilled,
  IconPlus,
  IconSearch,
  IconXFilled,
} from '@tabler/icons-react'
import { Modal } from '../components/Modal'
import { useMockupTitle } from '../lib/useMockupTitle'

// ---------------------------------------------------------------------
// DESIGN MOCKUP for the Books Library page — a standing reference showing
// two competing layouts side by side: Option B (cover grid) and Option C
// (catalog list), behind the same grid/list toggle the real Pieces
// Library already uses (LibraryPage.tsx), so switching between them reads
// as "the same kind of choice" a user already knows from the Pieces view,
// not a new concept. Visit /mockup/books-library directly; not wired to
// real data or navigation, so cards are hover-only, not real links.
// ---------------------------------------------------------------------

interface MockBook {
  id: number
  bookTitle: string
  composer: string | null
  publisher: string | null
  yearWritten: string | null
  pieceCount: number
}

// Composer is optional on Book (design doc §3) — publisher is the agreed
// fallback display value when it's blank, not a special "inherited"-style
// badge (that convention is for Piece fields falling back to their book;
// this is a book falling back to its own other field). Silent substitution,
// same "blank fields omitted, not shown as empty punctuation" principle as
// formatPieceMeta.ts — and when *neither* is set, the field is just
// omitted rather than showing a placeholder dash.
function effectiveComposer(book: MockBook): string | null {
  return book.composer || book.publisher
}

function metaLine(book: MockBook): string {
  return [effectiveComposer(book), book.yearWritten].filter((part): part is string => !!part).join(' • ')
}

// Deliberately mixed: #2 has no composer but a publisher (exercises the
// fallback), #6 has neither (exercises the fully-empty case), piece counts
// span 4-400, titles span short to long — same "stress the edges, not just
// the happy path" habit as the rest of this app's mockups/fixtures.
const MOCK_BOOKS: MockBook[] = [
  { id: 1, bookTitle: 'Album für die Jugend, Op. 68', composer: 'Robert Schumann', publisher: 'G. Schirmer', yearWritten: '1848', pieceCount: 43 },
  { id: 2, bookTitle: 'The Real Book — Sixth Edition', composer: null, publisher: 'Hal Leonard', yearWritten: null, pieceCount: 400 },
  { id: 3, bookTitle: '24 Préludes, Op. 28', composer: 'Frédéric Chopin', publisher: 'Breitkopf & Härtel', yearWritten: '1839', pieceCount: 24 },
  { id: 4, bookTitle: 'Sonatas and Partitas for Solo Violin', composer: 'J.S. Bach', publisher: null, yearWritten: '1720', pieceCount: 6 },
  { id: 5, bookTitle: 'Piano Sonatas, Volume I', composer: 'Ludwig van Beethoven', publisher: 'Henle', yearWritten: '1802', pieceCount: 8 },
  { id: 6, bookTitle: 'Anthology of American Folk Songs', composer: null, publisher: null, yearWritten: null, pieceCount: 52 },
  { id: 7, bookTitle: 'Suite bergamasque', composer: 'Claude Debussy', publisher: 'Durand', yearWritten: '1905', pieceCount: 4 },
  { id: 8, bookTitle: 'The Nutcracker Suite, Op. 71a (Piano Reduction)', composer: 'Pyotr Ilyich Tchaikovsky', publisher: 'G. Schirmer', yearWritten: '1892', pieceCount: 8 },
]

// A believable spread of book-cover colors — published sheet-music
// collections (fake books, method books, anthologies) often *do* have
// their own printed cover art as the PDF's first page, not a plain music
// page, which is exactly why the piece-count scrim needed testing against
// something other than this mockup's old uniform cream placeholder.
// Deliberately spans light/medium/dark so the white-on-dark-scrim choice
// gets checked against the full brightness range real covers could throw
// at it, not just a favorable middle case.
const COVER_PALETTE: { bg: string; text: string }[] = [
  { bg: '#a8462f', text: '#fbf4ee' }, // terracotta
  { bg: '#1c2b4a', text: '#eef1f6' }, // navy
  { bg: '#e3c2c2', text: '#3a2320' }, // dusty rose (light)
  { bg: '#2f4536', text: '#eef3ea' }, // deep green
  { bg: '#c98a2c', text: '#2b1c08' }, // ochre
  { bg: '#e8ddc7', text: '#4a3f2c' }, // cream/tan (light)
  { bg: '#8a76a3', text: '#f5f1f9' }, // dusty lavender
  { bg: '#5b1f2b', text: '#f4e6e8' }, // burgundy
]

function coverPalette(id: number) {
  return COVER_PALETTE[(id - 1) % COVER_PALETTE.length]
}

// Stands in for "the book's own first page" — there's no book-cover-
// thumbnail concept in the API today (only a per-page render of the
// original PDF). Title + composer lockup on a flat color field, same
// "Diagonal Light" gradient overlay the app icon itself uses (locked
// design system) for a touch of dimension rather than a dead-flat swatch.
function CoverPlaceholder({ book }: { book: MockBook }) {
  const { bg, text } = coverPalette(book.id)
  const composer = effectiveComposer(book)
  const words = book.bookTitle.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if ((current + ' ' + word).trim().length > 14) {
      lines.push(current.trim())
      current = word
    } else {
      current = (current + ' ' + word).trim()
    }
    if (lines.length >= 3) break
  }
  if (current && lines.length < 3) lines.push(current)
  const titleLines = lines.slice(0, 3)
  const titleStartY = 150 - ((titleLines.length - 1) * 20) / 2

  return (
    <svg viewBox="0 0 200 300" preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
      <defs>
        <linearGradient id={`diag-${book.id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.2" />
          <stop offset="50%" stopColor="#fff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.14" />
        </linearGradient>
      </defs>
      <rect width="200" height="300" fill={bg} />
      <rect width="200" height="300" fill={`url(#diag-${book.id})`} />
      {titleLines.map((line, i) => (
        <text
          key={i}
          x="100"
          y={titleStartY + i * 20}
          textAnchor="middle"
          fontFamily="Georgia, serif"
          fontWeight="700"
          fontSize="15"
          fill={text}
        >
          {line}
        </text>
      ))}
      {composer && (
        <text
          x="100"
          y={titleStartY + titleLines.length * 20 + 14}
          textAnchor="middle"
          fontFamily="Georgia, serif"
          fontStyle="italic"
          fontSize="10"
          fill={text}
          opacity="0.85"
        >
          {composer}
        </text>
      )}
    </svg>
  )
}

// ---- Option B: cover grid ----
// Piece count treatment: a dark pill in the bottom-right corner, not a
// full-width gradient scrim across the cover. Went through a scrim-based
// version first (10% black proved too weak against lighter covers like
// dusty rose/cream-tan, bumped to 18%, then to 65% peak trying to hold up
// against real colorful/photographic covers), but at that darkness the
// scrim read as either faint or heavy-handed depending on the cover —
// there was no peak opacity that worked well across all of them. Chosen
// instead from a 5-option comparison (solid pill, rounded-rect, frosted
// glass, opaque brand-ink, and a light counterpoint pill) against the same
// real covers: the pill's own background does the contrast work, so the
// cover art underneath stays untouched regardless of how light, dark, or
// colorful it is.
function BookCoverCard({ book }: { book: MockBook }) {
  const meta = metaLine(book)
  return (
    <div className="flex cursor-pointer flex-col gap-2">
      <div className="relative aspect-[2/3] overflow-hidden rounded-md border border-border shadow-sm transition-shadow hover:shadow-lg">
        <CoverPlaceholder book={book} />
        <span className="absolute right-2 bottom-1.5 flex items-center gap-1 rounded-full bg-[rgba(28,24,21,0.82)] px-[7px] py-[2px] text-[0.7rem] font-semibold text-white">
          {book.pieceCount}
          <IconFile size={10} />
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <p className="line-clamp-2 font-display text-sm font-medium text-ink">{book.bookTitle}</p>
        {meta && <p className="truncate text-xs text-ink-soft">{meta}</p>}
      </div>
    </div>
  )
}

// ---- Option C: catalog list ----
function BookCatalogRow({ book }: { book: MockBook }) {
  const meta = metaLine(book)
  return (
    <div className="flex cursor-pointer items-center gap-5 rounded-md border-t border-border px-2 py-3 first:border-t-0 hover:bg-accent-soft">
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-base font-medium text-ink">{book.bookTitle}</p>
        <p className="truncate text-sm text-ink-soft">
          {meta || <span className="text-ink-soft/60 italic">No composer or publisher on file</span>}
        </p>
      </div>
      <div className="flex w-14 shrink-0 flex-col items-center justify-center border-l border-border pl-4">
        <span className="font-display text-xl leading-none text-accent">{book.pieceCount}</span>
        <span className="mt-1 text-[0.6rem] tracking-wide text-ink-soft uppercase">pieces</span>
      </div>
      {/* Solid pre-blend, not opacity — overlapping icon strokes would re-blend unevenly under real translucency. */}
      <IconChevronRight size={18} className="shrink-0 text-[#aca7a1]" />
    </div>
  )
}

interface NewBookFormValues {
  bookTitle: string
  composer: string
  publisher: string
  yearWritten: string
}

// Manual book creation (design doc §5 note: a Book can legitimately exist
// with zero linked Pieces — this is that case, not a resume-import flow).
// Deliberately minimal: only the four fields a book can meaningfully have
// before any pieces are attached to it — no sheet type/instruments/opus/
// IMSLP/description here, those only make sense once there's real content
// to classify. Title is the only required field, same reasoning as
// ValidateBook's real bookTitle requirement (CLAUDE.md > Book-level soft
// inheritance) — an untitled book is a confusing empty state anywhere it's
// shown, everywhere else is genuinely optional.
function NewBookModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (values: NewBookFormValues) => void
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<NewBookFormValues>({
    defaultValues: { bookTitle: '', composer: '', publisher: '', yearWritten: '' },
  })

  function handleClose() {
    reset()
    onClose()
  }

  function onSubmit(data: NewBookFormValues) {
    onCreate(data)
    reset()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      labelledBy="new-book-title"
      header={
        <div className="flex items-start justify-between gap-4">
          <h2 id="new-book-title" className="font-display text-2xl font-medium text-ink">
            New book
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="mt-1 shrink-0 text-ink-soft hover:text-accent"
          >
            <IconXFilled size={22} />
          </button>
        </div>
      }
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="new-book-form"
            className="rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90"
          >
            Create
          </button>
        </div>
      }
    >
      <form id="new-book-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="nb-title" className="text-sm text-ink-soft">
            Title <span className="italic text-ink-soft/60">(Required)</span>
          </label>
          <input
            id="nb-title"
            autoFocus
            className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
            {...register('bookTitle', { required: 'Title is required.', maxLength: 255 })}
          />
          {errors.bookTitle && <p className="text-sm text-red-700">{errors.bookTitle.message}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="nb-composer" className="text-sm text-ink-soft">
            Composer
          </label>
          <input
            id="nb-composer"
            className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
            {...register('composer', { maxLength: 255 })}
          />
        </div>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="nb-publisher" className="text-sm text-ink-soft">
              Publisher
            </label>
            <input
              id="nb-publisher"
              className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('publisher', { maxLength: 255 })}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="nb-year" className="text-sm text-ink-soft">
              Year first published
            </label>
            <input
              id="nb-year"
              className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('yearWritten', { maxLength: 255 })}
            />
          </div>
        </div>
      </form>
    </Modal>
  )
}

type ViewMode = 'grid' | 'list'

export function BooksLibrarySample() {
  useMockupTitle('Books Library')

  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [books, setBooks] = useState<MockBook[]>(MOCK_BOOKS)
  const [newBookOpen, setNewBookOpen] = useState(false)
  // Stable, incrementing placeholder ids for mockup-created books, well
  // clear of the seeded 1-8 range — a real create would get its id back
  // from the API response instead.
  const nextBookId = useRef(1000)

  function handleCreateBook(values: NewBookFormValues) {
    setBooks((prev) => [
      {
        id: nextBookId.current++,
        bookTitle: values.bookTitle.trim(),
        composer: values.composer.trim() || null,
        publisher: values.publisher.trim() || null,
        yearWritten: values.yearWritten.trim() || null,
        // A freshly created book has no pieces linked yet — real pieces
        // only get attached via the import wizard's confirm step.
        pieceCount: 0,
      },
      ...prev,
    ])
    setNewBookOpen(false)
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-paper p-4">
        <div className="relative max-w-md flex-1">
          <IconSearch
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft"
          />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your books…"
            className="w-full rounded-md border border-border bg-paper-raised py-2 pr-3 pl-9 text-sm text-ink"
          />
        </div>
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
        <button
          type="button"
          onClick={() => setNewBookOpen(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-2 font-display text-sm text-white hover:bg-accent/90"
        >
          <IconPlus size={16} />
          New Book
        </button>
      </div>

      <div className="p-4 pb-0">
        <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
          Design mockup — <span className="font-medium text-ink">Books library view</span>. Grid = Option
          B (cover grid), List = Option C (catalog list). Not wired to real data; cards aren't real links.
        </div>
      </div>

      <div className="flex-1 p-4">
        {viewMode === 'grid' && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-4 gap-y-6">
            {books.map((book) => (
              <BookCoverCard key={book.id} book={book} />
            ))}
          </div>
        )}

        {viewMode === 'list' && (
          <div className="flex flex-col">
            {books.map((book) => (
              <BookCatalogRow key={book.id} book={book} />
            ))}
          </div>
        )}
      </div>

      <NewBookModal open={newBookOpen} onClose={() => setNewBookOpen(false)} onCreate={handleCreateBook} />
    </div>
  )
}
