import { IconFile, IconFileX } from '@tabler/icons-react'
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
// recognizably the same card-grid pattern. Piece count sits in the
// bottom-right corner on its own dark pill, not a full-width gradient
// scrim across the cover — chosen from a 5-option comparison (solid pill,
// rounded-rect, frosted glass, opaque brand-ink, and a light counterpoint
// pill) against real colorful/photographic covers, after an earlier
// scrim-based version (bumped from 10% to 18% to 65% peak opacity trying
// to hold up against lighter covers) kept reading as either too faint or
// too heavy-handed against the cover art. The pill's own background does
// the contrast work now, so the cover underneath stays untouched.
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
          <span className="absolute right-2 bottom-1.5 flex items-center gap-1 rounded-full bg-[rgba(28,24,21,0.82)] px-[7px] py-[2px] text-[0.7rem] font-semibold text-white">
            {book.pieceCount}
            <IconFile size={10} />
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
