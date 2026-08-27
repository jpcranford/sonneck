import { IconCheck, IconCloudDownload, IconCloudOff, IconLoader2 } from '@tabler/icons-react'

// "IMSLP live autofill" (design doc §13, deferred there — built
// 2026-08-27). Shared between EditPieceModal.tsx and
// BookUploadAboutStep.tsx — same button, same states, used identically
// in both real places, unlike this app's mockup-vs-real components
// (which duplicate deliberately for the mockup's own independence; this
// has no such reason to duplicate, since both callers are real). Sits
// inside the IMSLP field itself, right-aligned and vertically centered —
// same placement convention as a password field's show/hide toggle —
// rather than beside it, so it reads as acting *on* that field
// specifically.
//
// Two faint-but-distinct states, not just shown-or-hidden: a bare cloud
// only means "fetchable" when the effective value (the field's own, or a
// book/filename-detected fallback — the caller decides which) is
// actually number-only once any "IMSLP" label prefix is stripped — the
// same normalization every stripImslpPrefix in this app already applies
// before a save. Anything else (blank, or text that isn't just digits)
// shows cloud-off instead, fainter still than the fetchable state —
// always visible either way, so the feature is discoverable even when
// there's nothing to fetch yet, rather than disappearing entirely. Both
// are solid pre-blend colors (#9d9892 / #c9c2b6, the same two faint
// tones this codebase already uses elsewhere for "faint icon" and
// "fainter still, disabled-reading" content respectively), never a
// translucent opacity utility (CLAUDE.md's icon-color rule).
export function ImslpAutofillButton({
  state,
  valid,
  onClick,
}: {
  state: 'idle' | 'fetching' | 'done'
  valid: boolean
  onClick: () => void
}) {
  const disabled = !valid || state !== 'idle'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={valid ? 'Autofill blank fields from IMSLP' : 'No IMSLP number to autofill from'}
      title={valid ? 'Autofill blank fields from IMSLP' : 'No IMSLP number to autofill from'}
      className={`absolute top-1/2 right-2.5 flex size-5 -translate-y-1/2 items-center justify-center disabled:cursor-default ${
        valid ? 'cursor-pointer text-[#9d9892] hover:text-accent' : 'text-[#c9c2b6]'
      }`}
    >
      {!valid && <IconCloudOff size={16} />}
      {valid && state === 'idle' && <IconCloudDownload size={16} />}
      {valid && state === 'fetching' && <IconLoader2 size={16} className="animate-spin text-ink-soft" />}
      {valid && state === 'done' && <IconCheck size={16} className="text-accent" />}
    </button>
  )
}
