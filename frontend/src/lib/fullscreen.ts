import { isOverlayOpen, isTypingTarget } from './shortcuts'

// True full screen (F, on every page and in the Sheet Viewer): the browser's
// own bars hidden, not just the app's. Safari before 16.4 only has the webkit-
// prefixed calls; iPhone Safari has neither for a page, so `canFullscreen`
// is false there and the key says so instead.

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
  webkitFullscreenEnabled?: boolean
}
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }

export function canFullscreen(): boolean {
  const doc = document as WebkitDocument
  return !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled)
}

export function isFullscreen(): boolean {
  const doc = document as WebkitDocument
  return !!(doc.fullscreenElement || doc.webkitFullscreenElement)
}

/** Enters full screen, or leaves it if already there. */
export async function toggleFullscreen(): Promise<void> {
  const doc = document as WebkitDocument
  if (isFullscreen()) {
    await (doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.())
    return
  }
  const root = document.documentElement as WebkitElement
  await (root.requestFullscreen ? root.requestFullscreen() : root.webkitRequestFullscreen?.())
}

type KeyboardLock = { lock?: (keys: string[]) => Promise<void>; unlock?: () => void }

/** Esc in full screen closes what's open first — a window, menu, drawer,
 * a Sheet Viewer panel — and leaves full screen only when nothing is.
 *
 * A browser normally takes Esc for itself in full screen and leaves at
 * once. Chrome and Edge let a page keep it (the Keyboard Lock API, asked
 * for whenever full screen starts); there, holding Esc still leaves.
 * Safari and Firefox have no such API, so their Esc always leaves first.
 *
 * Whether anything was open is noted before any handler runs (a window's
 * own Esc handler closes it during the same press). A handler that used
 * the press for something not tracked as an overlay (the Sheet Viewer's
 * panels and Annotate steps) calls preventDefault. Esc in a text field is
 * left to the field. Installed once, in main.tsx. */
export function installFullscreenEscape() {
  const keyboard = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard
  const syncLock = () => {
    if (isFullscreen()) keyboard?.lock?.(['Escape']).catch(() => {})
    else keyboard?.unlock?.()
  }
  document.addEventListener('fullscreenchange', syncLock)
  document.addEventListener('webkitfullscreenchange', syncLock)

  let overlayAtPress = false
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') overlayAtPress = isOverlayOpen()
    },
    true,
  )
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.repeat || !isFullscreen()) return
    if (overlayAtPress || event.defaultPrevented || isTypingTarget(event.target)) return
    void toggleFullscreen().catch(() => {})
  })
}
