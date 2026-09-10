import { apiDelete, apiGet, apiPatch, apiPost } from './client'
import type { Tag } from './types'

// Every endpoint here is admin-permission-gated server-side
// (internal/handlers/admin.go/librarysettings.go/version.go) — distinct
// from api/lookups.ts's user-scoped Tags/Practice Status functions, which
// hit a different, non-admin route.

export type Permission =
  | 'read'
  | 'download'
  | 'practice'
  | 'edit'
  | 'upload'
  | 'create'
  | 'delete'
  | 'admin'

export interface AdminUser {
  id: number
  displayName: string
  permissions: Permission[]
  isLastAdmin: boolean
}

export function listAdminUsers(): Promise<AdminUser[]> {
  return apiGet<AdminUser[]>('/api/admin/users')
}

export function setUserPermissions(id: number, permissions: Permission[]): Promise<AdminUser> {
  return apiPatch<AdminUser>(`/api/admin/users/${id}`, { permissions })
}

export function deleteAdminUser(id: number): Promise<{ deleted: boolean; id: number }> {
  return apiDelete<{ deleted: boolean; id: number }>(`/api/admin/users/${id}`)
}

// Security "Change…" (none/singlepass only — see internal/handlers/admin.go's
// handleAdminSecurity for the full scope this deliberately doesn't cover).
// password omitted/blank when switching to singlepass with one already set
// means "keep the current password."
export function setSecurity(authMethod: 'none' | 'singlepass', password?: string): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>('/api/admin/security', { authMethod, password })
}

export interface LibraryCounts {
  pieces: number
  books: number
  people: number
}

export function getLibraryCounts(): Promise<LibraryCounts> {
  return apiGet<LibraryCounts>('/api/admin/library-counts')
}

// Library Settings — mirrors internal/api/dto.go's LibrarySettingsResponse/
// UpdateLibrarySettingsRequest exactly. Persisted to DATA_DIR/config.yml
// server-side, not SQLite (a confirmed, deliberate choice) — see that DTO's
// own doc comment. Each *SetByEnv flag locks its field in the UI; updating
// while a field is locked must resend that field's own current value
// unchanged (the backend 409s a genuine attempted change, not a no-op echo).
export interface LibrarySettings {
  backupCron: string
  backupCronSetByEnv: boolean
  backupRetentionDays: number
  backupRetentionDaysSetByEnv: boolean
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  logLevelSetByEnv: boolean
  copyrightRegion: string
  copyrightRegionSetByEnv: boolean
}

export function getLibrarySettings(): Promise<LibrarySettings> {
  return apiGet<LibrarySettings>('/api/admin/library-settings')
}

export interface UpdateLibrarySettingsRequest {
  backupCron: string
  backupRetentionDays: number
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  copyrightRegion: string
}

export function updateLibrarySettings(req: UpdateLibrarySettingsRequest): Promise<LibrarySettings> {
  return apiPatch<LibrarySettings>('/api/admin/library-settings', req)
}

// Version / Check for Updates — mirrors internal/api/dto.go's
// VersionResponse. checkStatus/matchedRelease/availableVersion/checkedAt
// are all null until a check has actually run this server process's
// lifetime (GET never triggers one itself, beyond a one-time lazy
// background warm-up — see internal/handlers/version.go). runningFromSource
// means this binary has no injected build identity at all (a plain
// `go run`/`go build` straight from the repo, this project's own whole dev
// loop included, not just a Docker image) — no check ever runs against it.
export interface VersionInfo {
  runningSHA: string
  runningDate: string
  runningFromSource: boolean
  matchedRelease: string | null
  checkStatus: 'upToDate' | 'ahead' | 'behind' | 'unknown' | null
  availableVersion?: string
  checkedAt?: string
}

export function getVersion(): Promise<VersionInfo> {
  return apiGet<VersionInfo>('/api/admin/version')
}

export function checkForUpdates(): Promise<VersionInfo> {
  return apiPost<VersionInfo>('/api/admin/version/check')
}

// Lookup Tables' admin-scoped create/rename/delete-or-merge (Sheet Types/
// Instruments) — same request/response shape for both, one small
// parameterized set of functions, same pattern api/lookups.ts's user-scoped
// Tags/Practice Status functions already use.
export type LookupResource = 'sheet-types' | 'instruments'

export function createLookupItem(resource: LookupResource, name: string): Promise<Tag> {
  return apiPost<Tag>(`/api/admin/${resource}`, { name })
}

export function renameLookupItem(resource: LookupResource, id: number, name: string): Promise<Tag> {
  return apiPatch<Tag>(`/api/admin/${resource}/${id}`, { name })
}

export function deleteLookupItem(
  resource: LookupResource,
  id: number,
  mergeIntoId?: number,
): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(
    `/api/admin/${resource}/${id}`,
    mergeIntoId !== undefined ? { mergeIntoId } : undefined,
  )
}
