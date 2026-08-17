// Shared mm:ss <-> seconds conversion for Piece.duration (stored server-side
// as an integer of seconds, shown/entered in the UI as mm:ss — CLAUDE.md >
// Frontend > Computed fields). Used by both the Piece View's read-only
// display and the Edit Piece Menu's manual duration input.

export function secondsToMMSS(seconds: number): string {
  const mm = Math.floor(seconds / 60)
  const ss = seconds % 60
  return `${mm}:${String(ss).padStart(2, '0')}`
}

const MMSS_PATTERN = /^(\d+):([0-5]\d)$/

/** Returns null for anything not in strict mm:ss form (e.g. "3:7", "abc"). */
export function mmssToSeconds(value: string): number | null {
  const match = MMSS_PATTERN.exec(value.trim())
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}
