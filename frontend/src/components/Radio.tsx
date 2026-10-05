import type { InputHTMLAttributes } from 'react'

// The radio counterpart of Checkbox.tsx, picked from a side-by-side of the
// browser's own radio, a ring-and-dot and this filled one: selected is a
// solid accent-fill circle with a white center, the same "solid fill, white
// mark" as a checked Checkbox, so the two read as one family. A real,
// invisible radio sits on top, so labels, arrow keys between a group's
// options and screen readers all work as they do with a native one.
// `className` goes on the wrapper, for nudging it into line with its label.
type RadioProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked'> & {
  checked: boolean
}

export function Radio({ checked, className = '', ...inputProps }: RadioProps) {
  return (
    <span className={`relative inline-flex size-4 shrink-0 ${className}`}>
      <input
        type="radio"
        checked={checked}
        {...inputProps}
        className="peer absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed"
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none flex size-4 items-center justify-center rounded-full border peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:opacity-50 ${
          checked
            ? 'border-accent-fill bg-accent-fill'
            : 'border-ink-faint bg-paper-raised peer-[:enabled:hover]:border-ink-soft'
        }`}
      >
        {checked && <span className="size-1.5 rounded-full bg-white" />}
      </span>
    </span>
  )
}
