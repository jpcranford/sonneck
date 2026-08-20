// Book Upload Wizard draft persistence (design doc §5: "localStorage,
// keyed by bookId, storing split points + in-progress field values.
// Restore on return to an in-progress import; clear on confirm or
// explicit cancel"). First localStorage usage anywhere in this frontend —
// nothing existing to follow or conflict with.
//
// Scoped deliberately: this survives an accidental reload mid-wizard for
// the book currently in progress. It is not a "resume any past import
// from anywhere in the app" feature — there's no entry point for that
// anywhere in the UI, and building one wasn't asked for. A single fixed
// storage key is enough because only one book import is ever in progress
// in this UI at a time.

const STORAGE_KEY = 'sonneck-book-wizard-draft'

// The step to resume into — 'file' is deliberately excluded, since that
// step has no book/draft to speak of yet.
export type WizardDraftStep = 'about' | 'split' | 'titles' | 'confirm'

export interface WizardDraftData {
  bookId: number
  step: WizardDraftStep
  pageCount: number
  pageAssignments: { starts: number[]; skips: number[]; shared: number[] }
  pieceFields: { title: string; composer: string }[]
}

function isWizardDraftData(value: unknown): value is WizardDraftData {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.bookId === 'number' &&
    typeof v.step === 'string' &&
    typeof v.pageCount === 'number' &&
    typeof v.pageAssignments === 'object' &&
    v.pageAssignments !== null &&
    Array.isArray(v.pieceFields)
  )
}

export function loadWizardDraft(): WizardDraftData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isWizardDraftData(parsed) ? parsed : null
  } catch {
    // Malformed JSON, or localStorage unavailable (private browsing) —
    // either way, no draft is the safe fallback, not a thrown error.
    return null
  }
}

export function saveWizardDraft(draft: WizardDraftData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
  } catch {
    // Draft persistence is a recovery convenience, not something worth
    // crashing the wizard over if a write fails (quota, private browsing).
  }
}

export function clearWizardDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // See saveWizardDraft.
  }
}
