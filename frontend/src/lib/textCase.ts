// Bulk "Capitalize" button on the Book Upload Wizard's "Name each piece"
// step (design doc §5's "fill fields" step) — titleCase for the Title
// field, nameCase for Composer/Arranger. Both are heuristics tuned for
// what actually shows up in these fields (piece titles, classical-music
// composer/arranger names), not general-purpose English capitalization —
// neither tries to handle every real-world edge case, just the common
// ones this app's own fields are likely to see.

// Capitalizes the first letter of a word and of every segment after an
// internal hyphen, apostrophe, period, or opening parenthesis — a plain
// "uppercase the first character" would leave "well-tempered" as
// "Well-tempered" and "j.s." as "J.s." instead of "Well-Tempered"/"J.S.".
// The "(" case matters because titleCase/nameCase split on whitespace
// only (see below), so a title like "Somewhere (reprise)" has "(reprise)"
// as one whole token — without "(" in this set, nothing inside ever
// followed one of the other recognized separators, so it stayed entirely
// lowercase (found 2026-08-27, not just under-capitalized). Lowercases
// everything else first, so this also normalizes ALL-CAPS or sTrAnGe-CaSe
// input, not just plain lowercase.
function capitalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/(^|[-'.(])([a-zà-öø-ÿ])/g, (_, sep: string, letter: string) => sep + letter.toUpperCase())
}

// Headline-style minor words — lowercase unless first/last in the title
// or immediately after a colon. Deliberately short prepositions/
// conjunctions/articles only; anything longer (e.g. "about", "under")
// reads as a real content word in a piece title and stays capitalized.
const MINOR_WORDS = new Set([
  'a', 'an', 'the',
  'and', 'but', 'or', 'nor', 'for', 'so', 'yet',
  'as', 'at', 'by', 'in', 'into', 'near', 'of', 'off', 'on', 'onto', 'out',
  'over', 'past', 'per', 'to', 'up', 'via', 'with', 'from',
])

export function titleCase(input: string): string {
  if (!input.trim()) return input
  const words = input.trim().split(/\s+/)
  return words
    .map((word, i) => {
      const isFirst = i === 0
      const isLast = i === words.length - 1
      const afterColon = i > 0 && words[i - 1].endsWith(':')
      const bare = word.replace(/[.,;:!?'"()]/g, '').toLowerCase()
      if (!isFirst && !isLast && !afterColon && MINOR_WORDS.has(bare)) {
        return word.toLowerCase()
      }
      return capitalizeWord(word)
    })
    .join(' ')
}

// Name-particles that stay lowercase mid-name (classical composers'
// names are the actual target here: "Ludwig van Beethoven", "Carl Maria
// von Weber", "Manuel de Falla") — but not when one of these is the
// first word of the whole name, since a bare surname on its own
// ("van Gogh" typed alone, no first name) reads as capitalized.
const NAME_PARTICLES = new Set([
  'van', 'von', 'der', 'den', 'de', 'del', 'della', 'di', 'la', 'le', 'du', 'da', 'dos', 'das',
])

export function nameCase(input: string): string {
  if (!input.trim()) return input
  const words = input.trim().split(/\s+/)
  return words
    .map((word, i) => {
      const bare = word.replace(/[.,;:!?'"()]/g, '').toLowerCase()
      if (i > 0 && NAME_PARTICLES.has(bare)) return word.toLowerCase()
      return capitalizeWord(word)
    })
    .join(' ')
}
