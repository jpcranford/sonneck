// The Sheet Viewer's instruction pills ("Pen: taps mark the page") are tips:
// each shows its first TIP_SHOWS times, then stops; User Settings' "Show
// tips again" starts them over. Feedback pills ("Double-turn ignored") are
// not tips and always show.
//
// Counted in this browser's storage, per device (user, 2026-10-27): tips
// are about this device's taps and gestures, so a new device shows them
// again. The real viewer and the mockups share the count.

export const TIP_SHOWS = 3
const KEY = 'sonneck-sheet-viewer-tips'

function read(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

/** Counts one showing of the tip; false once it has shown TIP_SHOWS times. */
export function takeTip(id: string) {
  const seen = read()
  const n = seen[id] ?? 0
  if (n >= TIP_SHOWS) return false
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...seen, [id]: n + 1 }))
  } catch {
    // Storage blocked: the tip still shows, every time.
  }
  return true
}

export function resetTips() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing stored to reset.
  }
}
