import { useState, type KeyboardEvent } from 'react'
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
  // Which option row ArrowUp/Down move between and Enter would pick — set
  // to the currently selected option (or 0) whenever the menu opens, same
  // "start somewhere sensible" convention as TagComboBox's own
  // highlightedIndex, just seeded from the current value instead of
  // always 0 since there's always exactly one already-selected option here
  // (TagComboBox has no equivalent "current value" to seed from).
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const selected = options.find((opt) => opt.value === value)

  function openMenu() {
    const currentIndex = options.findIndex((opt) => opt.value === value)
    setHighlightedIndex(currentIndex >= 0 ? currentIndex : 0)
    setOpen(true)
  }

  function selectOption(opt: { value: string; label: string }) {
    onChange(opt.value)
    setOpen(false)
  }

  // ArrowUp/Down opens the (closed) menu seeded at the current value, or
  // cycles the highlighted row (wrapping both ends) when already open;
  // Enter/Space picks whichever row is highlighted. Mirrors TagComboBox's
  // handleKeyDown, adapted for a fixed option list with no text input to
  // type into.
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) openMenu()
      else setHighlightedIndex((i) => (i + 1) % options.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) openMenu()
      else setHighlightedIndex((i) => (i - 1 + options.length) % options.length)
    } else if ((event.key === 'Enter' && !event.shiftKey) || event.key === ' ') {
      // Shift+Enter excluded — see TagComboBox's matching comment: it's
      // this app's form-save shortcut, even from a field with an open
      // dropdown.
      if (open) {
        event.preventDefault()
        const opt = options[highlightedIndex]
        if (opt) selectOption(opt)
      }
      // Closed: let the native click-on-Enter/Space behavior open it via
      // the button's own onClick below — no preventDefault needed.
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm text-ink-soft">{label}</label>
      <div className="relative">
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : openMenu())}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="flex w-full cursor-pointer items-center justify-between rounded-md border border-border bg-paper-raised px-3 py-2 text-left text-ink focus:outline focus:outline-2 focus:outline-accent focus:outline-offset-2"
        >
          <span className={value ? '' : 'text-ink-soft/50'}>{selected?.label ?? '—'}</span>
          {/* Solid pre-blend, not opacity — overlapping icon strokes would re-blend unevenly under real translucency. */}
          <IconChevronDown size={16} className="text-[#9d9892]" />
        </button>
        {open && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-paper-raised py-1 shadow-lg">
            {options.map((opt, index) => (
              <button
                key={opt.value}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(opt)}
                className={`block w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-accent-soft ${
                  opt.value === value ? 'text-accent' : 'text-ink'
                } ${index === highlightedIndex ? 'bg-accent-soft' : ''}`}
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
