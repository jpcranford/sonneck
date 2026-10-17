import { useSyncExternalStore } from 'react'
import { todayDateOnly } from '../lib/dateOnly'

// Today's date ("YYYY-MM-DD"), and a redraw for whatever shows something
// relative to it ("in 2 wks", "this week") when the date changes. Labels
// like those were worked out at draw time only, so a page left open
// across midnight — data unchanged, so nothing else redrew it — kept
// yesterday's wording. Checked when the app comes back into view and once
// at the next local midnight (one timer per day, re-armed after it fires),
// never on a ticking interval.
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined

function notify() {
  listeners.forEach((listener) => listener())
}

function armMidnight() {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1)
  timer = setTimeout(() => {
    notify()
    armMidnight()
  }, next.getTime() - now.getTime())
}

function onVisible() {
  if (document.visibilityState === 'visible') notify()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    armMidnight()
    document.addEventListener('visibilitychange', onVisible)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }
}

export function useToday(): string {
  // The snapshot is the date string itself, so a check that finds the same
  // day redraws nothing.
  return useSyncExternalStore(subscribe, todayDateOnly)
}
