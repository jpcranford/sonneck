import { IconChevronLeft, IconChevronRightFilled } from '@tabler/icons-react'

interface PageCycleControlProps {
  page: number
  pageCount: number
  onChange: (page: number) => void
}

// Card footer control, shared by both card styles — lets the user flip
// through a piece's pages right
// on its card without opening it. Renders nothing for a single-page piece,
// the common case for a standalone upload of one sheet. Stops and greys
// out at the first/last page rather than wrapping around — wrapping
// silently past the end reads as a bug, not a feature.
export function PageCycleControl({ page, pageCount, onChange }: PageCycleControlProps) {
  if (pageCount <= 1) return null

  return (
    <div className="flex items-center gap-1 text-ink-soft">
      <button
        type="button"
        onClick={(event) => {
          // preventDefault, not just stopPropagation: PieceListCard nests
          // this control inside the card's own <Link> (a real <a> —
          // ClickableCard). stopPropagation alone stops React from ever
          // calling Link's own onClick — but Link's onClick is what
          // normally calls preventDefault() to swap in client-side
          // routing, so skipping it left the browser's native anchor
          // navigation to fire unimpeded, sending a page-cycle click
          // straight to the piece page. Harmless here regardless of
          // nesting context — a plain type="button" has no default action
          // worth preserving.
          event.preventDefault()
          event.stopPropagation()
          if (page > 1) onChange(page - 1)
        }}
        disabled={page <= 1}
        aria-label="Previous page"
        className="flex size-6 cursor-pointer items-center justify-center rounded hover:bg-accent-soft hover:text-accent disabled:pointer-events-none disabled:opacity-30"
      >
        <IconChevronLeft size={16} />
      </button>
      <span className="text-xs tabular-nums">
        {page} / {pageCount}
      </span>
      <button
        type="button"
        onClick={(event) => {
          // See the Previous button's own comment above for why this needs
          // preventDefault, not just stopPropagation.
          event.preventDefault()
          event.stopPropagation()
          if (page < pageCount) onChange(page + 1)
        }}
        disabled={page >= pageCount}
        aria-label="Next page"
        className="flex size-6 cursor-pointer items-center justify-center rounded hover:bg-accent-soft hover:text-accent disabled:pointer-events-none disabled:opacity-30"
      >
        <IconChevronRightFilled size={16} />
      </button>
    </div>
  )
}
