import { useEffect, useSyncExternalStore } from 'react'

// Light/dark theme: the choice is turned into <html data-theme="light|dark">,
// which index.css's dark block keys off. "system" follows the device and
// keeps following it while the app is open.
//
// The choice belongs to the device, not the account: it lives in this
// browser's localStorage, so a phone can stay dark while a computer stays
// light. index.html's inline script reads the same key to set the theme
// before the first paint, on every page including the login and
// first-launch screens. That script repeats resolveTheme's logic and the
// browser-bar colors below (the installed-app check too); keep the copies
// in step. The account's user_settings.theme_preference is kept only for the
// native app, which opens its window on that color before the page loads
// (AppShell copies the device's choice there; cmd/sonneck-desktop/theme.go).

export type ThemePreference = 'light' | 'dark' | 'system'

export const THEME_STORAGE_KEY = 'sonneck-theme'

// The page color in each theme (--color-paper), for the browser's own bar
// (<meta name="theme-color">) so it blends into the page.
const BROWSER_BAR_COLOR = { light: '#f8f6f3', dark: '#231e1a' } as const

// Installed as an app (Chrome's or Edge's "Install", Android's home screen:
// display-mode standalone), the bar is the app's own title or status bar,
// so it takes the sidebar's color (--color-sidebar-bg, the same in both
// themes) — the sidebar beside it on a computer, the dark top bar under it
// on a phone. Never on iPhone or iPad, where a sidebar-colored bar was
// tried and rolled back (Orion tinted its bars around the drawer's scrim).
const INSTALLED_APP_BAR_COLOR = '#0f0c0b'

function isInstalledNonIOSApp(): boolean {
  const ua = navigator.userAgent
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  return !ios && window.matchMedia('(display-mode: standalone)').matches
}

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

// The native app's window color, behind the page: the same page color, as
// RGB. cmd/sonneck-desktop/theme.go opens the window on the saved theme's
// color; this keeps it in step after a theme change (it shows while the
// window resizes), and switches the Windows title bar to match (the Mac's
// is hidden instead, lib/nativeTitleBar.ts; the call does nothing
// there). Wails injects window.runtime into the page it serves; in a
// browser it doesn't exist and none of this runs.
const WINDOW_COLOR = { light: [0xf8, 0xf6, 0xf3], dark: [0x23, 0x1e, 0x1a] } as const

export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference === 'system') return darkQuery().matches ? 'dark' : 'light'
  return preference
}

export function applyTheme(preference: ThemePreference) {
  const theme = resolveTheme(preference)
  document.documentElement.dataset.theme = theme
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      'content',
      isInstalledNonIOSApp() ? INSTALLED_APP_BAR_COLOR : BROWSER_BAR_COLOR[theme],
    )
  const [r, g, b] = WINDOW_COLOR[theme]
  window.runtime?.WindowSetBackgroundColour?.(r, g, b, 255)
  if (theme === 'dark') window.runtime?.WindowSetDarkTheme?.()
  else window.runtime?.WindowSetLightTheme?.()
}

function readStoredTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // Storage unavailable (private browsing): follow the device.
  }
  return 'system'
}

let currentTheme = readStoredTheme()
const themeListeners = new Set<() => void>()

function subscribeTheme(listener: () => void) {
  themeListeners.add(listener)
  // Another tab changed it: follow along.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return
    currentTheme = readStoredTheme()
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    themeListeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** This device's light/dark/system choice. */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribeTheme, () => currentTheme)
}

export function setThemePreference(preference: ThemePreference) {
  currentTheme = preference
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Storage unavailable: the theme still applies until the page reloads.
  }
  themeListeners.forEach((listener) => listener())
}

// Keeps <html data-theme> in step with this device's choice, and with the
// device's own setting while that choice is "system".
export function useThemeSync() {
  const preference = useThemePreference()
  useEffect(() => {
    applyTheme(preference)
    if (preference !== 'system') return
    const query = darkQuery()
    const onChange = () => applyTheme('system')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [preference])
}

// Dark Mode Scores (user_settings.dark_mode_scores, User Settings ›
// Appearance): sets <html data-dark-scores> while on. index.css inverts
// every sheet-music page image (class score-page) under that flag, and only
// while the dark theme is on, so the setting does nothing in light. Cached
// in localStorage like the theme so index.html's inline script can set it
// before the first paint.
export const DARK_SCORES_STORAGE_KEY = 'sonneck-dark-scores'

export function useDarkScoresSync(enabled: boolean | undefined) {
  useEffect(() => {
    if (enabled === undefined) return
    const root = document.documentElement
    if (enabled) root.dataset.darkScores = ''
    else delete root.dataset.darkScores
    try {
      localStorage.setItem(DARK_SCORES_STORAGE_KEY, enabled ? '1' : '0')
    } catch {
      // Storage unavailable: still applies for this page.
    }
  }, [enabled])
}
