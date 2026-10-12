import { useEffect, useRef, useSyncExternalStore } from 'react'
import { isAnyModalOpen } from '../components/Modal'
import { isMultilineField } from './multilineField'

// The app's keyboard shortcuts — one document listener (installShortcuts,
// main.tsx) and a registry pages add to with useShortcuts, so every
// shortcut follows the same rules and the shortcut help
// (components/ShortcutHelp.tsx) can list what's live on the current page.
//
// A shortcut fires only with no ⌘/Ctrl/Alt held, not on a held key's
// repeats, never while typing in a field, and never while something sits
// on top of the page: a window (Modal), or anything holding
// useShortcutBlocker (the page viewer, drawers, open menus).
//
// `/` and `?` open the shortcut help when held for HOLD_MS; it closes when
// the key is let go. A quick tap of `/` (released sooner) runs the page's
// '/' shortcut instead (jump to search).

export interface Shortcut {
  /** The key as typed: a lowercase letter, a digit, or '/'. A letter never
   * matches with Shift held. */
  key: string
  /** What it does, for the shortcut help. */
  label: string
  run: () => void
  /** False when the viewer can't do this (no permission, nothing to act
   * on): pressing it does nothing, like the matching faded button, and the
   * shortcut help leaves it off. */
  enabled?: boolean
}

/** A row the shortcut help lists for reference only — an edit window's
 * keys, which that window handles itself. */
export interface ReferenceRow {
  keys: string[]
  label: string
}

export interface ShortcutOptions {
  /** The page's name in the shortcut help ("Piece Details"). */
  title?: string
  /** The sidebar's number keys — the help folds them into one line. */
  sidebar?: boolean
  /** Keys listed for reference under their own heading. */
  reference?: { title: string; rows: ReferenceRow[] }
}

export const HOLD_MS = 1000
/** The "Keep holding" pill waits this long into a hold of / — a tap of /
 * is a shortcut (search), so a quick tap never flashes it. A ? hold shows
 * it at once. */
export const PILL_DELAY_MS = 100

/** Each edit window's own keys, for its page's `reference`. */
export const EDIT_PIECE_KEYS: ReferenceRow[] = [
  { keys: ['Enter'], label: 'Save' },
  { keys: ['Shift', 'Enter'], label: 'Save & close' },
  { keys: ['←', '→'], label: 'Previous / next piece' },
  { keys: ['Esc'], label: 'Close' },
]
export const EDIT_WINDOW_KEYS: ReferenceRow[] = [
  { keys: ['Shift', 'Enter'], label: 'Save' },
  { keys: ['Esc'], label: 'Close' },
]

interface Registration {
  shortcuts: Shortcut[]
  options: ShortcutOptions
}
interface Entry {
  id: number
  current: () => Registration
}

let entries: Entry[] = []
let nextId = 0
let blockers = 0

/** What's registered now, oldest first (the app-wide ones, then the page's). */
export function shortcutRegistrations(): Registration[] {
  return entries.map((entry) => entry.current())
}

function find(key: string): Shortcut | undefined {
  // The latest registration wins — a page's own over the app-wide ones.
  return [...entries]
    .reverse()
    .flatMap((entry) => entry.current().shortcuts)
    .find((s) => s.key === key)
}

/** Registers `shortcuts` while the calling component is mounted. Pass a
 * fresh list every render; the latest one is always the one used. */
export function useShortcuts(shortcuts: Shortcut[], options: ShortcutOptions = {}) {
  const ref = useRef<Registration>({ shortcuts, options })
  useEffect(() => {
    ref.current = { shortcuts, options }
  })
  useEffect(() => {
    const entry: Entry = { id: nextId++, current: () => ref.current }
    entries.push(entry)
    return () => {
      entries = entries.filter((e) => e.id !== entry.id)
    }
  }, [])
}

/** Pauses page shortcuts (and the shortcut help) while `active` — for
 * things that open over the page without being a Modal. */
export function useShortcutBlocker(active: boolean) {
  useEffect(() => {
    if (!active) return
    blockers++
    return () => {
      blockers--
    }
  }, [active])
}

// The hold: which key is down, since when, and whether the help is showing.
export interface Hold {
  key: '/' | '?'
  shown: boolean
}
let hold: Hold | null = null
let holdStartedAt = 0
let holdTimer: number | undefined
const holdListeners = new Set<() => void>()

function setHold(next: Hold | null) {
  hold = next
  holdListeners.forEach((listener) => listener())
}

/** The current hold of / or ?, for the shortcut help to draw. */
export function useShortcutHold(): Hold | null {
  return useSyncExternalStore(
    (listener) => {
      holdListeners.add(listener)
      return () => holdListeners.delete(listener)
    },
    () => hold,
  )
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (isMultilineField(target) || target.tagName === 'SELECT') return true
  if (target.tagName !== 'INPUT') return false
  const type = (target as HTMLInputElement).type
  return type !== 'checkbox' && type !== 'radio'
}

function blocked(event: KeyboardEvent): boolean {
  return (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    isTypingTarget(event.target) ||
    blockers > 0 ||
    isAnyModalOpen()
  )
}

function run(shortcut: Shortcut | undefined, event: KeyboardEvent): void {
  if (!shortcut) return
  event.preventDefault()
  if (shortcut.enabled !== false) shortcut.run()
}

function endHold(): number {
  window.clearTimeout(holdTimer)
  const held = performance.now() - holdStartedAt
  if (hold) setHold(null)
  return held
}

export function installShortcuts() {
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || blocked(event)) return
    if (event.key === '/' || event.key === '?') {
      // Claimed even on a page without search, so Firefox's quick find
      // never opens over the app.
      event.preventDefault()
      if (event.repeat || hold) return
      const key = event.key
      holdStartedAt = performance.now()
      setHold({ key, shown: false })
      holdTimer = window.setTimeout(() => setHold({ key, shown: true }), HOLD_MS)
      return
    }
    if (event.repeat || event.shiftKey) return
    run(find(event.key.toLowerCase()), event)
  })
  document.addEventListener('keyup', (event) => {
    if (!hold) return
    // Letting go of Shift ends a ? hold too.
    if (event.key !== '/' && event.key !== '?' && !(event.key === 'Shift' && hold.key === '?'))
      return
    const wasSlash = hold.key === '/'
    const held = endHold()
    if (wasSlash && event.key === '/' && held < HOLD_MS) run(find('/'), event)
  })
  window.addEventListener('blur', () => endHold())
}
