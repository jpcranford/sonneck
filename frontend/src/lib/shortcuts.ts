import { useEffect, useRef } from 'react'
import { isAnyModalOpen } from '../components/Modal'
import { isMultilineField } from './multilineField'

// The app's keyboard shortcuts — one document listener (installShortcuts,
// main.tsx) and a registry pages add to with useShortcuts, so every
// shortcut follows the same rules and the help list (hold / or ?) can show
// what's live on the current page.
//
// A shortcut fires only with no ⌘/Ctrl/Alt held, not on a held key's
// repeats, never while typing in a field, and never while something sits
// on top of the page: a window (Modal), or anything holding
// useShortcutBlocker (the page viewer, drawers, open menus).
//
// `/` is special: a quick tap runs the page's '/' shortcut (jump to
// search); holding it is reserved for the shortcut help, so a tap only
// counts if released within SLASH_HOLD_MS.

export interface Shortcut {
  /** The key as typed: a lowercase letter, a digit, or '/'. A letter never
   * matches with Shift held. */
  key: string
  /** What it does, for the help list. */
  label: string
  run: () => void
  /** False when the viewer can't do this (no permission, nothing to act
   * on): pressing it does nothing, like the matching faded button. */
  enabled?: boolean
}

export const SLASH_HOLD_MS = 1000

interface Entry {
  id: number
  current: () => Shortcut[]
}

let entries: Entry[] = []
let nextId = 0
let blockers = 0
let slashDownAt: number | null = null

/** Every registered shortcut, the latest registration first (a page's own
 * before the app-wide ones). */
export function activeShortcuts(): Shortcut[] {
  return [...entries].reverse().flatMap((entry) => entry.current())
}

function find(key: string): Shortcut | undefined {
  return activeShortcuts().find((s) => s.key === key)
}

/** Registers `shortcuts` while the calling component is mounted. Pass a
 * fresh list every render; the latest one is always the one used. */
export function useShortcuts(shortcuts: Shortcut[]) {
  const ref = useRef(shortcuts)
  useEffect(() => {
    ref.current = shortcuts
  })
  useEffect(() => {
    const entry: Entry = { id: nextId++, current: () => ref.current }
    entries.push(entry)
    return () => {
      entries = entries.filter((e) => e.id !== entry.id)
    }
  }, [])
}

/** Pauses page shortcuts while `active` — for things that open over the
 * page without being a Modal. */
export function useShortcutBlocker(active: boolean) {
  useEffect(() => {
    if (!active) return
    blockers++
    return () => {
      blockers--
    }
  }, [active])
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

export function installShortcuts() {
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || blocked(event)) return
    if (event.key === '/') {
      // Claimed even on a page without search, so Firefox's quick find
      // never opens over the app.
      event.preventDefault()
      if (!event.repeat) slashDownAt = performance.now()
      return
    }
    if (event.repeat || event.shiftKey) return
    run(find(event.key.toLowerCase()), event)
  })
  document.addEventListener('keyup', (event) => {
    if (event.key !== '/' || slashDownAt === null) return
    const held = performance.now() - slashDownAt
    slashDownAt = null
    if (held < SLASH_HOLD_MS) run(find('/'), event)
  })
}
