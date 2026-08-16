import { IconMusic } from '@tabler/icons-react'
import type { Tag } from '../api/types'

interface TagPillsProps {
  musicalKey: Tag | null
  userTags: Tag[]
}

// Card footer pills (locked design system). Key and user tags are both
// pills but never distinguished by color alone (CLAUDE.md > Frontend) — key
// gets a music-note icon and an outline treatment, tags stay text-only on a
// soft fill, so the difference reads even without color.
export function TagPills({ musicalKey, userTags }: TagPillsProps) {
  if (!musicalKey && userTags.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1">
      {musicalKey && (
        <span className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-ink-soft">
          <IconMusic size={11} />
          {musicalKey.name}
        </span>
      )}
      {userTags.map((tag) => (
        <span key={tag.id} className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
          {tag.name}
        </span>
      ))}
    </div>
  )
}
