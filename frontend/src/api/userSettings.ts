import { apiGet, apiPatch } from './client'

// Mirrors internal/repo/userdata.go's UserSettings — the three
// admin-screen-visible structured preferences (User Settings' Appearance/
// Library cards, master plan Phase 12).
export interface UserSettings {
  showBooksInSidebar: boolean
  themePreference: 'light' | 'dark' | 'system'
  contentViewMode: 'paginated' | 'infinite'
}

export function getUserSettings(): Promise<UserSettings> {
  return apiGet<UserSettings>('/api/user-settings')
}

// Full-replace, same convention as UpdateUserSettings server-side — always
// send the complete object (read current values, flip one field) rather
// than a partial patch.
export function updateUserSettings(settings: UserSettings): Promise<UserSettings> {
  return apiPatch<UserSettings>('/api/user-settings', settings)
}
