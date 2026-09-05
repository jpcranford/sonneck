import { useState, type KeyboardEvent } from 'react'
import { IconArrowDown, IconArrowUp, IconChevronDown } from '@tabler/icons-react'

export type SortDirection = 'asc' | 'desc'

export interface SortFieldOption<Field extends string> {
  value: Field
  label: string
}

// One fused, segmented button — shared by the Piece and Books libraries
// (real build of PieceLibrarySample.tsx/BooksLibrarySample.tsx's own
// SortControl, ported once here since the two mockups' versions were
// structurally identical, just different field lists — unlike the
// mockup-vs-real convention, which deliberately duplicates, two *real*
// pages sharing one real interactive component is this app's normal
// pattern, same as TagPills/PageCycleControl). Same shared-pill structure
// as Piece Details' own Download PDF split button (PiecePage.tsx): a
// div.flex.overflow-hidden.rounded-md wrapping two segments joined by a
// border-l divider. Roles are the reverse of Download PDF's, per direct
// instruction: there the text segment is the primary action and the icon
// opens a menu of alternatives; here the text segment (the field name)
// opens the menu, since field is the choice with more than two options —
// the one that actually needs a listbox — while the icon segment is a
// plain, no-menu toggle button, since direction is only ever two states.
export function SortControl<Field extends string>({
  fields,
  field,
  direction,
  onFieldChange,
  onDirectionToggle,
  directionLabel,
}: {
  fields: SortFieldOption<Field>[]
  field: Field
  direction: SortDirection
  onFieldChange: (next: Field) => void
  onDirectionToggle: () => void
  /** What "ascending"/"descending" actually means for the current field
   * (e.g. "A to Z" for Title, "Oldest first" for Date Added) — shown as
   * the icon segment's tooltip/aria-label, not a fixed up/down-only
   * description, since the same icon means something different per field. */
  directionLabel: string
}) {
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const current = fields.find((f) => f.value === field)

  function openMenu() {
    const i = fields.findIndex((f) => f.value === field)
    setHighlightedIndex(i >= 0 ? i : 0)
    setOpen(true)
  }
  function select(opt: SortFieldOption<Field>) {
    onFieldChange(opt.value)
    setOpen(false)
  }
  // Field segment's own keyboard nav — same pattern as SingleSelect.tsx
  // (ArrowUp/Down opens seeded at the current value or cycles the
  // highlighted row with wrap, Enter/Space picks it), per this app's
  // standing dropdown-keyboard-nav rule (CLAUDE.md > Frontend). The
  // direction segment doesn't need an equivalent — it's a plain <button>,
  // which already gets Space/Enter activation for free, the same reason a
  // real listbox needs this handling and a binary toggle doesn't.
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) openMenu()
      else setHighlightedIndex((i) => (i + 1) % fields.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) openMenu()
      else setHighlightedIndex((i) => (i - 1 + fields.length) % fields.length)
    } else if ((event.key === 'Enter' && !event.shiftKey) || event.key === ' ') {
      if (open) {
        event.preventDefault()
        select(fields[highlightedIndex])
      }
    } else if (event.key === 'Escape' && open) {
      setOpen(false)
    }
  }

  return (
    <div className="relative shrink-0">
      <div className="flex overflow-hidden rounded-md border border-border bg-paper-raised">
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : openMenu())}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-sm text-ink hover:bg-paper-sunken"
        >
          {current?.label ?? field}
          <IconChevronDown size={14} className="text-[#9d9892]" />
        </button>
        <button
          type="button"
          onClick={onDirectionToggle}
          aria-label={`Sort direction: ${directionLabel}. Click to reverse.`}
          title={directionLabel}
          className="flex cursor-pointer items-center justify-center border-l border-border px-2.5 py-2 text-ink hover:bg-paper-sunken"
        >
          {direction === 'asc' ? <IconArrowUp size={16} /> : <IconArrowDown size={16} />}
        </button>
      </div>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-full min-w-[150px] overflow-hidden rounded-md border border-border bg-paper-raised py-1 shadow-lg">
          {fields.map((opt, index) => (
            <button
              key={opt.value}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(opt)}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-accent-soft ${
                opt.value === field ? 'text-accent' : 'text-ink'
              } ${index === highlightedIndex ? 'bg-accent-soft' : ''}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
