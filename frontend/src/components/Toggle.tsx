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
//
// The switch is 44×26 everywhere (the size the Sheet Viewer's rows
// introduced, adopted app-wide). `row` is the Sheet Viewer's switch-row
// style (design D, picked from a side-by-side:
// https://claude.ai/artifact/Cx5oktzeNJnW1BCXRmnBmH): the label first at the
// surrounding text's size, the switch at the row's right edge, and the
// whole row clickable. The caller sizes the row
// (`className`, e.g. a 48pt height and the padding that lines the label up
// with the text around it).
export function Toggle({
  checked,
  onChange,
  label,
  id,
  disabled,
  title,
  row,
  className = '',
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  id?: string
  disabled?: boolean
  title?: string
  row?: boolean
  className?: string
}) {
  const toggle = () => !disabled && onChange(!checked)
  const switchButton = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[26px] w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-accent ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'} ${checked ? 'bg-accent-fill' : 'bg-border'}`}
    >
      <span
        className={`inline-block size-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[21px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  )
  const labelSpan = (
    <span
      className={`${row ? 'min-w-0 flex-1 truncate' : 'text-sm'} text-ink select-none ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      onClick={toggle}
    >
      {label}
    </span>
  )
  if (row) {
    return (
      <div
        className={`flex items-center gap-3 ${disabled ? 'opacity-50' : 'cursor-pointer'} ${className}`}
        title={title}
        onClick={(event) => {
          if (event.target === event.currentTarget) toggle()
        }}
      >
        {labelSpan}
        {switchButton}
      </div>
    )
  }
  return (
    <div
      className={`flex items-center gap-2 ${disabled ? 'opacity-50' : ''} ${className}`}
      title={title}
    >
      {switchButton}
      {labelSpan}
    </div>
  )
}
