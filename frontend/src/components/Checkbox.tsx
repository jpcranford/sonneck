import type { InputHTMLAttributes } from 'react'
import { IconCheck } from '@tabler/icons-react'

// The app's one checkbox look, picked from a side-by-side of the browser's
// own checkbox and two drawn sizes. Drawn rather than native so it looks
// the same in every browser and both themes: a native checkbox tinted with
// `accent` turns pale sage in the dark theme, and its empty box can't be
// styled at all.
//
// CheckboxMark is just the box, for a row that is itself the control (the
// Add to Setlist picker's rows are buttons); Checkbox wraps it around a
// real, invisible checkbox, so labels, the keyboard and screen readers all
// work as they do with a native one.
export function CheckboxMark({
  checked,
  className = '',
}: {
  checked: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-4 shrink-0 items-center justify-center rounded border text-white ${
        checked ? 'border-accent-fill bg-accent-fill' : 'border-ink-faint bg-paper-raised'
      } ${className}`}
    >
      {checked && <IconCheck size={11} stroke={3} />}
    </span>
  )
}

type CheckboxProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'checked' | 'className'
> & {
  checked: boolean
}

export function Checkbox({ checked, ...inputProps }: CheckboxProps) {
  return (
    <span className="relative inline-flex size-4 shrink-0">
      <input
        type="checkbox"
        checked={checked}
        {...inputProps}
        className="peer absolute inset-0 m-0 size-full cursor-pointer appearance-none disabled:cursor-not-allowed"
      />
      <CheckboxMark
        checked={checked}
        className={`pointer-events-none peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:opacity-50 ${
          checked ? '' : 'peer-[:enabled:hover]:border-ink-soft'
        }`}
      />
    </span>
  )
}
