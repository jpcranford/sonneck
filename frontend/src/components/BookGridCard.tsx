import { useEffect, useState } from 'react'
import { IconFile, IconFileX } from '@tabler/icons-react'
import { getBookCoverUrl } from '../api/books'
import type { Book } from '../api/types'
import { formatBookMeta } from '../lib/formatBookMeta'
import { BookContextMenu } from './BookContextMenu'
import { ClickableCard } from './ClickableCard'

interface BookGridCardProps {
  book: Book
}

// Cover sizes to the book's own image aspect ratio (direct instruction,
// 2026-08-27) — this card used to force every cover into a uniform
// portrait 2:3 crop, deliberately, so the grid read as a poster wall
// rather than a scanned-page gallery. That's been reversed: aspect-[2/3]
// now only reserves space while the real image is loading (dropped the
// instant onLoad fires, same technique BookDetailsPage.tsx's own header
// cover uses), so cards in the same row can end up different heights once
// their images load — that's the accepted tradeoff of matching each
// book's real shape instead of a uniform poster grid.
//
// Piece count sits in the bottom-right corner on its own dark pill, not a
// full-width gradient scrim across the cover — chosen from a 5-option
// comparison (solid pill, rounded-rect, frosted glass, opaque brand-ink,
// and a light counterpoint pill) against real colorful/photographic
// covers, after an earlier scrim-based version (bumped from 10% to 18% to
// 65% peak opacity trying to hold up against lighter covers) kept reading
// as either too faint or too heavy-handed against the cover art. The
// pill's own background does the contrast work now, so the cover
// underneath stays untouched.
export function BookGridCard({ book }: BookGridCardProps) {
  const meta = formatBookMeta(book)
  // hasCustomCover and fileHash are two independent sources a cover can
  // come from — getBookCoverUrl resolves which one server-side, so this
  // only needs to know whether *either* exists, not which.
  const coverSource =
    book.hasCustomCover || book.fileHash ? (book.coverImageHash ?? book.fileHash) : null
  const [coverLoaded, setCoverLoaded] = useState(false)
  useEffect(() => {
    setCoverLoaded(false)
  }, [coverSource])

  return (
    // Right-click (desktop) + long-press (touch) via ContextMenu's own
    // built-in handling, no visible "⋯" trigger — same convention as
    // PieceGridCard: a permanently-visible button on every card in a
    // dense grid reads as clutter.
    <BookContextMenu book={book} hideTriggerButton>
      {/* justify-end + h-full: covers no longer share a uniform height
          (see the aspect-ratio comment above), and the grid container's
          default align-items: stretch means every card already fills its
          row's full height — but that stretch lands on ContextMenu's own
          wrapper div (the actual grid item; ClickableCard's <a> is nested
          a level deeper inside it), not on this <a> directly, since a
          plain block div doesn't pass its stretched height down to a
          child on its own. h-full makes this <a> actually fill that
          already-stretched parent; justify-end then pushes the
          cover+text group to the bottom of it. Without both, a
          shorter/landscape cover's title would float right underneath it,
          staggered against taller cards in the same row, instead of every
          cover bottom-aligning along the row's tallest one with each
          card's own title sitting immediately under its own cover either
          way — a bookshelf-style row, not a ragged one. */}
      <ClickableCard
        to={`/books/${book.id}`}
        className="flex h-full flex-col justify-end gap-2 text-left"
      >
        <div
          className={`relative overflow-hidden rounded-md border border-border bg-paper-sunken shadow-sm transition-shadow hover:shadow-lg ${coverLoaded ? '' : 'aspect-[2/3]'}`}
        >
          {book.hasCustomCover || book.fileHash ? (
            <img
              key={coverSource}
              src={getBookCoverUrl(book.id, book.coverImageHash ?? book.fileHash)}
              onLoad={() => setCoverLoaded(true)}
              alt=""
              loading="lazy"
              className={coverLoaded ? 'block h-auto w-full' : 'invisible h-full w-full'}
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
        {/* min-h-[58px] pins this block to a constant height (2-line
            title, line-clamp-2's own max, at 20px/line + gap-0.5's 2px +
            one meta line at 16px = 58px, confirmed via computed styles)
            regardless of whether the actual title wraps to 1 or 2 lines,
            or whether meta renders at all. Without it, justify-end above
            packs the cover+text group to the bottom of the stretched
            card by that group's own *total* height — so a 1-line-title
            card's group is shorter than a 2-line one, and its cover ends
            up sitting lower (bottom NOT aligned with the taller card's
            cover) even though both covers are meant to share the same
            bottom edge. Pinning this block's height to the max case makes
            every card's group height (and therefore the cover's bottom
            position) the same, regardless of actual title length. */}
        <div className="flex min-h-[58px] flex-col gap-0.5">
          <p className="line-clamp-2 font-display text-sm font-medium text-ink">{book.bookTitle}</p>
          {meta && <p className="truncate text-xs text-ink-soft">{meta}</p>}
        </div>
      </ClickableCard>
    </BookContextMenu>
  )
}
