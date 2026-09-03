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
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  id?: string
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-accent ${
          checked ? 'bg-accent' : 'bg-border'
        }`}
      >
        <span
          className={`inline-block size-3.5 transform rounded-full bg-paper-raised shadow transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-1'
          }`}
        />
      </button>
      <span
        className="cursor-pointer text-sm text-ink select-none"
        onClick={() => onChange(!checked)}
      >
        {label}
      </span>
    </div>
  )
}
