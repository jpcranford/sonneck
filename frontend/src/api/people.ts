import { apiDelete, apiGet, apiPatch, apiPost, apiUpload } from './client'
import type { Person, PersonCreateRequest, PersonSplitRequest, PersonWriteRequest } from './types'

interface ListPeopleParams {
  query?: string
  sort?: 'name' | 'pieceCount' | 'birthYear' | 'deathYear' | 'dateAdded'
  dir?: 'asc' | 'desc'
}

// People Library's own browse/search, and — reused unpaginated — the
// composer/arranger TagComboBox picker source on EditPieceModal.tsx/
// EditBookModal.tsx (Stage C) and Person Details' own Split People modal.
// No limit/offset, same "small personal-library scale" assumption
// Key/Instrument/SheetType's own lookup endpoints already make (backend:
// handleListPeople).
export function listPeople(params: ListPeopleParams = {}): Promise<Person[]> {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const qs = search.toString()
  return apiGet<Person[]>(`/api/people${qs ? `?${qs}` : ''}`)
}

export function createPerson(req: PersonCreateRequest): Promise<Person> {
  return apiPost<Person>('/api/people', req)
}

export function getPerson(id: number): Promise<Person> {
  return apiGet<Person>(`/api/people/${id}`)
}

export function updatePerson(id: number, req: PersonWriteRequest): Promise<Person> {
  return apiPatch<Person>(`/api/people/${id}`, req)
}

export function deletePerson(id: number): Promise<{ status: string }> {
  return apiDelete(`/api/people/${id}`)
}

// Split People: reassigns every one of this person's credits to one or
// more replacement people, in order — the person's own row isn't deleted,
// just left with zero credits (backend: repo.SplitPerson).
export function splitPerson(id: number, req: PersonSplitRequest): Promise<Person> {
  return apiPost<Person>(`/api/people/${id}/split`, req)
}

// Mirrors getBookCoverUrl's own cache-busting convention exactly —
// `version` should be `person.portraitImageHash`, since this URL is
// otherwise the same string before and after a portrait upload/removal and
// nothing else forces a re-fetch.
export function getPersonPortraitUrl(personId: number, version?: string | null): string {
  return version ? `/api/people/${personId}/portrait?v=${version}` : `/api/people/${personId}/portrait`
}

export function uploadPersonPortrait(personId: number, file: File): Promise<Person> {
  return apiUpload<Person>(`/api/people/${personId}/portrait`, file)
}

export function removePersonPortrait(personId: number): Promise<Person> {
  return apiDelete<Person>(`/api/people/${personId}/portrait`)
}
