import { apiGet } from './client'

// Wikipedia autofill (composer/arranger overhaul) — shared by the Edit
// Person modal's own autofill button and Upload Portrait's "search
// Wikipedia" source step. Unlike IMSLP's number-based lookup (a single
// resolved WorkInfo), a person's *name* is inherently ambiguous, so this
// is a real disambiguation list — the human picks, same reasoning the
// approved mockups already settled on ("Chopin (crater)"/"Chopin
// Airport" alongside the real composer).
export interface WikipediaSearchResult {
  title: string
  description: string
  birthYear: number | null
  deathYear: number | null
}

export function searchWikipedia(query: string): Promise<WikipediaSearchResult[]> {
  return apiGet<WikipediaSearchResult[]>(`/api/wikipedia/search?query=${encodeURIComponent(query)}`)
}

// Upload Portrait's own "use this Wikipedia result as my portrait
// source" step — resolves a page title (from searchWikipedia's own
// results) to its lead image URL, which the frontend loads directly into
// a cross-origin-enabled <img> for client-side crop/zoom (confirmed live:
// upload.wikimedia.org serves Access-Control-Allow-Origin: *, so no
// server-side image proxy is needed). null when that page genuinely has
// no lead image on record — a normal result, not an error.
export function getWikipediaPageImage(title: string): Promise<{ imageUrl: string | null }> {
  return apiGet<{ imageUrl: string | null }>(`/api/wikipedia/page-image?title=${encodeURIComponent(title)}`)
}
