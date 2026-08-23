import { IconFileX, IconMusic } from '@tabler/icons-react'
import { getBookCoverUrl } from '../api/books'
import type { Book } from '../api/types'
import { formatBookMeta } from '../lib/formatBookMeta'
import { BookContextMenu } from './BookContextMenu'
import { ClickableCard } from './ClickableCard'

interface BookGridCardProps {
  book: Book
}

// Portrait 2:3 covers, not Pieces' landscape 180:132 — the aspect ratio
// alone reads as "different kind of object" at a glance while staying
// recognizably the same card-grid pattern. Piece count sits as a minimal
// label on a dark scrim in the bottom-right corner (not a pill) — real
// cover art is often colorful/photographic, so a light label over a dark
// gradient holds up across unpredictable art the way a pill badge
// wouldn't need to.
export function BookGridCard({ book }: BookGridCardProps) {
  const meta = formatBookMeta(book)

  return (
    // Right-click (desktop) + long-press (touch) via ContextMenu's own
    // built-in handling, no visible "⋯" trigger — same convention as
    // PieceGridCard: a permanently-visible button on every card in a
    // dense grid reads as clutter.
    <BookContextMenu book={book} hideTriggerButton>
      <ClickableCard to={`/books/${book.id}`} className="flex flex-col gap-2 text-left">
        <div className="relative aspect-[2/3] overflow-hidden rounded-md border border-border bg-paper-sunken shadow-sm transition-shadow hover:shadow-lg">
          {/* hasCustomCover and fileHash are two independent sources a
              cover can come from — getBookCoverUrl resolves which one
              server-side, so this gate only needs to know whether *either*
              exists, not which. */}
          {book.hasCustomCover || book.fileHash ? (
            <img
              src={getBookCoverUrl(book.id, book.coverImageHash ?? book.fileHash)}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover object-top"
            />
          ) : (
            // A manually created book (migration 00014) has no file to
            // render a cover from — file-x on flat-sunken. Icon color is
            // a solid pre-blended hex, not a
            // translucent text-ink-soft/* opacity utility: Tabler icons are
            // several overlapping <path> strokes, so a translucent color
            // re-blends at every overlap (e.g. file-x's corners), leaving
            // visibly darker patches there — found and fixed during that
            // same review.
            <div className="flex h-full w-full flex-col items-center justify-center gap-2">
              <IconFileX size={28} className="text-[#aea8a0]" />
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
      </ClickableCard>
    </BookContextMenu>
  )
}
