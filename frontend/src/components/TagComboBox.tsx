import { useRef, useState, type KeyboardEvent } from 'react'
import { IconArrowRight, IconXFilled } from '@tabler/icons-react'
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
  sequenceStyle,
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
  // Renders the selected values as one merged, ordered sequence ("›"
  // between entries, plain typed-text styling) instead of one independent
  // accent pill per value — matches how the Piece View / TagPills already
  // display a piece's key sequence (PiecePage.tsx, TagPills.tsx), so the
  // input looks like the thing it's editing. Each key keeps its own
  // remove button; only the pill-per-key wrapper is replaced. Key(s)-only
  // — Instruments/Your Tags aren't ordered, so they keep the
  // independent-pill treatment. Locked design: mockup at
  // /mockup/edit-piece-modal, approved 2026-08-18.
  sequenceStyle?: boolean
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  // Which menu row (existing options, then the "New tag" row if shown)
  // Enter would act on — arrow keys move it, typing resets it back to 0 so
  // Enter always defaults to "the top result" without requiring a press of
  // ArrowDown first.
  const [highlightedIndex, setHighlightedIndex] = useState(0)
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
  // Same slice(0, 6) the dropdown itself renders — keyboard nav has to walk
  // exactly the rows actually on screen, not the full unfiltered match set.
  const visibleOptions = filtered.slice(0, 6)
  const showCreateOption = query.trim() !== '' && !exactMatch
  const menuItemCount = visibleOptions.length + (showCreateOption ? 1 : 0)

  function selectOption(opt: Tag) {
    onChange(multiple ? [...selected, opt] : [opt])
    setQuery('')
    setHighlightedIndex(0)
    if (!multiple) setOpen(false)
    inputRef.current?.focus()
  }

  function createNew() {
    if (!query.trim()) return
    selectOption({ id: nextNewTagId.current--, name: query.trim() })
  }

  // ArrowUp/Down cycles the highlighted row (options first, "New tag" row
  // last, wrapping both ends); Enter acts on whichever row is currently
  // highlighted — the top result by default, or the create-new row when
  // there are no matches at all, matching what's actually shown on screen.
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || menuItemCount === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex((i) => (i + 1) % menuItemCount)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex((i) => (i - 1 + menuItemCount) % menuItemCount)
    } else if (event.key === 'Enter') {
      if (highlightedIndex < visibleOptions.length) {
        event.preventDefault()
        selectOption(visibleOptions[highlightedIndex])
      } else if (showCreateOption) {
        event.preventDefault()
        createNew()
      }
    }
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
          {sequenceStyle && selected.length > 0 ? (
            // One merged sequence for the whole key list (TagPills.tsx /
            // PiecePage.tsx treatment) instead of one pill per key — the
            // "›" between entries is what needs to survive into the
            // input, since it's the only thing showing the keys are
            // ordered, not an unordered set of tags. No pill background
            // here — this sits inside the input's own bordered box, so a
            // second nested pill would be redundant chrome. Plain
            // typed-text styling (text-sm text-ink), not the accent pill
            // look, since it's no longer a pill. Each key still gets its
            // own small remove button, tucked close against its name (not
            // evenly spaced like the chevron) so it reads as belonging to
            // that key specifically.
            <span className="flex flex-wrap items-center gap-1.5 text-sm text-ink">
              {selected.map((tag, index) => (
                // Composite key (id + position) rather than just tag.id —
                // two entries can legitimately share an id with
                // allowDuplicates.
                <span key={`${tag.id}-${index}`} className="flex items-center gap-1.5">
                  {index > 0 && (
                    // A real icon, not a "›" text glyph — a character
                    // glyph sits off-center in its own em-box by whatever
                    // the font's metrics happen to be, so no amount of
                    // flex/line-height centering lines it up reliably
                    // against the key names next to it. An icon component
                    // has a known, symmetric bounding box, so items-center
                    // on the row actually centers it.
                    //
                    // arrow-right (not chevron-right), full-opacity
                    // text-ink-soft — settled after comparing 15 outline/
                    // filled candidates directly in this field. Not
                    // clickable (no onClick, no hover state, no cursor
                    // change), so it doesn't need to be faint to read as
                    // inert. Deliberately scoped to this editable field
                    // only — the read-only key-sequence pills elsewhere
                    // (TagPills.tsx, PiecePage.tsx/PieceViewSample.tsx)
                    // keep their own plain "›" text-glyph separator,
                    // untouched.
                    <IconArrowRight
                      size={15}
                      className="shrink-0 text-ink-soft"
                      aria-hidden="true"
                    />
                  )}
                  <span className="flex items-center gap-0.5">
                    <span>{tag.name}</span>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        removeTagAt(index)
                      }}
                      aria-label={`Remove ${tag.name}`}
                      // Solid pre-blend, not opacity (feedback-icon-color-preblend).
                      className="text-[#8d8780] hover:text-ink"
                    >
                      <IconXFilled size={12} />
                    </button>
                  </span>
                </span>
              ))}
            </span>
          ) : (
            selected.map((tag, index) => (
              // Composite key (id + position) rather than just tag.id —
              // two pills can legitimately share an id with
              // allowDuplicates.
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
            ))
          )}
          {showInput && (
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setOpen(true)
                setHighlightedIndex(0)
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={handleKeyDown}
              placeholder={selected.length === 0 ? 'Type to search or add…' : ''}
              className="min-w-[100px] flex-1 border-none bg-transparent text-sm text-ink outline-none focus-visible:outline-none"
            />
          )}
        </div>
        {open && showInput && (filtered.length > 0 || query.trim()) && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-paper-raised py-1 shadow-lg">
            {visibleOptions.map((opt, index) => (
              <button
                key={opt.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(opt)}
                className={`block w-full px-3 py-2 text-left text-sm text-ink hover:bg-accent-soft ${
                  index === highlightedIndex ? 'bg-accent-soft' : ''
                }`}
              >
                {opt.name}
              </button>
            ))}
            {showCreateOption && (
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={createNew}
                className={`block w-full px-3 py-2 text-left text-sm text-accent hover:bg-accent-soft ${
                  highlightedIndex === visibleOptions.length ? 'bg-accent-soft' : ''
                }`}
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
