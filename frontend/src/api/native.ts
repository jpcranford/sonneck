import { apiGet, apiPatch, apiPost } from './client'

// Native-only endpoints (project_wails_native_app_investigation memory's
// Phase 7) — 404 on a Docker build, server-side (internal/handlers/
// native.go). Reachable pre-session during First Launch's native folder
// step, admin-gated afterward (Admin Settings' Share on Network/Library
// location cards) — see requireNativeAccess's own doc comment for the
// exact rule; nothing here needs to re-derive it client-side.

// ShareOnNetwork/LibraryPath are the persisted choice (what a restart will
// apply); AppliedShareOnNetwork/nothing-else-for-library-path-since-
// LibraryPath-here-already-is-the-applied-value is what this running
// process actually booted with. See internal/api/dto.go's
// NativeSettingsResponse for the authoritative version of this comment —
// kept in sync deliberately, not shared, since one is Go and one is
// TypeScript.
export interface NativeSettings {
  shareOnNetwork: boolean
  appliedShareOnNetwork: boolean
  libraryPath: string
  pendingLibraryPath?: string
  port: string
  localIPs: string[]
}

export function getNativeSettings(): Promise<NativeSettings> {
  return apiGet<NativeSettings>('/api/native/settings')
}

export interface UpdateNativeSettingsRequest {
  shareOnNetwork?: boolean
  libraryPath?: string
  moveExisting?: boolean
}

export function updateNativeSettings(req: UpdateNativeSettingsRequest): Promise<NativeSettings> {
  return apiPatch<NativeSettings>('/api/native/settings', req)
}

// chooseNativeFolder opens a real native OS folder dialog, pre-selected at
// currentPath (server-side, ignores anything the client would send — the
// endpoint always uses its own Cfg.DataDir). An empty path means the user
// canceled, not an error.
export function chooseNativeFolder(): Promise<{ path: string }> {
  return apiPost<{ path: string }>('/api/native/choose-folder')
}

export function restartNativeApp(): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>('/api/native/restart')
}

// The desktop app's web view can't download or show a file itself, so its
// Download and Open PDF links go through these (lib/nativeLinks.ts): the
// server fetches the same /api/ URL as the signed-in user, then shows a
// native Save dialog, or opens the file in the system's default app.
export function saveNativeFile(url: string): Promise<{ saved: boolean; path?: string }> {
  return apiPost('/api/native/save-file', { url })
}

export function openNativeFile(url: string): Promise<{ ok: boolean }> {
  return apiPost('/api/native/open-file', { url })
}
