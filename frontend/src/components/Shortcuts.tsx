import { useShortcuts, type Shortcut, type ShortcutOptions } from '../lib/shortcuts'

// Registers keyboard shortcuts from markup — for a large component (the
// Sheet Viewer) whose shortcut actions call functions declared further down
// or read the time: handed to a hook in its own body, the React compiler
// treats them as render-time code; handed down as props, like an onClick,
// they're event handlers.
export function Shortcuts({
  shortcuts,
  options,
}: {
  shortcuts: Shortcut[]
  options?: ShortcutOptions
}) {
  useShortcuts(shortcuts, options)
  return null
}
