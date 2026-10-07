import type { MouseEvent } from 'react'

// The macOS desktop app hides its title bar (cmd/sonneck-desktop/main.go's
// TitleBarHiddenInset): the page runs to the top edge and the traffic
// lights float over it, so the window's light/dark title bar can't clash
// with Sonneck's theme. index.html sets <html data-native-titlebar> there
// (Wails injects window.runtime; the user agent says Mac), and index.css
// turns that into --titlebar-inset (the band's height) and --titlebar-lights
// (the room the traffic lights take from the left edge). Pages still start
// at the top: only what would sit under the lights moves — the sidebar's
// top row already leaves that corner empty, the collapsed rail and the
// narrow-window top bar make room. In a browser, or the Windows app, which
// keeps its native frame, both are 0 and nothing changes.

declare global {
  interface Window {
    runtime?: {
      WindowSetBackgroundColour?: (r: number, g: number, b: number, a: number) => void
      WindowSetDarkTheme?: () => void
      WindowSetLightTheme?: () => void
      WindowToggleMaximise?: () => void
    }
  }
}

export const hasNativeTitleBar = () => document.documentElement.dataset.nativeTitlebar !== undefined

// Where a click-and-drag moves the window (Wails reads --wails-draggable on
// whatever was pressed, and it inherits, so a control inside a drag region
// opts out with noDragRegion) and a double-click zooms it, as the real
// title bar did. Inside the app: the sidebar's top row and the narrow
// window's top bar. Inert in a browser.
export const dragRegion = '[--wails-draggable:drag]'
export const noDragRegion = '[--wails-draggable:no-drag]'

export function zoomOnDoubleClick(event: MouseEvent<HTMLElement>) {
  if (event.target === event.currentTarget) window.runtime?.WindowToggleMaximise?.()
}
