import type { ReactNode } from 'react'

// A real sliding switch (role="switch"), not a checkbox — first needed by
// the US renewal follow-up's "This work was renewed" field
// (EditPieceModal.tsx/EditBookModal.tsx and their mockups), but generic
// enough to be the shared control for any future boolean field in this app.
// The switch and its label are both independently clickable (a bigger,
// more forgiving touch target) — an InfoTooltip trigger, if one is needed
// alongside, stays a sibling outside this component rather than nested
// inside the clickable label, so its own click never also toggles the
// switch.
export function Toggle({
  checked,
  onChange,
  label,
  id,
  disabled,
  title,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  id?: string
  // "Coming soon" settings (e.g. User Settings' Paginated views) and
  // permission-gated controls both need this — a real disabled state, not
  // just an onChange that's never wired up, since the switch/label pair
  // would otherwise still visibly track clicks (the thumb slides, the
  // track recolors) for a setting that either does nothing yet or the
  // viewer can't actually change, matching CLAUDE.md's own permission-
  // aware UI gating convention (real `disabled`, faint container opacity,
  // a `title` explaining why).
  disabled?: boolean
  title?: string
}) {
  return (
    <div className={`flex items-center gap-2 ${disabled ? 'opacity-50' : ''}`} title={title}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-accent ${
          disabled ? 'cursor-not-allowed' : 'cursor-pointer'
        } ${checked ? 'bg-accent' : 'bg-border'}`}
      >
        <span
          className={`inline-block size-3.5 transform rounded-full bg-paper-raised shadow transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-1'
          }`}
        />
      </button>
      <span
        className={`text-sm text-ink select-none ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
        onClick={() => !disabled && onChange(!checked)}
      >
        {label}
      </span>
    </div>
  )
}
