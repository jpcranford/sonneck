import {
  IconLayoutGrid,
  IconLayoutGridFilled,
  IconLayoutList,
  IconLayoutListFilled,
} from '@tabler/icons-react'

export type ViewMode = 'grid' | 'list'

/**
 * The grid/list switch (library toolbars, Book and Person Details): a white
 * 38px frame like the toolbar's Filters and Sort, with the chosen view a
 * rounded thumb inside it — its icon filled, the other view's outline and
 * fainter (design D, picked from a side-by-side). Mockups carry their own
 * copy of this markup.
 */
export function ViewModeToggle({
  value,
  onChange,
  className = '',
}: {
  value: ViewMode
  onChange: (mode: ViewMode) => void
  className?: string
}) {
  const options = [
    { mode: 'grid', label: 'Grid view', Icon: IconLayoutGrid, SelectedIcon: IconLayoutGridFilled },
    { mode: 'list', label: 'List view', Icon: IconLayoutList, SelectedIcon: IconLayoutListFilled },
  ] as const
  return (
    <div
      className={`flex h-[38px] shrink-0 items-center gap-0.5 rounded-md border border-border bg-paper-raised p-[3px] ${className}`}
    >
      {options.map(({ mode, label, Icon, SelectedIcon }) => {
        const selected = value === mode
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            aria-label={label}
            aria-pressed={selected}
            className={`flex h-full w-8 cursor-pointer items-center justify-center rounded ${
              selected ? 'bg-paper-hover text-ink' : 'text-ink-faint hover:text-ink'
            }`}
          >
            {selected ? <SelectedIcon size={16} /> : <Icon size={16} />}
          </button>
        )
      })}
    </div>
  )
}
