import { useEffect } from 'react'

// Light/dark theme: the user's choice (user_settings.theme_preference) is
// turned into <html data-theme="light|dark">, which index.css's dark block
// keys off. "system" follows the device and keeps following it while the
// app is open.
//
// The choice is also kept in localStorage so index.html's inline script can
// set the right theme before the first paint, on every page including the
// login and first-launch screens, which load before the user's settings
// can be fetched. That script repeats resolveTheme's logic and the two
// browser-bar colors below; keep the copies in step.

export type ThemePreference = 'light' | 'dark' | 'system'

export const THEME_STORAGE_KEY = 'sonneck-theme'

// The page color in each theme (--color-paper), for the browser's own bar
// (<meta name="theme-color">) so it blends into the page.
const BROWSER_BAR_COLOR = { light: '#f8f6f3', dark: '#231e1a' } as const

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

// The native app's window color, behind the page: the same page color, as
// RGB. cmd/sonneck-desktop/theme.go opens the window on the saved theme's
// color; this keeps it in step after a theme change (it shows while the
// window resizes). Wails injects window.runtime into the page it serves;
// in a browser it doesn't exist and this does nothing.
const WINDOW_COLOR = { light: [0xf8, 0xf6, 0xf3], dark: [0x23, 0x1e, 0x1a] } as const

declare global {
  interface Window {
    runtime?: {
      WindowSetBackgroundColour?: (r: number, g: number, b: number, a: number) => void
    }
  }
}

export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference === 'system') return darkQuery().matches ? 'dark' : 'light'
  return preference
}

export function applyTheme(preference: ThemePreference) {
  const theme = resolveTheme(preference)
  document.documentElement.dataset.theme = theme
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', BROWSER_BAR_COLOR[theme])
  const [r, g, b] = WINDOW_COLOR[theme]
  window.runtime?.WindowSetBackgroundColour?.(r, g, b, 255)
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Storage can be unavailable (private browsing); the theme still applies
    // for this page, only the next first paint falls back to the device.
  }
}

// Keeps <html data-theme> in step with the user's saved preference, and with
// the device while that preference is "system".
export function useThemeSync(preference: ThemePreference | undefined) {
  useEffect(() => {
    if (!preference) return
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
