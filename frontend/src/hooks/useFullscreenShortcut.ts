import { canFullscreen, toggleFullscreen } from '../lib/fullscreen'
import { useShortcuts } from '../lib/shortcuts'

/** F opens or closes true full screen on every page in the app (the
 * whole document, so it carries across pages and into the Sheet Viewer,
 * whose own F toggles the same state). Inert, and off the shortcut help,
 * where the browser can't (iPhone Safari). Rendered once, in AppShell. */
export function useFullscreenShortcut() {
  useShortcuts(
    [
      {
        key: 'f',
        label: 'Full screen',
        run: () => void toggleFullscreen().catch(() => {}),
        enabled: canFullscreen(),
      },
    ],
    { global: true },
  )
}
