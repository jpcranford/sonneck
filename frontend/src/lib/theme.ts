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
const BROWSER_BAR_COLOR = { light: '#fbfaf8', dark: '#181412' } as const

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

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
