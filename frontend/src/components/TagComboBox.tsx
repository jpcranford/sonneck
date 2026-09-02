import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconArrowRight, IconXFilled } from '@tabler/icons-react'
import type { Tag } from '../api/types'
import { InheritedNote } from './InheritedNote'

// Strips diacritics before comparing — e.g. so typing "Boely" (no
// diaeresis) matches "Alexandre Boëly", found live via the People-picking
// Composer/Arranger fields' default (no custom filterOption) matching.
// NFD decomposition splits a base letter from its combining diacritical
// mark (U+0300-036F covers the whole combining-marks block), so stripping
// that range after normalizing reduces "ë"/"é"/"ö"/etc. down to their
// plain ASCII base letter. Applied to the default substring filter only —
// a caller with its own filterOption (e.g. the Key(s) picker's
// matchesKeyQuery) already handles its own matching semantics and isn't
// touched by this.
function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

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
  newOptionLabel,
  highlighted,
  labelExtra,
  hideLabel,
  pillStyle = 'accent',
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
  // accent pill per value — matches how the Piece Details page / TagPills already
  // display a piece's key sequence (PiecePage.tsx, TagPills.tsx), so the
  // input looks like the thing it's editing. Each key keeps its own
  // remove button; only the pill-per-key wrapper is replaced. Key(s)-only
  // — Instruments/Your Tags aren't ordered, so they keep the
  // independent-pill treatment.
  sequenceStyle?: boolean
  // Overrides the create-new row's leading label — every existing caller
  // is a genuine "tag" (Key/Instrument/user tag), so 'New tag' stays the
  // default; the Split People modal's replacement picker (composer-
  // arranger overhaul) is the first caller picking real *people*, not
  // tags, so "New tag: 'X'" read wrong there — passes 'New person'
  // instead.
  newOptionLabel?: string
  // Brief highlight ring after an autofill (IMSLP, composer/arranger
  // overhaul Stage C) just filled this field — same `transition-shadow
  // duration-700 ring-2 ring-accent-on-dark` convention every plain-input
  // autofill target already uses elsewhere in this app (EditPieceModal.tsx's
  // Opus/Publisher/etc. fields). Caller clears it after ~2.4s, same timing.
  highlighted?: boolean
  // Extra content appended right after the label text (e.g. an
  // InfoTooltip) — matches the `flex items-center gap-1` label pattern
  // every plain-<label>-based field in this app already uses for this
  // (EditPieceModal.tsx's Year Written/Publisher rows). Needed because
  // TagComboBox renders its own <label> internally, so a caller can't
  // just wrap it in a bigger label element the way a plain <input>
  // field does.
  labelExtra?: ReactNode
  // Skips rendering the internal <label> entirely (not just an empty
  // string, which would still reserve its line height) — for a dense
  // table/grid context where a column header already labels the field
  // once, and repeating it on every row would be redundant. The Book
  // Upload Wizard's "Name each piece" step (UploadBookTitlesMockup.tsx)
  // is the first caller: its desktop layout has one shared column-header
  // row above a list of per-piece TagComboBox fields.
  hideLabel?: boolean
  // Which independent-pill treatment to use — mirrors TagPills.tsx's own
  // accent-vs-neutral split (CLAUDE.md > Frontend): 'accent' (default,
  // bg-accent-soft/text-accent, no border) is for genuinely per-user data
  // (Your Tags), where standing out in the app's accent color is the
  // point. 'paper' (border border-border bg-paper text-ink-soft, the exact
  // classes TagPills.tsx's own neutral keys/sheetType/instruments pills
  // use) is for shared catalog data that just happens to be picked via
  // this same component — Composer/Arranger's Person entities are exactly
  // this (found 2026-09-01: they'd been defaulting to the per-user accent
  // treatment since the Stage C retrofit, which read as claiming they were
  // user-specific data the way Your Tags is). No effect when sequenceStyle
  // is set, which renders no pill background at all.
  pillStyle?: 'accent' | 'paper'
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  // Which menu row (existing options, then the "New tag" row if shown)
  // Enter would act on — arrow keys move it, typing resets it back to 0 so
  // Enter always defaults to "the top result" without requiring a press of
  // ArrowDown first.
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  // Anchors the dropdown (see the portal below) — its own bounding box,
  // not the input's, since selected pills above the input can push the
  // input itself down within this same row.
  const wrapperRef = useRef<HTMLDivElement>(null)
  // Stable, decrementing negative IDs for on-the-fly "new tag" entries —
  // avoids calling an impure function like Date.now() from a component.
  // These are placeholder client-side IDs only; the real ID the backend
  // assigns (via findOrCreate) is looked up by name on submit, not carried
  // through this negative ID.
  const nextNewTagId = useRef(-1)

  const filtered = options
    .filter((o) => allowDuplicates || !selected.some((s) => s.id === o.id))
    .filter((o) =>
      filterOption ? filterOption(o, query) : normalizeForSearch(o.name).includes(normalizeForSearch(query)),
    )
  const exactMatch = options.some((o) => normalizeForSearch(o.name) === normalizeForSearch(query.trim()))
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
  // Backspace with an empty, untyped input removes the pill immediately
  // behind the cursor (the last selected one) — the standard tag-input
  // convention (Gmail's "To" field, etc.), and what a Mac's own "delete"
  // key actually sends (its physical label reads "delete," but it fires
  // the same 'Backspace' key event as a PC's backspace — there's no
  // separate forward-delete case to handle here, since nothing ever sits
  // ahead of the cursor in this field). Checked before the `!open` guard
  // below so it still fires even if the dropdown menu itself has nothing
  // to show (e.g. every option is already selected).
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace' && query === '' && selected.length > 0) {
      event.preventDefault()
      removeTagAt(selected.length - 1)
      return
    }
    if (!open || menuItemCount === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex((i) => (i + 1) % menuItemCount)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex((i) => (i - 1 + menuItemCount) % menuItemCount)
    } else if (event.key === 'Enter' && !event.shiftKey) {
      // Shift+Enter is excluded deliberately: it's this app's "save the
      // form" shortcut everywhere (EditPieceModal/EditBookModal), even
      // while a dropdown is open and
      // would otherwise treat plain Enter as "pick the highlighted row."
      // preventDefault() alone doesn't stop the keydown from bubbling up to
      // the form's own Shift+Enter handler — only skipping this branch
      // entirely does, so Shift+Enter here does nothing but let that outer
      // handler fire.
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
  const menuOpen = open && showInput && (filtered.length > 0 || query.trim() !== '')

  // The dropdown renders through a portal straight to document.body (see
  // the render below) rather than as a plain `position: absolute` child of
  // the wrapper div above — found necessary 2026-08-30 fixing a real
  // reported bug: this field, used inside Modal.tsx's own dialog (e.g. the
  // Split People modal's ordered replacement picker), had its dropdown
  // silently clipped by the dialog's own `overflow-hidden` (needed there
  // for its rounded corners). `overflow: hidden` clips ALL descendants
  // regardless of their own `position` value as long as they remain real
  // DOM descendants of the clipping box — switching to `position: fixed`
  // alone doesn't escape it, only actually moving the element out of that
  // subtree (a portal) does. `[menuRect, setMenuRect]` tracks the
  // wrapper's live screen position so the portaled panel still visually
  // anchors under the field; recomputed on open and kept in sync via
  // resize/scroll listeners — scroll uses the capture phase (same
  // technique ContextMenu.tsx already uses to detect a scroll on an
  // element that wouldn't otherwise bubble to `document`), matching
  // Modal.tsx's own scrollable body being the exact case that needs this.
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    if (!menuOpen) return
    function updatePosition() {
      const el = wrapperRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setMenuRect({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [menuOpen])

  return (
    <div className="flex flex-col gap-1">
      {!hideLabel && (
        <label className="flex items-center gap-1 text-sm text-ink-soft">
          {label}
          {labelExtra}
        </label>
      )}
      <div ref={wrapperRef} className="relative">
        <div
          onClick={() => inputRef.current?.focus()}
          className={`flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-md border border-border bg-paper-raised px-2 py-1.5 transition-shadow duration-700 focus-within:outline focus-within:outline-2 focus-within:outline-accent focus-within:outline-offset-2 ${highlighted ? 'ring-2 ring-accent-on-dark' : ''}`}
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
                    // (TagPills.tsx, PiecePage.tsx/PieceDetailsSample.tsx)
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
                      // Solid pre-blend, not opacity — overlapping icon strokes would re-blend unevenly under real translucency.
                      className="cursor-pointer text-[#8d8780] hover:text-ink"
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
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                  pillStyle === 'paper'
                    ? 'border border-border bg-paper text-ink-soft'
                    : 'bg-accent-soft text-accent'
                }`}
              >
                {tag.name}
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    removeTagAt(index)
                  }}
                  aria-label={`Remove ${tag.name}`}
                  className="cursor-pointer hover:text-ink"
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
              // The visible <label> above isn't programmatically associated
              // with this input (no htmlFor/id pairing) even when shown, so
              // hideLabel — which removes even the visual fallback a sighted
              // user would otherwise read off the column header — gets an
              // explicit aria-label instead, rather than leaving the field
              // with no accessible name at all.
              aria-label={hideLabel ? label : undefined}
              className="min-w-[100px] flex-1 border-none bg-transparent text-sm text-ink outline-none focus-visible:outline-none"
            />
          )}
        </div>
        {menuOpen &&
          menuRect &&
          createPortal(
            <div
              style={{ position: 'fixed', top: menuRect.top, left: menuRect.left, width: menuRect.width }}
              // z-[60] — deliberately higher than any other z-index in the
              // app (max is z-50, Modal's own backdrop/dialog and
              // ContextMenu's popup) so this field's live suggestions
              // always paint above whatever dialog it's opened inside,
              // including that dialog's own footer buttons. Found
              // necessary the moment the portal fix above (escaping a
              // Modal's `overflow-hidden`) was verified live: without
              // this, the portaled panel rendered fully visible but
              // underneath the modal's footer, which silently intercepted
              // every click on it.
              className="z-[60] overflow-hidden rounded-md border border-border bg-paper-raised py-1 shadow-lg"
            >
              {visibleOptions.map((opt, index) => (
                <button
                  key={opt.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(opt)}
                  className={`block w-full cursor-pointer px-3 py-2 text-left text-sm text-ink hover:bg-accent-soft ${
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
                  className={`block w-full cursor-pointer px-3 py-2 text-left text-sm text-accent hover:bg-accent-soft ${
                    highlightedIndex === visibleOptions.length ? 'bg-accent-soft' : ''
                  }`}
                >
                  {newOptionLabel ?? 'New tag'}: "{query.trim()}"
                </button>
              )}
            </div>,
            document.body,
          )}
      </div>
      {selected.length === 0 && bookValue && onCopy && (
        <InheritedNote bookValue={bookValue} onCopy={onCopy} />
      )}
    </div>
  )
}
