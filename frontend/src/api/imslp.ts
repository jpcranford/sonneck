import { apiGet } from './client'

// "IMSLP live autofill" (design doc §13, deferred there — built
// 2026-08-27, see internal/imslp's own package comment for how the
// backend actually resolves a bare number, and for how Publisher/
// PublisherID specifically are resolved to the *exact* file/edition the
// number refers to, not just "a" publisher for the work in general).
export interface ImslpWorkInfo {
  composer: string
  workOpusNumber: string
  yearWritten: string
  publisher: string
  publisherId: string
}

export function lookupImslp(number: string): Promise<ImslpWorkInfo> {
  return apiGet<ImslpWorkInfo>(`/api/imslp/lookup?number=${encodeURIComponent(number)}`)
}
