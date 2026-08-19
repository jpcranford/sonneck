import { IconChevronRight } from '@tabler/icons-react'
import type { Book } from '../api/types'
import { formatBookMeta } from '../lib/formatBookMeta'
import { ClickableCard } from './ClickableCard'

interface BookListCardProps {
  book: Book
}

// Books library view, locked design (2026-08-18) — Option C, "catalog
// list": no thumbnails at all, a call-number-style piece count instead of
// Pieces' tag-pills-and-page-cycler footer. Piece count sits at the end of
// the row (design review: moved from the left, reads cleaner against long
// titles) rather than as its own leading column. The trailing chevron
// always implied a destination — links to the Book Details page now that
// it exists.
export function BookListCard({ book }: BookListCardProps) {
  const meta = formatBookMeta(book)

  return (
    <ClickableCard
      to={`/books/${book.id}`}
      className="flex w-full items-center gap-5 rounded-md border-t border-border px-2 py-3 text-left first:border-t-0 hover:bg-accent-soft"
    >
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
      <IconChevronRight size={18} className="shrink-0 text-ink-soft/50" />
    </ClickableCard>
  )
}
