import { getPersonPortraitUrl } from '../api/people'
import type { Person } from '../api/types'
import { PALETTE } from '../lib/pieceSplitLogic'

// Extracted from PersonDetailsPage.tsx (2026-09-02) once EditPersonModal.tsx
// needed the exact same oval-portrait treatment for its own new left
// column — two *real* pages/components sharing one real widget is this
// codebase's normal pattern (TagPills, PageCycleControl, SortControl),
// not an exception to the mockup-vs-real "don't share code" convention,
// which only applies between a mockup and its real counterpart.
export function PersonAvatar({ person, className }: { person: Person; className: string }) {
  const color = PALETTE[person.id % PALETTE.length]
  const initials = person.name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .filter(Boolean)
  const initialsText =
    initials.length === 0 ? '?' : (initials[0] + (initials[initials.length - 1] ?? '')).toUpperCase()
  return (
    <div
      className={`relative aspect-[3/4] overflow-hidden rounded-[50%] border border-border [container-type:inline-size] ${className}`}
      style={{ backgroundColor: color }}
    >
      {person.hasCustomPortrait ? (
        <img
          src={getPersonPortraitUrl(person.id, person.portraitImageHash)}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center font-display font-medium text-white text-[26cqw]">
          {initialsText}
        </div>
      )}
    </div>
  )
}
