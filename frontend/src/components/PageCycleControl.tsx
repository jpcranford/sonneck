import { IconChevronLeft, IconChevronRightFilled } from '@tabler/icons-react'

interface PageCycleControlProps {
  page: number
  pageCount: number
  onChange: (page: number) => void
}

// Card footer control (locked design system: "both card styles show a
// page-cycle control") — lets the user flip through a piece's pages right
// on its card without opening it. Renders nothing for a single-page piece,
// the common case for a standalone upload of one sheet.
export function PageCycleControl({ page, pageCount, onChange }: PageCycleControlProps) {
  if (pageCount <= 1) return null

  return (
    <div className="flex items-center gap-1 text-ink-soft">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onChange(page > 1 ? page - 1 : pageCount)
        }}
        aria-label="Previous page"
        className="flex size-6 items-center justify-center rounded hover:bg-accent-soft hover:text-accent"
      >
        <IconChevronLeft size={16} />
      </button>
      <span className="text-xs tabular-nums">
        {page} / {pageCount}
      </span>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onChange(page < pageCount ? page + 1 : 1)
        }}
        aria-label="Next page"
        className="flex size-6 items-center justify-center rounded hover:bg-accent-soft hover:text-accent"
      >
        <IconChevronRightFilled size={16} />
      </button>
    </div>
  )
}
