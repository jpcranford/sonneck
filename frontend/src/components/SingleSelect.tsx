import { useState } from 'react'
import { IconChevronDown } from '@tabler/icons-react'
import { InheritedNote } from './InheritedNote'

// A single value from a small fixed option list (Sheet Type, Practice
// Status) — same custom-styled trigger/panel treatment as TagComboBox for
// visual consistency (a bare native <select> renders with the browser/OS's
// own chrome, which doesn't match the rest of this form — a deliberate
// choice, not cosmetic-only), but no pill: picking a value just sets it in
// place, since there's only ever one and nothing to remove/re-add.
export function SingleSelect({
  label,
  options,
  value,
  onChange,
  bookValue,
  onCopy,
}: {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (next: string) => void
  bookValue?: string
  onCopy?: () => void
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((opt) => opt.value === value)

  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm text-ink-soft">{label}</label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="flex w-full items-center justify-between rounded-md border border-border bg-paper-raised px-3 py-2 text-left text-ink focus:outline focus:outline-2 focus:outline-accent focus:outline-offset-2"
        >
          <span className={value ? '' : 'text-ink-soft/50'}>{selected?.label ?? '—'}</span>
          <IconChevronDown size={16} className="text-ink-soft/60" />
        </button>
        {open && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-paper-raised py-1 shadow-lg">
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-accent-soft ${
                  opt.value === value ? 'text-accent' : 'text-ink'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {!value && bookValue && onCopy && <InheritedNote bookValue={bookValue} onCopy={onCopy} />}
    </div>
  )
}
