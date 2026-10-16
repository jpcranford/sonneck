// A setlist's running time, for Setlist Details (and its mockups). The Go
// copy — internal/setlistduration, behind the setlist API's
// totalDurationSeconds/durationEstimated (Setlists Library cards) and the
// Set PDF — must stay in step with this one.
// Entries without a duration are assumed to take a typical length — 150
// seconds for music (a piece, or a custom entry counted as music), 90 for
// anything else (a reading, an announcement) — so a program with gaps
// still gets a usable total. When any length was assumed the total is
// labeled an estimate ("Est.", "~", "estimated") rather than an
// approximation.

export const ASSUMED_MUSIC_SECONDS = 150
export const ASSUMED_ENTRY_SECONDS = 90

export interface EstimateEntry {
  isMusic: boolean
  durationSeconds: number | null | undefined
}

export interface DurationEstimate {
  seconds: number
  /** True when at least one entry's length was assumed. */
  estimated: boolean
}

export function estimateTotal(entries: EstimateEntry[]): DurationEstimate {
  let seconds = 0
  let estimated = false
  for (const e of entries) {
    if (e.durationSeconds == null) {
      estimated = true
      seconds += e.isMusic ? ASSUMED_MUSIC_SECONDS : ASSUMED_ENTRY_SECONDS
    } else {
      seconds += e.durationSeconds
    }
  }
  return { seconds, estimated }
}
