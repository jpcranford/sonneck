// How a one-finger press on the Sheet Viewer's score turns the page: a tap
// by where it lands, a swipe by which way it goes. Shared by the real viewer
// and its mockup.

export interface StagePoint {
  x: number
  y: number
  /** performance.now() when the point was recorded. */
  t: number
}

export interface StageRect {
  left: number
  top: number
  width: number
  height: number
}

/** A press that moves less than this is a tap. */
export const TAP_SLOP_PX = 12
/** A swipe travels at least this far… */
export const SWIPE_MIN_PX = 40
/** …within this long. */
export const SWIPE_MAX_MS = 800
/** A swipe is vertical when it goes this many times further up or down
 * than sideways; anything else is horizontal. */
export const SWIPE_AXIS_RATIO = 1.5

/**
 * -1 to turn back, 1 to turn forward, null to do nothing.
 *
 * A tap uses the side thirds: the left third goes back, the right third
 * forward, and the middle column splits top (back) from bottom (forward).
 * A swipe left turns forward and right turns back, like paging; up turns
 * forward and down back, like scrolling the music. Any swipe that isn't
 * mostly vertical goes by its horizontal part, diagonals included. A press
 * that moves too little to be a swipe, or too slowly, does nothing — it was
 * neither.
 */
export function stageTurn(start: StagePoint, end: StagePoint, rect: StageRect): -1 | 1 | null {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (Math.hypot(dx, dy) <= TAP_SLOP_PX) {
    const x = (end.x - rect.left) / rect.width
    const y = (end.y - rect.top) / rect.height
    return x < 1 / 3 ? -1 : x > 2 / 3 ? 1 : y < 0.5 ? -1 : 1
  }
  if (end.t - start.t > SWIPE_MAX_MS) return null
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (ay >= SWIPE_MIN_PX && ay >= ax * SWIPE_AXIS_RATIO) return dy < 0 ? 1 : -1
  if (Math.hypot(dx, dy) >= SWIPE_MIN_PX) return dx < 0 ? 1 : -1
  return null
}
