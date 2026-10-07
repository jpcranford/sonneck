import { dragRegion, hasNativeTitleBar, zoomOnDoubleClick } from '../lib/nativeTitleBar'

// The drag band for screens outside the app (sign-in, first launch, auth
// change), which have no sidebar: fixed across the top, under any window.
// index.css hides it while AppShell is on screen, whose own regions take over.
export function TitleBarDragStrip() {
  if (!hasNativeTitleBar()) return null
  return (
    <div
      aria-hidden="true"
      onDoubleClick={zoomOnDoubleClick}
      className={`titlebar-drag-strip fixed inset-x-0 top-0 z-40 h-[var(--titlebar-inset)] ${dragRegion}`}
    />
  )
}
