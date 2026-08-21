import { IconMusic } from '@tabler/icons-react'
import type { Tag } from '../api/types'

interface TagPillsProps {
  keys: Tag[]
  sheetType: Tag | null
  instruments: Tag[]
  userTags: Tag[]
  // Optional spacing above the pill row itself — passed through onto the
  // root div (which is what returns null when there's nothing to show), so
  // a caller never ends up with a dangling top margin on a piece with no
  // tags at all. Defaults to none, matching every caller before this prop
  // existed.
  className?: string
}

// Card footer pills (locked design system), fixed order: user tags, key(s),
// sheet type, instruments — matches the Piece Details page's locked pill line
// (design doc §14: practice status, user tags, key, sheet type; instruments
// moved into that page's details list). Cards have no practice-status pill,
// so user tags lead here. Color is reserved for genuinely user-specific
// data (`userTags`, user-authored) — key/sheetType/instruments are
// system/book-level data, so they stay neutral hollow pills, never
// distinguished by color alone anyway (CLAUDE.md > Frontend) since key
// also carries a music-note icon. Keys are many-to-many (a piece can be
// written in more than one key) and genuinely ordered (e.g. a piece that
// modulates) — rendered as one merged pill with the sequence joined by a
// small chevron, not one independent pill per key (2026-08-17).
export function TagPills({ keys, sheetType, instruments, userTags, className = '' }: TagPillsProps) {
  if (keys.length === 0 && !sheetType && instruments.length === 0 && userTags.length === 0) {
    return null
  }

  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-1 ${className}`}>
      {userTags.map((tag) => (
        <span
          key={tag.id}
          className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent"
        >
          {tag.name}
        </span>
      ))}
      {/* One merged pill for the whole key sequence, not one pill per key
          — a piece's keys are ordered (e.g. a piece that modulates), and a
          separate pill per key gives no indication of that order. Same
          treatment as the Piece Details page (PiecePage.tsx/PieceDetailsSample.tsx):
          neutral bordered pill, single IconMusic prefix, keys joined by a
          small de-emphasized chevron rather than shown as independent tags. */}
      {keys.length > 0 && (
        // whitespace-nowrap: without it, a long sequence (3-4 keys isn't
        // uncommon) wraps mid-pill on a narrow card — and a rounded-full
        // pill whose content wraps renders as two disjoint rounded
        // fragments (a real rendering artifact, not a design choice), not
        // one clean shape. Capped with max-w-full + truncate so a
        // pathologically long sequence on a narrow card ellipsizes
        // instead of overflowing the card, same fallback the card's own
        // title text already uses elsewhere.
        <span className="flex min-w-0 max-w-full items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium whitespace-nowrap text-ink-soft">
          <IconMusic size={11} className="shrink-0" />
          <span className="truncate">
            {keys.map((key, i) => (
              // Composite key (id + position), not just key.id — a
              // modulating piece can legitimately use the same key twice
              // in its sequence (migration 00012).
              <span key={`${key.id}-${i}`}>
                {i > 0 && (
                  <span className="font-normal opacity-[0.55]" aria-hidden="true">
                    {' '}
                    ›{' '}
                  </span>
                )}
                {key.name}
              </span>
            ))}
          </span>
        </span>
      )}
      {sheetType && (
        <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-ink-soft">
          {sheetType.name}
        </span>
      )}
      {instruments.map((tag) => (
        <span
          key={tag.id}
          className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-ink-soft"
        >
          {tag.name}
        </span>
      ))}
    </div>
  )
}
