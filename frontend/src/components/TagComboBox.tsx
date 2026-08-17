import { useRef, useState } from 'react'
import { IconXFilled } from '@tabler/icons-react'
import type { Tag } from '../api/types'
import { InheritedNote } from './InheritedNote'

// The real §15 tag-input pattern: typeahead filter against existing
// options, a "New tag: '‹input›'" option to create on the fly (resolved
// server-side via repo.FindOrCreate* — CLAUDE.md > Book-level soft
// inheritance's Calibre-style pick-existing-or-type-new), selected pills
// wrap the box vertically (not horizontal scroll). `multiple` toggles
// single vs. multi-select. Book-inheritable fields pair it with an
// InheritedNote (shown only while empty).
export function TagComboBox({
  label,
  options,
  selected,
  multiple,
  onChange,
  bookValue,
  onCopy,
  filterOption,
  allowDuplicates,
}: {
  label: string
  options: Tag[]
  selected: Tag[]
  multiple: boolean
  onChange: (next: Tag[]) => void
  bookValue?: string
  onCopy?: () => void
  // Overrides the default plain-substring match against `name` — e.g. the
  // Key(s) picker passes matchesKeyQuery (../lib/keySearch.ts) so typing
  // "Eb" or "e flat" finds "E♭ Major", not just a literal "♭" match.
  filterOption?: (option: Tag, query: string) => boolean
  // Lets an already-selected option be picked again — the Key(s) picker
  // needs this for a piece that modulates back to a key it already used
  // (e.g. C Major -> G Major -> C Major, migration 00012). Off by default:
  // Instruments/Your Tags have no reason to hold the same tag twice.
  allowDuplicates?: boolean
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Stable, decrementing negative IDs for on-the-fly "new tag" entries —
  // avoids calling an impure function like Date.now() from a component.
  // These are placeholder client-side IDs only; the real ID the backend
  // assigns (via findOrCreate) is looked up by name on submit, not carried
  // through this negative ID.
  const nextNewTagId = useRef(-1)

  const filtered = options
    .filter((o) => allowDuplicates || !selected.some((s) => s.id === o.id))
    .filter((o) =>
      filterOption ? filterOption(o, query) : o.name.toLowerCase().includes(query.toLowerCase()),
    )
  const exactMatch = options.some((o) => o.name.toLowerCase() === query.trim().toLowerCase())

  function selectOption(opt: Tag) {
    onChange(multiple ? [...selected, opt] : [opt])
    setQuery('')
    if (!multiple) setOpen(false)
    inputRef.current?.focus()
  }

  function createNew() {
    if (!query.trim()) return
    selectOption({ id: nextNewTagId.current--, name: query.trim() })
  }

  // Removes by position, not by id — with allowDuplicates, two pills can
  // share a tag id (the same key used twice), so "remove the one matching
  // this id" would delete both, or the wrong one.
  function removeTagAt(index: number) {
    onChange(selected.filter((_, i) => i !== index))
  }

  const showInput = multiple || selected.length === 0

  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm text-ink-soft">{label}</label>
      <div className="relative">
        <div
          onClick={() => inputRef.current?.focus()}
          className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-md border border-border bg-paper-raised px-2 py-1.5 focus-within:outline focus-within:outline-2 focus-within:outline-accent focus-within:outline-offset-2"
        >
          {selected.map((tag, index) => (
            // Composite key (id + position) rather than just tag.id — two
            // pills can legitimately share an id with allowDuplicates.
            <span
              key={`${tag.id}-${index}`}
              className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent"
            >
              {tag.name}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  removeTagAt(index)
                }}
                aria-label={`Remove ${tag.name}`}
                className="hover:text-ink"
              >
                <IconXFilled size={11} />
              </button>
            </span>
          ))}
          {showInput && (
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setOpen(true)
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              placeholder={selected.length === 0 ? 'Type to search or add…' : ''}
              className="min-w-[100px] flex-1 border-none bg-transparent text-sm text-ink outline-none focus-visible:outline-none"
            />
          )}
        </div>
        {open && showInput && (filtered.length > 0 || query.trim()) && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-paper-raised py-1 shadow-lg">
            {filtered.slice(0, 6).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(opt)}
                className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-accent-soft"
              >
                {opt.name}
              </button>
            ))}
            {query.trim() && !exactMatch && (
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={createNew}
                className="block w-full px-3 py-2 text-left text-sm text-accent hover:bg-accent-soft"
              >
                New tag: "{query.trim()}"
              </button>
            )}
          </div>
        )}
      </div>
      {selected.length === 0 && bookValue && onCopy && (
        <InheritedNote bookValue={bookValue} onCopy={onCopy} />
      )}
    </div>
  )
}
