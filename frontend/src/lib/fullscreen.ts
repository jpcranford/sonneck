// True full screen for the Sheet Viewer (its F key): the browser's own bars
// hidden, not just the app's. Safari before 16.4 only has the webkit-
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
