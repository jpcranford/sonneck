// Musical key names store the accidental as a real Unicode symbol (♭/♯ —
// migration 00010_key_naming_and_order.sql, "never ASCII '#' or a literal
// 'b'"), but a user typing a search query has no easy way to type ♭/♯
// directly. Without this, TagComboBox's plain substring match never
// matches "E♭ Major" against a typed "Eb" or "e flat" — the ♭ character
// just isn't present in either. This builds a search haystack per key
// name with both an ASCII-symbol form ("eb major") and a spelled-out-word
// form ("e flat major") alongside the original, so ordinary substring
// matching against the *query* (left untouched — the query itself is
// already plain ASCII) finds it either way.
function keySearchHaystack(name: string): string {
  const lower = name.toLowerCase()
  const asciiSymbol = lower.replace(/♭/g, 'b').replace(/♯/g, '#')
  const asciiWord = lower.replace(/♭/g, ' flat').replace(/♯/g, ' sharp')
  return `${lower} ${asciiSymbol} ${asciiWord}`
}

// Both sides have their whitespace stripped before comparing (direct
// request, 2026-09-05 — matches TagComboBox's own default-matcher
// treatment) so a query never has to land on the exact same word boundary
// as the stored name — "bmajor" matches "B♭ Major" the same way "eb major"
// already did.
export function matchesKeyQuery(name: string, query: string): boolean {
  const haystack = keySearchHaystack(name).replace(/\s+/g, '')
  const needle = query.trim().toLowerCase().replace(/\s+/g, '')
  return haystack.includes(needle)
}
