// Shared by the People library's list rows (real and mockup).

/** "Composer", "Arranger", "Composer & arranger", or null with neither. */
export function personRoleLabel(composerCount: number, arrangerCount: number): string | null {
  if (composerCount > 0 && arrangerCount > 0) return 'Composer & arranger'
  if (arrangerCount > 0) return 'Arranger'
  if (composerCount > 0) return 'Composer'
  return null
}

/** A bio as one run of text, for a short clamped excerpt: paragraphs and
 * line breaks become spaces, so the clamp never shows a paragraph gap. */
export function bioExcerpt(bio: string): string {
  return bio.replace(/\s*\n+\s*/g, ' ').trim()
}

export const pluralCount = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
