import { useState } from 'react'
import type { PracticeStatusItem } from '../api/types'
import { PracticeStatusKeyIcon } from './PracticeStatusIcon'

// The piece menu's practice status strip (design C′, /mockup/add-to-setlist):
// one button per status in the viewer's own list, at the top of the menu.
// One click sets a status; clicking the current one clears it. The label
// line names whichever button is hovered or focused, else the current
// status, so an icon never stands alone. A status with no icon of its own
// (one created later, with no icon_key) shows its initial instead.
export function PracticeStatusStrip({
  statuses,
  current,
  onChange,
}: {
  statuses: PracticeStatusItem[]
  current: string | null
  onChange: (status: string | null) => void
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  return (
    <div className="px-3 pt-1.5 pb-2" onMouseLeave={() => setHovered(null)}>
      <div className="mb-1.5 flex justify-between gap-3 text-xs text-ink-soft">
        <span>Practice status</span>
        <span className="truncate font-medium text-ink">{hovered ?? current ?? 'None'}</span>
      </div>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Practice status">
        {statuses.map((status) => {
          const isCurrent = current === status.name
          return (
            <button
              key={status.id}
              type="button"
              role="radio"
              aria-checked={isCurrent}
              aria-label={isCurrent ? `${status.name} (click to clear)` : status.name}
              title={isCurrent ? `${status.name} — click to clear` : status.name}
              onMouseEnter={() => setHovered(status.name)}
              onFocus={() => setHovered(status.name)}
              onBlur={() => setHovered(null)}
              onClick={() => onChange(isCurrent ? null : status.name)}
              className={`flex size-[30px] cursor-pointer items-center justify-center rounded-md border text-xs font-medium ${
                isCurrent
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border bg-paper-raised text-ink-soft hover:border-accent hover:text-ink'
              }`}
            >
              {status.iconKey ? (
                <PracticeStatusKeyIcon iconKey={status.iconKey} size={16} />
              ) : (
                status.name.slice(0, 1).toUpperCase()
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
