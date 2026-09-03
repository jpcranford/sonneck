// US renewal follow-up (2026-09-03) — pure logic, shared the same way
// copyrightBadge.ts/formatPieceMeta.ts are: both mockups (EditPieceModalMockup.tsx,
// EditBookModalMockup.tsx) and, later, both real components need the exact
// same threshold, and a legally-sensitive year range is exactly the kind of
// thing that must not be allowed to drift out of sync across 4 separate
// copies.
//
// Sources: Wikipedia "Copyright renewal in the United States" and "Public
// domain in the United States" — works published 1923 through 1963 needed a
// renewal registration filed "during the 28th year" of the first term to
// keep protection past that initial 28 years; 1964+ became automatic (1992
// Copyright Renewal Act); anything before 1923 is unconditionally public
// domain by now regardless of renewal, since even the maximum possible
// 95-year term has already elapsed.
export const US_RENEWAL_WINDOW_START = 1923
export const US_RENEWAL_WINDOW_END = 1963

// Whether year (as typed into a Copyright Year field, before any
// book-inheritance resolution) falls in the window where a renewal toggle
// is even relevant — the caller is still responsible for also checking
// COPYRIGHT_REGION === 'en-US' (only fetchable from the backend, not pure
// logic this function can encapsulate itself).
export function inUSRenewalWindow(year: string | number): boolean {
  const n = typeof year === 'number' ? year : Number(year)
  return Number.isInteger(n) && n >= US_RENEWAL_WINDOW_START && n <= US_RENEWAL_WINDOW_END
}
