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

export function matchesKeyQuery(name: string, query: string): boolean {
  return keySearchHaystack(name).includes(query.trim().toLowerCase())
}
