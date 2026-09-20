// Strips diacritics and whitespace before comparing — e.g. so typing
// "Boely" (no diaeresis) matches "Alexandre Boëly", and typing "toml"
// matches "Tom Lehrer" since "TomLehrer" (spaces stripped) starts with
// it. NFD
// decomposition splits a base letter from its combining diacritical mark
// (U+0300-036F covers the whole combining-marks block), so stripping that
// range after normalizing reduces "ë"/"é"/"ö"/etc. down to their plain
// ASCII base letter; stripping whitespace afterward means a query never
// has to land on the exact same word boundary as the stored name (a
// multi-word Instrument/tag name gets the same treatment, not just Person
// names).
//
// Pulled out of components/TagComboBox.tsx (its own default substring
// filter still uses this) into lib/ so BookUploadTitlesStep.tsx could
// reuse the identical matching semantics for its own locally-created-
// person dedup without either duplicating the function or exporting a
// bare helper alongside a component (which trips this project's
// react-refresh/only-export-components lint rule).
export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '')
}
