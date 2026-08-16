import { IconMusic } from '@tabler/icons-react'
import type { Tag } from '../api/types'

interface TagPillsProps {
  musicalKey: Tag | null
  sheetType: Tag | null
  instruments: Tag[]
  userTags: Tag[]
}

// Card footer pills (locked design system), fixed order: user tags, key(s),
// sheet type, instruments — matches the Piece View's locked pill line
// (design doc §14: practice status, user tags, key, sheet type; instruments
// moved into that page's details list). Cards have no practice-status pill,
// so user tags lead here. Color is reserved for genuinely user-specific
// data (`userTags`, user-authored) — key/sheetType/instruments are
// system/book-level data, so they stay neutral hollow pills, never
// distinguished by color alone anyway (CLAUDE.md > Frontend) since key
// also carries a music-note icon.
export function TagPills({ musicalKey, sheetType, instruments, userTags }: TagPillsProps) {
  if (!musicalKey && !sheetType && instruments.length === 0 && userTags.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1">
      {userTags.map((tag) => (
        <span key={tag.id} className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
          {tag.name}
        </span>
      ))}
      {musicalKey && (
        <span className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-ink-soft">
          <IconMusic size={11} />
          {musicalKey.name}
        </span>
      )}
      {sheetType && (
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-ink-soft">
          {sheetType.name}
        </span>
      )}
      {instruments.map((tag) => (
        <span
          key={tag.id}
          className="rounded-full border border-border px-2 py-0.5 text-xs text-ink-soft"
        >
          {tag.name}
        </span>
      ))}
    </div>
  )
}
