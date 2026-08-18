import {
  IconBan,
  IconCircleCheckFilled,
  IconCircleDashed,
  IconCircleHalf2,
  IconHourglassEmpty,
} from '@tabler/icons-react'
import type { PracticeStatus } from '../api/types'

// One icon per status (design review, 2026-08-18 — see the "Practice
// Status Icons" artifact for the full candidate comparison): an empty ->
// half -> full progression across the first three statuses, then an
// emptied hourglass for Stalled ("ran out") and a plain ban circle for
// Dropped. Centralized here so the Piece View pill and Grid card badge
// (the only two places a status renders with an icon) can't drift onto
// different icons for the same status.
const PRACTICE_STATUS_ICONS: Record<PracticeStatus, typeof IconCircleDashed> = {
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
  return <Icon size={size} className={className} />
}
