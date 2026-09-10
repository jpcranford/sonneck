import { useState } from 'react'

// Silent per-page grid/list view-mode memory (multi-user support master
// plan's "Frontend surfaces" note, memory project_multiuser_build.md) —
// deliberately client-side/per-device (localStorage), not account-scoped
// server state: a person's preference can legitimately differ by device
// (grid on a wide desktop monitor, list on a phone), so this doesn't
// belong in user_settings. Every page with a grid/list toggle held it as a
// plain useState before this hook existed, resetting to the default on
// every reload — this is what actually makes it stick.
//
// key must be stable and unique per page/context (e.g. "books", "people",
// "pieces:Favorites") — every caller gets its own independently-remembered
// value, so switching to list on Books doesn't also switch Favorites.
export type ViewMode = 'grid' | 'list'

function storageKey(key: string): string {
  return `sonneck:viewMode:${key}`
}

export function useViewPreference(key: string, defaultValue: ViewMode = 'grid') {
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    try {
      const stored = localStorage.getItem(storageKey(key))
      return stored === 'grid' || stored === 'list' ? stored : defaultValue
    } catch {
      // Storage unavailable (private browsing, disabled) — just fall back
      // to the default for this session, same degrade-gracefully posture
      // as lib/useWizardDraft.ts's own localStorage reads/writes.
      return defaultValue
    }
  })

  function setViewMode(next: ViewMode) {
    setViewModeState(next)
    try {
      localStorage.setItem(storageKey(key), next)
    } catch {
      // The toggle still works for the rest of this session — it just
      // won't survive a reload. Not worth surfacing as an error.
    }
  }

  return [viewMode, setViewMode] as const
}
