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
/** A swipe travels at least this far along its axis… */
export const SWIPE_MIN_PX = 40
/** …within this long… */
export const SWIPE_MAX_MS = 800
/** …and this many times further along it than across it. */
export const SWIPE_AXIS_RATIO = 1.5

/**
 * -1 to turn back, 1 to turn forward, null to do nothing.
 *
 * A tap uses the side thirds: the left third goes back, the right third
 * forward, and the middle column splits top (back) from bottom (forward).
 * A swipe left or down turns forward, right or up turns back.
 * A press that moves too little to be a swipe, too slowly, or diagonally
 * does nothing — it was neither.
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
  if (ax >= SWIPE_MIN_PX && ax >= ay * SWIPE_AXIS_RATIO) return dx < 0 ? 1 : -1
  if (ay >= SWIPE_MIN_PX && ay >= ax * SWIPE_AXIS_RATIO) return dy > 0 ? 1 : -1
  return null
}
