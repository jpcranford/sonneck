// Mirrors the backend's hyphenateISBN (internal/handlers/citation.go) —
// same simplified heuristic approved 2026-08-20, kept in sync by hand since
// there's no shared code across the Go/TS boundary in this project (see
// citation.go's own stripImslpPrefix, independently implemented on both
// sides). Extracted as a shared frontend module rather than duplicated per
// mockup/component — same "tested, correctness-critical, needed in
// multiple places" exception to the usual per-file self-containment
// convention that pieceSplitLogic.ts already established, since this exact
// formatting needs to match across Piece View, Book Details, Edit Book
// Modal, and the Book Upload Wizard's About step.
//
// NOT officially correct ISBN hyphenation — true correctness needs the
// International ISBN Agency's own range tables (exactly which
// registration-group and publisher-prefix boundaries exist, and how many
// digits each occupies), which this project deliberately isn't embedding
// or maintaining. Registration groups 0/1/2/3/4/5/7 are single-digit under
// the real spec (English, English, French, German, Japanese, Russian/CIS,
// Chinese — the groups this app is most likely to actually see); every
// other leading digit gets a 2-digit group instead. The registration-group
// and publisher/title segments are further lumped into one block rather
// than also guessing a publisher-prefix boundary — that guess would be
// even less reliable than the group-length one. Anything that isn't
// exactly 10 or 13 characters (incomplete/malformed data) is returned
// unhyphenated rather than guessed at.
export function hyphenateISBN(digits: string): string {
  switch (digits.length) {
    case 10: {
      const group = isbnRegistrationGroupLength(digits[0])
      return `${digits.slice(0, group)}-${digits.slice(group, 9)}-${digits.slice(9)}`
    }
    case 13: {
      const ean = digits.slice(0, 3)
      const rest = digits.slice(3)
      const group = isbnRegistrationGroupLength(rest[0])
      return `${ean}-${rest.slice(0, group)}-${rest.slice(group, 9)}-${rest.slice(9)}`
    }
    default:
      return digits
  }
}

function isbnRegistrationGroupLength(firstDigit: string): number {
  return ['0', '1', '2', '3', '4', '5', '7'].includes(firstDigit) ? 1 : 2
}
