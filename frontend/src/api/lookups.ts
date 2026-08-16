import { apiGet } from './client'
import type { Tag } from './types'

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
