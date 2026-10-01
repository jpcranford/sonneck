import {
  IconBan,
  IconCircleCheckFilled,
  IconCircleDashed,
  IconCircleHalf2,
  IconHourglassEmpty,
} from '@tabler/icons-react'
import type { PracticeStatus, PracticeStatusItem } from '../api/types'

// One icon per *original seeded* status name: an empty -> half -> full
// progression across the first three, then an emptied hourglass for
// Stalled ("ran out") and a plain ban circle for Dropped. Centralized here
// so the Piece Details pill and Grid card badge (the only two places a
// status renders with an icon) can't drift onto different icons for the
// same status.
//
// A display-only heuristic, not an exhaustive map — Practice Status is a
// real per-user renameable/creatable table (migration 00025), and a
// piece's own `practiceStatus` is just whatever that status is currently
// named (resolved via a live join server-side); this component has no way
// to know a row's *original* name or its durable `icon_key` (migration
// 00026) the way User Settings' own list does (GET /api/practice-statuses
// returns it; GET /api/pieces doesn't carry a status's iconKey, only its
// live name). A status renamed away from one of these five simply renders
// with no icon here. Real crash fixed here: PRACTICE_STATUS_ICONS used to
// be typed Record<PracticeStatus, …> and index into it unconditionally,
// so any renamed status threw "Element type is invalid" the instant a
// piece carrying it rendered anywhere — this now degrades to "no icon",
// not a crash.
const PRACTICE_STATUS_ICONS: Record<string, typeof IconCircleDashed> = {
  'Want to Learn': IconCircleDashed,
  Learning: IconCircleHalf2,
  Learned: IconCircleCheckFilled,
  Stalled: IconHourglassEmpty,
  Dropped: IconBan,
}

export function PracticeStatusIcon({
  status,
  size,
  className,
}: {
  status: PracticeStatus
  size: number
  className?: string
}) {
  const Icon = PRACTICE_STATUS_ICONS[status]
  return Icon ? <Icon size={size} className={className} /> : null
}

// The same five icons keyed by a status's durable icon_key (migration
// 00026, carried by GET /api/practice-statuses) rather than its live name,
// so a renamed status keeps its icon — for callers that have the status
// list itself, like the piece menu's practice status strip.
const PRACTICE_STATUS_ICONS_BY_KEY: Record<string, typeof IconCircleDashed> = {
  want_to_learn: IconCircleDashed,
  learning: IconCircleHalf2,
  learned: IconCircleCheckFilled,
  stalled: IconHourglassEmpty,
  dropped: IconBan,
}

export function PracticeStatusKeyIcon({
  iconKey,
  size,
  className,
}: {
  iconKey: PracticeStatusItem['iconKey']
  size: number
  className?: string
}) {
  const Icon = iconKey ? PRACTICE_STATUS_ICONS_BY_KEY[iconKey] : undefined
  return Icon ? <Icon size={size} className={className} /> : null
}
