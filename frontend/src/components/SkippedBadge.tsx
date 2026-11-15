import { IconEyeOff } from '@tabler/icons-react'

/** Marks a page Manage Pages skips (the Sheet Viewer and the Set PDF leave
 * it out) on Piece Details' preview and its enlarged view; the page itself
 * stays at full strength there. Copied on /mockup/piece-details. */
export function SkippedBadge({ className = '' }: { className?: string }) {
  return (
    <span
      title="Skipped in the Sheet Viewer"
      className={`pointer-events-none flex items-center gap-1 rounded-full bg-scrim/80 px-2 py-1 text-xs text-white/90 shadow-md backdrop-blur-sm ${className}`}
    >
      <IconEyeOff size={13} />
      Skipped
    </span>
  )
}
