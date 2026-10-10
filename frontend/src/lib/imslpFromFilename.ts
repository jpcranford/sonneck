// The IMSLP number an upload's filename carries ("…_IMSLP04154.pdf" →
// "04154") — the same pattern as the server's own detection
// (detectImslpNumber, internal/handlers/filename.go), keep the two in step.
// Used to tell whether an IMSLP field still holds the number that came
// from the filename.
export function imslpNumberFromFilename(filename: string | null | undefined): string | null {
  return filename?.match(/IMSLP(\d+)/)?.[1] ?? null
}

/** True while `value` (any "IMSLP" label prefix aside) is `detected`. */
export function isDetectedImslpNumber(value: string, detected: string | null): boolean {
  return !!detected && value.replace(/^\s*imslp[\s:#-]*/i, '').trim() === detected
}
