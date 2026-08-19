import { IconBook, IconMusic } from '@tabler/icons-react'
import { getBookPageThumbnailUrl } from '../api/books'
import type { Book } from '../api/types'
import { formatBookMeta } from '../lib/formatBookMeta'

interface BookGridCardProps {
  book: Book
}

// Books library view, locked design (2026-08-18, see the "Books Library —
// Design Options" artifact and design-review screenshots): portrait 2:3
// covers, not Pieces' landscape 180:132 — the aspect ratio alone reads as
// "different kind of object" at a glance while staying recognizably the
// same card-grid pattern. Piece count sits as a minimal label on a dark
// scrim in the bottom-right corner (not a pill) — real cover art is often
// colorful/photographic, so a light label over a dark gradient holds up
// across unpredictable art the way a pill badge wouldn't need to. No
// click-through yet — there's no Book View page to land on (design doc
// §16's Book Properties Edit Menu is reached from a Piece's own page, not
// a standalone route), so these cards are just browsable, not navigable.
export function BookGridCard({ book }: BookGridCardProps) {
  const meta = formatBookMeta(book)

  return (
    <div className="flex flex-col gap-2">
      <div className="relative aspect-[2/3] overflow-hidden rounded-md border border-border bg-paper-sunken shadow-sm transition-shadow hover:shadow-lg">
        {book.fileHash ? (
          <img
            src={getBookPageThumbnailUrl(book.id, 1)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover object-top"
          />
        ) : (
          // A manually created book (migration 00014) has no file to
          // render a cover from — a neutral placeholder, not the colorful
          // design-review mockup art (that was only ever a stand-in to
          // stress-test the scrim/label against varied cover brightness).
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-ink-soft/40">
            <IconBook size={28} />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-11 bg-[linear-gradient(to_top,rgba(0,0,0,0.18)_0%,rgba(0,0,0,0)_100%)]" />
        <span className="absolute right-2 bottom-1.5 flex items-center gap-1 text-[0.7rem] font-semibold text-white drop-shadow-sm">
          {book.pieceCount}
          <IconMusic size={10} />
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <p className="line-clamp-2 font-display text-sm font-medium text-ink">{book.bookTitle}</p>
        {meta && <p className="truncate text-xs text-ink-soft">{meta}</p>}
      </div>
    </div>
  )
}
