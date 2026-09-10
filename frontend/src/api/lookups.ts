import { apiDelete, apiGet, apiPatch, apiPost } from './client'
import type { PracticeStatusItem, Tag } from './types'

export function listKeys(): Promise<Tag[]> {
  return apiGet<Tag[]>('/api/keys')
}

export function listSheetTypes(): Promise<Tag[]> {
  return apiGet<Tag[]>('/api/sheet-types')
}

export function listInstruments(): Promise<Tag[]> {
  return apiGet<Tag[]>('/api/instruments')
}

export function listUserTags(): Promise<Tag[]> {
  return apiGet<Tag[]>('/api/tags')
}

export function listPracticeStatuses(): Promise<PracticeStatusItem[]> {
  return apiGet<PracticeStatusItem[]>('/api/practice-statuses')
}

// Your Tags / Practice Status create/rename/delete-or-merge (User
// Settings) — both share the exact same request/response shape
// server-side (internal/handlers/lookup.go), so one small set of
// functions covers both, parameterized by the resource path.
type UserListResource = 'tags' | 'practice-statuses'

export function createUserListItem(resource: UserListResource, name: string): Promise<Tag> {
  return apiPost<Tag>(`/api/${resource}`, { name })
}

export function renameUserListItem(resource: UserListResource, id: number, name: string): Promise<Tag> {
  return apiPatch<Tag>(`/api/${resource}/${id}`, { name })
}

// mergeIntoId present reassigns every piece already using id to it first,
// then deletes id; absent deletes id outright and affected pieces simply
// lose that tag/status (internal/handlers/lookup.go's own delete/merge
// contract).
export function deleteUserListItem(
  resource: UserListResource,
  id: number,
  mergeIntoId?: number,
): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(
    `/api/${resource}/${id}`,
    mergeIntoId !== undefined ? { mergeIntoId } : undefined,
  )
}
