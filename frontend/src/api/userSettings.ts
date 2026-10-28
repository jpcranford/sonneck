import { apiGet, apiPatch } from './client'

// Mirrors internal/repo/userdata.go's UserSettings — the three
// admin-screen-visible structured preferences (User Settings' Appearance/
// Library cards).
export interface UserSettings {
  showBooksInSidebar: boolean
  themePreference: 'light' | 'dark' | 'system'
  contentViewMode: 'paginated' | 'infinite'
  // Dark Mode Scores: invert sheet-music pages while the dark theme is on.
  darkModeScores: boolean
  // The Sheet Viewer's double-turn guard: a second page turn the same way
  // within this many milliseconds is ignored; 0 is off.
  turnGuardMs: TurnGuardMs
  // The Sheet Viewer's clock, the same on every piece: shown or hidden,
  // clock or stopwatch, and the clock's seconds.
  clockShown: boolean
  clockMode: 'clock' | 'stopwatch'
  clockSeconds: boolean
  // User Settings › Sheet Viewer › Track practice: off, the viewer marks
  // nothing practiced and records nothing.
  trackPractice: boolean
  // User Settings › Sheet Viewer › Show practice notes as banner: whether
  // the notes banner shows on a piece whose banner hasn't been set.
  notesBarDefault: boolean
  // User Settings › Sheet Viewer › Show hidden colors faintly: a hidden
  // annotation color's marks stay as faint ghosts.
  ghostMarks: boolean
}

export type TurnGuardMs = 0 | 250 | 500 | 750 | 1000
export const TURN_GUARD_DEFAULT: TurnGuardMs = 500
// The User Settings choices, shortest first.
export const TURN_GUARD_OPTIONS: { value: TurnGuardMs; label: string }[] = [
  { value: 0, label: 'Off' },
  { value: 250, label: '¼ second' },
  { value: 500, label: '½ second' },
  { value: 750, label: '¾ second' },
  { value: 1000, label: '1 second' },
]

export function getUserSettings(): Promise<UserSettings> {
  return apiGet<UserSettings>('/api/user-settings')
}

// Full-replace, same convention as UpdateUserSettings server-side — always
// send the complete object (read current values, flip one field) rather
// than a partial patch.
export function updateUserSettings(settings: UserSettings): Promise<UserSettings> {
  return apiPatch<UserSettings>('/api/user-settings', settings)
}
