import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Controller, useForm } from 'react-hook-form'
import {
  IconArrowRight,
  IconChevronDown,
  IconChevronRight,
  IconInfoCircle,
  IconSearch,
  IconXFilled,
} from '@tabler/icons-react'
import { Modal } from '../components/Modal'
import { InfoTooltip } from '../components/InfoTooltip'
import { PageCycleControl } from '../components/PageCycleControl'
import { matchesKeyQuery } from '../lib/keySearch'
import { useMockupTitle } from '../lib/useMockupTitle'

// ---------------------------------------------------------------------
// DESIGN MOCKUP — not wired to the API, no real mutations, still not
// linked from nav (visit /mockup/edit-piece-modal directly). Originally
// built to lock in the Piece Properties Edit Menu's visual design (design
// doc §15) before the real EditPieceModal.tsx existed; kept as its own
// standalone route since (no API/local dev data needed to view the
// design), and manually resynced to the real build on 2026-08-18 after
// several rounds of real-build changes had drifted from it — section
// order (the first section before the second), the collapsible page
// preview, key search aliasing, repeated keys, and current Sheet Type
// values. Its own TagComboBox/SingleSelect/InheritedNote stay local
// duplicates rather than importing the real shared components (this page
// has always been self-contained), but small pure-logic pieces — page
// preview's PageCycleControl, key search's matchesKeyQuery — get imported
// directly, since duplicating actual logic (not just markup) is exactly
// the kind of drift risk this resync exists to avoid repeating.
//
// 2026-08-18 (later same day) — section headings renamed, MOCKUP ONLY,
// pending approval before porting to the real EditPieceModal.tsx: the
// section formerly called "Piece Details" is now "Frontmatter"; the
// section formerly called "Classification" is now "Piece Details". The
// real modal still uses the old names ("Piece Details" / "Classification")
// until this is explicitly approved — don't let the shared name "Piece
// Details" between the old real-modal section and the new mockup section
// cause confusion; they refer to different form sections.
// ---------------------------------------------------------------------

interface TagOption {
  id: number
  name: string
}

const KEY_OPTIONS: TagOption[] = [
  { id: 1, name: 'C Major' },
  { id: 2, name: 'C Minor' },
  { id: 3, name: 'A Minor' },
  { id: 4, name: 'G Major' },
  { id: 5, name: 'D Major' },
  { id: 6, name: 'E Minor' },
  // A flat/sharp key so the "Eb"/"e flat" search-alias behavior
  // (matchesKeyQuery, ../lib/keySearch) is actually demonstrable here —
  // none of the other options above have an accidental to search for.
  { id: 7, name: 'E♭ Major' },
]
// Matches the current seeded sheet_types (migration 00013): "Solo Part"
// renamed to "Solo Piece", "Ensemble Score" renamed to "Ensemble Piece –
// Full Score", and "Ensemble Piece – Part" added alongside it.
const SHEET_TYPE_OPTIONS: TagOption[] = [
  { id: 1, name: 'Lead Sheet' },
  { id: 2, name: 'Solo Piece' },
  { id: 3, name: 'Ensemble Piece – Full Score' },
  { id: 5, name: 'Ensemble Piece – Part' },
  { id: 4, name: 'PVG Score' },
]
const INSTRUMENT_OPTIONS: TagOption[] = [
  { id: 1, name: 'Piano' },
  { id: 2, name: 'Violin' },
  { id: 3, name: 'Cello' },
  { id: 4, name: 'Flute' },
  { id: 5, name: 'Voice' },
]
const USER_TAG_OPTIONS: TagOption[] = [
  { id: 1, name: 'recital candidate' },
  { id: 2, name: 'sight-reading practice' },
  { id: 3, name: 'favorite encore' },
]

const SHEET_TYPE_SELECT_OPTIONS = [
  { value: '', label: '—' },
  ...SHEET_TYPE_OPTIONS.map((o) => ({ value: o.name, label: o.name })),
]
const PRACTICE_STATUS_OPTIONS = [
  { value: '', label: 'No status set' },
  { value: 'Want to Learn', label: 'Want to Learn' },
  { value: 'Learning', label: 'Learning' },
  { value: 'Learned', label: 'Learned' },
  { value: 'Stalled', label: 'Stalled' },
  { value: 'Dropped', label: 'Dropped' },
]

const mockBook = {
  id: 1,
  bookTitle: 'Album für die Jugend, Op. 68',
  composer: 'Robert Schumann',
  yearWritten: '1848',
  sheetType: SHEET_TYPE_OPTIONS[4],
  publisher: 'G. Schirmer',
  publisherId: 'HL50252950',
  imslpNumber: 'IMSLP04154',
  instruments: [INSTRUMENT_OPTIONS[0]],
}

// Candidate books for the Source Book search field below — standing in for
// a real GET /api/books?q=... lookup (same list this mockup's sibling
// route, BooksLibrarySample.tsx, seeds its own gallery with, so the two
// mockups feel like they're describing the same library). mockBook above
// is always option [0] here, so the field's default text matches the
// piece's actual current source book.
const SOURCE_BOOK_OPTIONS = [
  { id: 1, bookTitle: 'Album für die Jugend, Op. 68' },
  { id: 2, bookTitle: 'The Real Book — Sixth Edition' },
  { id: 3, bookTitle: '24 Préludes, Op. 28' },
  { id: 4, bookTitle: 'Sonatas and Partitas for Solo Violin' },
  { id: 5, bookTitle: 'Piano Sonatas, Volume I' },
  { id: 6, bookTitle: 'Anthology of American Folk Songs' },
  { id: 7, bookTitle: 'Suite bergamasque' },
  { id: 8, bookTitle: 'The Nutcracker Suite, Op. 71a (Piano Reduction)' },
]

// Deliberately mixes overridden and inherited book-inheritable fields, so
// both states of the "Inherited from book" UI are visible at once:
// composer/sheetType/instruments/publisher/publisherId/yearWritten/
// imslpNumber are blank on the piece (inherited); workOpusNumber and
// description are the piece's own explicit values (overridden).
interface FormValues {
  title: string
  composer: string
  arranger: string
  keys: TagOption[]
  sheetType: string
  instruments: TagOption[]
  userTags: TagOption[]
  workOpusNumber: string
  publisher: string
  publisherId: string
  yearWritten: string
  imslpNumber: string
  description: string
  userNotes: string
  practiceStatus: string
  sourceBookId: number | null
  sourcePageStart: string
  sourcePageEnd: string
  duration: string
  bpm: string
  measureCount: string
  beatsPerMeasure: string
}

// Two keys selected deliberately (not one), to actually demonstrate "a
// piece can have multiple keys" rather than just leaving the capability
// theoretical — this piece is imagined as modulating from A minor to C
// major partway through.
const defaultValues: FormValues = {
  title: 'No. 9, Volksliedchen (Little Folk Song)',
  composer: '',
  arranger: 'Louis Köhler',
  keys: [KEY_OPTIONS[2], KEY_OPTIONS[0]],
  sheetType: '',
  instruments: [],
  userTags: [{ id: 1, name: 'recital candidate' }],
  workOpusNumber: 'Op. 68, No. 9',
  publisher: '',
  publisherId: '',
  yearWritten: '',
  imslpNumber: '',
  description: "A short, wistful A-minor miniature from the Album — one of the more melancholy entries.",
  userNotes: 'Left hand voicing in m.9 keeps tripping me up — slow it down to 60bpm next time.',
  practiceStatus: 'Learning',
  sourceBookId: mockBook.id,
  sourcePageStart: '22',
  sourcePageEnd: '24',
  duration: '1:35',
  bpm: '88',
  measureCount: '35',
  beatsPerMeasure: '3',
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-xs font-medium tracking-wide text-ink-soft/70 uppercase">{children}</h3>
  )
}

// Stand-in for a real page image (this mockup has no piece.id to build a
// real getPieceThumbnailUrl(...) call against) — same drawn-SVG-page
// pattern PieceViewSample.tsx uses for its own preview, kept as its own
// local copy rather than a shared import since every mockup route here is
// self-contained.
function SheetPagePlaceholder({ page }: { page: number }) {
  return (
    <svg
      viewBox="0 0 200 260"
      width={200}
      height={260}
      className="h-auto w-full"
      role="img"
      aria-label={`Page ${page} preview`}
    >
      <rect x="0.5" y="0.5" width="199" height="259" fill="#fffdf9" stroke="#e4e0d8" />
      <text x="100" y="26" textAnchor="middle" fontFamily="Georgia, serif" fontSize="9" fill="#5c5349">
        Volksliedchen
      </text>
      {[55, 88, 121, 154, 187, 220].map((y) => (
        <g key={y} stroke="#c9c2b6" strokeWidth="0.5">
          {[0, 3.5, 7, 10.5, 14].map((offset) => (
            <line key={offset} x1="18" x2="182" y1={y + offset} y2={y + offset} />
          ))}
        </g>
      ))}
      <text x="184" y="248" textAnchor="end" fontFamily="Georgia, serif" fontSize="7" fill="#8f857a">
        {page}
      </text>
    </svg>
  )
}

// Strips a leading "IMSLP" label before a save, matching
// EditPieceModal.tsx's real behavior exactly — mockup's onSubmit only
// logs, but the transform itself is worth mirroring since it's the
// visible reason a value like "IMSLP04154" doesn't render doubled in the
// citation ("IMSLP #IMSLP04154").
function stripImslpPrefix(value: string): string {
  return value.replace(/^\s*imslp[\s:#-]*/i, '')
}

// A piece not tied to any real uploaded file still needs a page count and
// starting page for the mock preview panel below.
const MOCK_PAGE_COUNT = 3
const MOCK_THUMBNAIL_PAGE = 1

// Shown under a book-inheritable field only while the piece's own value is
// empty (design doc §15) — gone the moment it has a value, typed or
// copied. `onCopy` performs the one-time copy, not an ongoing link.
function InheritedNote({ bookValue, onCopy }: { bookValue: string; onCopy: () => void }) {
  if (!bookValue) return null
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-ink-soft">
      <span>
        Inherited from book: <span className="text-ink italic">{bookValue}</span>
      </span>
      <button type="button" onClick={onCopy} className="shrink-0 text-accent hover:underline">
        Copy from book
      </button>
    </div>
  )
}

function TagComboBox({
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
  options: TagOption[]
  selected: TagOption[]
  multiple: boolean
  onChange: (next: TagOption[]) => void
  bookValue?: string
  onCopy?: () => void
  // Overrides the default plain-substring match — the Key(s) picker below
  // passes matchesKeyQuery (../lib/keySearch.ts) so typing "Eb" or
  // "e flat" finds "E♭ Major", not just a literal "♭" match.
  filterOption?: (option: TagOption, query: string) => boolean
  // Lets an already-selected option be picked again — the Key(s) picker
  // needs this for a piece that modulates back to a key it already used.
  // Off by default: Instruments/Your Tags have no reason to hold the same
  // tag twice.
  allowDuplicates?: boolean
  // Renders the selected values as one merged, ordered sequence ("›"
  // chevron between entries) instead of one independent pill per value —
  // matches how the Piece View / TagPills already display a piece's key
  // sequence (PiecePage.tsx, TagPills.tsx), so the input looks like the
  // thing it's editing. Each key keeps its own remove button; only the
  // pill-per-key wrapper is replaced, not the removability. Key(s)-only —
  // Instruments/Your Tags aren't ordered, so they keep the
  // independent-pill treatment.
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
  // Stable, decrementing negative IDs for on-the-fly "new tag" entries in
  // this mockup — avoids calling an impure function like Date.now() from
  // a component (real code will get real IDs back from the create-tag API
  // call instead).
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

  function selectOption(opt: TagOption) {
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
            // "›" chevron between entries is what actually needs to
            // survive into the input, since it's the only thing showing
            // the keys are ordered, not an unordered set of tags. No pill
            // background or icon here (unlike the read-only display
            // elsewhere) — this sits inside the input's own bordered box,
            // so a second nested pill/icon would be redundant chrome. Each
            // key still gets its own small remove button, right after its
            // name and before the next chevron, so removability isn't
            // lost by merging the pills.
            // No pill background left to carry the accent-green pill
            // text style either — this now reads as plain typed field
            // content (text-sm text-ink, same as the query input below),
            // not a tag/label anymore.
            <span className="flex flex-wrap items-center gap-1.5 text-sm text-ink">
              {selected.map((tag, index) => (
                // Composite key (id + position) rather than just tag.id —
                // two entries can legitimately share an id with
                // allowDuplicates.
                <span key={`${tag.id}-${index}`} className="flex items-center gap-1.5">
                  {index > 0 && (
                    // A real icon, not a text glyph — a "›" character's
                    // glyph sits inside its own em-box off-center by
                    // whatever the font's metrics happen to be, so no
                    // amount of flex/line-height centering lines it up
                    // reliably against the key names next to it. An icon
                    // component has a known, symmetric bounding box, so
                    // items-center on the row actually centers it.
                    //
                    // arrow-right, not chevron-right — settled after
                    // comparing 15 outline/filled candidates directly in
                    // this field (see the removed gallery this route used
                    // to render above the modal). Deliberately scoped to
                    // this *editable* field only: the read-only pill
                    // displays elsewhere (TagPills.tsx, PiecePage.tsx/
                    // PieceViewSample.tsx's own key sequence) keep their
                    // existing plain "›" text-glyph separator, untouched —
                    // a distinct, simpler treatment for a non-interactive
                    // context, not something this decision overrides.
                    // Full-opacity text-ink-soft (not clickable — no
                    // onClick, no hover state, no cursor change — so it
                    // doesn't need to be faint to read as inert; darker is
                    // just more legible as a separator).
                    <IconArrowRight
                      size={15}
                      className="shrink-0 text-ink-soft"
                      aria-hidden="true"
                    />
                  )}
                  {/* Tighter gap than the outer row (0.5 vs 1.5) — the ×
                      belongs to this key specifically, so it should read
                      as attached to its name, not evenly spaced between
                      the name and the next key's chevron. */}
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

// A single value from a small fixed option list (Sheet Type, Practice
// Status) — same custom-styled trigger/panel treatment as TagComboBox
// above for visual consistency (a bare native <select> renders with the
// browser/OS's own chrome, which doesn't match the rest of this form), but
// deliberately no pill: picking a value just sets it in place, since
// there's only ever one and nothing to remove/re-add.
function SingleSelect({
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
  // always 0 since there's always exactly one already-selected option
  // here (TagComboBox has no equivalent "current value" to seed from).
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
    } else if (event.key === 'Enter' || event.key === ' ') {
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
          className="flex w-full items-center justify-between rounded-md border border-border bg-paper-raised px-3 py-2 text-left text-ink focus:outline focus:outline-2 focus:outline-accent focus:outline-offset-2"
        >
          <span className={value ? '' : 'text-ink-soft/50'}>{selected?.label ?? '—'}</span>
          {/* Solid pre-blend, not opacity (feedback-icon-color-preblend). */}
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
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-accent-soft ${
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

// Search-as-you-type book picker for the piece's sourceBookId (Source
// Details, above the page-range fields). Styled like a plain text field
// (Title/Composer above) rather than TagComboBox's pill-input treatment —
// there's exactly one value here, not a set, and it's picked from an
// existing catalog rather than typed/created freehand the way a tag is, so
// it reads better as "search" than "tag entry." A left-aligned search icon
// makes that read obvious at a glance. Real build: options would come from
// a debounced GET /api/books?q=... (design doc §11's existing search-as-
// you-type convention), and selecting a result is what actually sets the
// piece's sourceBookId — this field IS the book-selection mechanism, not a
// display of it.
function SourceBookField({
  value,
  onChange,
  options,
}: {
  value: number | null
  onChange: (next: number | null) => void
  options: { id: number; bookTitle: string }[]
}) {
  const selectedBook = options.find((b) => b.id === value)
  const [query, setQuery] = useState(selectedBook?.bookTitle ?? '')
  const [open, setOpen] = useState(false)
  // Which result row Enter would pick — arrow keys move it, typing resets
  // it back to 0. Every dropdown-style field in this app must support
  // ArrowUp/Down/Enter, not just TagComboBox/SingleSelect.
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = options
    .filter((b) => b.bookTitle.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 6)

  function selectBook(book: { id: number; bookTitle: string }) {
    onChange(book.id)
    setQuery(book.bookTitle)
    setHighlightedIndex(0)
    setOpen(false)
    inputRef.current?.blur()
  }

  // ArrowUp/Down cycles the highlighted result (wrapping both ends);
  // Enter picks whichever row is currently highlighted. No create-new row
  // to fall through to here (unlike TagComboBox) — a source book must
  // already exist, so Enter is simply a no-op when there are no results.
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || filtered.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex((i) => (i + 1) % filtered.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex((i) => (i - 1 + filtered.length) % filtered.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      selectBook(filtered[highlightedIndex])
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="f-source-book" className="flex items-center gap-1 text-sm text-ink-soft">
        Source book
        <InfoTooltip
          message="Use this to match with an existing book. If the book hasn't been created yet, go do that and come back here."
          ariaLabel="What Source book means"
          // Solid pre-blend, not opacity (feedback-icon-color-preblend).
          triggerClassName="text-[#9d9892] hover:text-ink-soft"
        >
          <IconInfoCircle size={13} />
        </InfoTooltip>
      </label>
      <div className="relative">
        <IconSearch
          size={15}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#9d9892]"
        />
        <input
          ref={inputRef}
          id="f-source-book"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            setHighlightedIndex(0)
            // Typing invalidates whatever was previously selected until a
            // suggestion is actually clicked — same "no half-matched state"
            // principle as TagComboBox, just without a create-new fallback
            // (a source book is picked from the existing catalog, not
            // typed into existence here).
            if (event.target.value !== selectedBook?.bookTitle) onChange(null)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder="Search books by title…"
          className="w-full rounded-md border border-border bg-paper-raised py-2 pr-3 pl-9 text-ink"
        />
        {open && query.trim() !== '' && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-paper-raised py-1 shadow-lg">
            {filtered.length > 0 ? (
              filtered.map((book, index) => (
                <button
                  key={book.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectBook(book)}
                  className={`block w-full px-3 py-2 text-left text-sm hover:bg-accent-soft ${
                    book.id === value ? 'text-accent' : 'text-ink'
                  } ${index === highlightedIndex ? 'bg-accent-soft' : ''}`}
                >
                  {book.bookTitle}
                </button>
              ))
            ) : (
              <p className="px-3 py-2 text-sm text-ink-soft/60 italic">No matching books</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function EditPieceModalMockup() {
  useMockupTitle('Edit Piece Modal')

  const [open, setOpen] = useState(true)
  const [tempoOpen, setTempoOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewPage, setPreviewPage] = useState(MOCK_THUMBNAIL_PAGE)
  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues })

  const composer = watch('composer')
  const bpm = Number(watch('bpm'))
  const measureCount = Number(watch('measureCount'))
  const beatsPerMeasure = Number(watch('beatsPerMeasure'))
  const canCalculateDuration = bpm > 0 && measureCount > 0 && beatsPerMeasure > 0

  // Mirrors the backend's computeDuration (internal/handlers/piece_write.go)
  // exactly — (measureCount × beatsPerMeasure ÷ bpm) × 60, in seconds —
  // truncated the same way (int(), not rounded), so a value this button
  // fills in matches what the server would derive from the same three
  // inputs. Button-triggered rather than auto-calculated on every
  // keystroke: this is a one-shot "fill in from tempo" convenience, not a
  // live-bound computed field (design doc §3's real computed-duration
  // semantics still apply server-side, independent of this manual field —
  // see the "Open question" note in memory about how the two reconcile).
  function handleCalculateDuration() {
    if (!canCalculateDuration) return
    const totalSeconds = Math.trunc(((measureCount * beatsPerMeasure) / bpm) * 60)
    const mm = Math.floor(totalSeconds / 60)
    const ss = totalSeconds % 60
    setValue('duration', `${mm}:${String(ss).padStart(2, '0')}`)
    clearErrors('duration')
  }

  function onSubmit(data: FormValues) {
    const effectiveComposer = data.composer.trim() || mockBook.composer
    if (!effectiveComposer) {
      setError('composer', { message: 'Composer is required (own value or inherited from book).' })
      return
    }
    clearErrors('composer')
    console.log('Mockup submit (no real save):', { ...data, imslpNumber: stripImslpPrefix(data.imslpNumber) })
    setOpen(false)
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6 md:p-8">
      <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
        Design mockup — <span className="font-medium text-ink">Piece Properties Edit Menu</span>{' '}
        (design doc §15). Not wired to real data.
      </div>

      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-fit rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
        >
          Reopen mockup
        </button>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        labelledBy="edit-piece-mockup-title"
        size="lg"
        header={
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="edit-piece-mockup-title" className="font-display text-2xl font-medium text-ink">
                  Edit piece
                </h2>
                <p className="text-sm text-ink-soft">{defaultValues.title}</p>
              </div>
              {/* Favorite lives on the Piece View's own header now (that
                  page already has its own real toggle) — editing it a
                  second time from here was redundant. A close button here
                  instead, now that Cancel/Save live in the sticky footer
                  below and might not always be in view while scrolling. */}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="mt-1 shrink-0 text-ink-soft hover:text-accent"
              >
                <IconXFilled size={22} />
              </button>
            </div>

            {/* Page preview — pinned here (Modal's `header` slot) rather
                than inside the scrolling form, so it can't scroll out of
                view while the fields below it do. Starts closed; toggling
                it open only adds height here, never changes the modal's
                width. Toggle + collapsible panel share one non-gapped
                wrapper, not two direct children of the outer `gap-3` flex
                column — a flex `gap` reserves its full space between every
                pair of siblings regardless of whether one is visually
                collapsed to zero height.

                border-b lives on THIS wrapper, not inside the collapsible
                panel below (where it used to be, conditional on
                previewOpen) — a border on the panel itself disappears
                along with everything else once max-h collapses to 0, so
                the header had no bottom edge at all in the (default)
                closed state, and the transition into the scrolling form
                content below read as abrupt once a user actually started
                scrolling. This wrapper never collapses, so the line is
                always there, right under the toggle button when closed
                and right under the preview when open.

                -mx-6 + px-6 (bleeding past this header's own padding, then
                adding it straight back as this element's own padding) full-
                bleeds the line to the dialog's true edges instead of
                stopping at the same content width as the fields below.
                Back to the standard 1px weight used everywhere else in
                this modal (tried 1.5px briefly to make it read as more of
                a structural divider; reverted — 1px plus the full-bleed
                already does that job). */}
            <div className="-mx-6 border-b border-border px-6 pb-3">
              <button
                type="button"
                onClick={() => setPreviewOpen((o) => !o)}
                className="flex w-fit items-center gap-1.5 rounded-full border border-border bg-paper px-3 py-1.5 text-xs text-ink-soft hover:text-ink"
              >
                {/* Points right (toward the label) while folded, rotates
                    to point down once open, matching the panel expanding
                    downward beneath it. */}
                <IconChevronDown
                  size={13}
                  className={`transition-transform ${previewOpen ? '' : '-rotate-90'}`}
                />
                {previewOpen ? 'Hide page preview' : 'Show page preview'}
              </button>
              <div
                className={`overflow-hidden transition-[max-height] duration-200 ease-in-out ${
                  previewOpen ? 'max-h-[420px]' : 'max-h-0'
                }`}
              >
                <div className="flex flex-col gap-2 pt-3 pb-1">
                  <div className="max-h-[280px] overflow-y-auto rounded-md border border-border bg-paper-sunken">
                    <SheetPagePlaceholder page={previewPage} />
                  </div>
                  <div className="flex justify-center">
                    <PageCycleControl
                      page={previewPage}
                      pageCount={MOCK_PAGE_COUNT}
                      onChange={setPreviewPage}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        }
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="edit-piece-form"
              className="rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90"
            >
              Save
            </button>
          </div>
        }
      >
        <form id="edit-piece-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="f-title" className="text-sm text-ink-soft">
                Title <span className="text-ink-soft/60 italic">(Required)</span>
              </label>
              <input
                id="f-title"
                className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                {...register('title', { required: 'Title is required.', maxLength: 255 })}
              />
              {errors.title && <p className="text-sm text-red-700">{errors.title.message}</p>}
            </div>
            {/* Composer/Arranger share a row — min-[525px]:flex-row, the
                same fixed breakpoint every paired row in this form uses
                now (unified 2026-08-20; previously each row wrapped at
                its own content-driven flex-wrap point, so the form
                visibly staggered as the modal narrowed — see Key(s)/
                Duration and Personal below, which established this
                breakpoint first). min-w-0 (not the old min-w-[250px]
                floor) so Composer can shrink freely once paired
                side-by-side above 525px. */}
            <div className="flex flex-col gap-3 min-[525px]:flex-row">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor="f-composer" className="text-sm text-ink-soft">
                  Composer <span className="text-ink-soft/60 italic">(Required)</span>
                </label>
                <input
                  id="f-composer"
                  placeholder={!composer ? mockBook.composer : undefined}
                  className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-soft/40 placeholder:italic"
                  {...register('composer', { maxLength: 255 })}
                />
                {errors.composer && <p className="text-sm text-red-700">{errors.composer.message}</p>}
                {!composer && (
                  <InheritedNote
                    bookValue={mockBook.composer}
                    onCopy={() => setValue('composer', mockBook.composer)}
                  />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor="f-arranger" className="text-sm text-ink-soft">
                  Arranger
                </label>
                <input
                  id="f-arranger"
                  className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                  {...register('arranger', { maxLength: 255 })}
                />
              </div>
            </div>
          </div>

          {/* Frontmatter (was "Piece Details" — renamed, see Classification below) */}
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <SectionHeading>Frontmatter</SectionHeading>
            {/* Opus/Year written share a row — min-[525px]:flex-row, same
                unified breakpoint as every other paired row in this form
                (see Composer/Arranger above). */}
            <div className="flex flex-col gap-3 min-[525px]:flex-row">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor="f-opus" className="flex items-center gap-1 text-sm text-ink-soft">
                  Opus / catalog no.
                  <InfoTooltip
                    message="If this piece is part of a larger work which has a number assigned, enter that number."
                    ariaLabel="What Opus / catalog no. means"
                    // Solid pre-blend, not opacity (feedback-icon-color-preblend).
                    triggerClassName="text-[#9d9892] hover:text-ink-soft"
                  >
                    <IconInfoCircle size={13} />
                  </InfoTooltip>
                </label>
                <input
                  id="f-opus"
                  className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                  {...register('workOpusNumber', { maxLength: 255 })}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor="f-year" className="text-sm text-ink-soft">
                  Year written
                </label>
                <input
                  id="f-year"
                  placeholder={!watch('yearWritten') ? mockBook.yearWritten : undefined}
                  className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-soft/40 placeholder:italic"
                  {...register('yearWritten', { maxLength: 255 })}
                />
                {!watch('yearWritten') && (
                  <InheritedNote
                    bookValue={mockBook.yearWritten}
                    onCopy={() => setValue('yearWritten', mockBook.yearWritten)}
                  />
                )}
              </div>
            </div>
            {/* Publisher/Publisher ID deliberately never wraps to separate
                rows, unlike the min-width-floor pairs above — Publisher
                shrinks (min-w-0 overrides the flex default of refusing to
                shrink below its content width) while Publisher ID keeps a
                short fixed width, so the pair always fits on one line even
                on a narrow phone viewport. */}
            <div className="flex gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor="f-publisher" className="text-sm text-ink-soft">
                  Publisher
                </label>
                <input
                  id="f-publisher"
                  placeholder={!watch('publisher') ? mockBook.publisher : undefined}
                  className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-soft/40 placeholder:italic"
                  {...register('publisher', { maxLength: 255 })}
                />
              </div>
              <div className="flex w-48 shrink-0 flex-col gap-1">
                <label htmlFor="f-publisher-id" className="flex items-center gap-1 text-sm text-ink-soft">
                  Publisher ID
                  <InfoTooltip
                    message="Publisher serial or engraving plate number. Typically found in bottom margin notes."
                    ariaLabel="What Publisher ID means"
                    // Solid pre-blend, not opacity (feedback-icon-color-preblend).
                    triggerClassName="text-[#9d9892] hover:text-ink-soft"
                  >
                    <IconInfoCircle size={13} />
                  </InfoTooltip>
                </label>
                <input
                  id="f-publisher-id"
                  placeholder={!watch('publisherId') ? mockBook.publisherId : undefined}
                  className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-right text-ink placeholder:text-ink-soft/40 placeholder:italic"
                  {...register('publisherId', { maxLength: 255 })}
                />
              </div>
            </div>
            {!watch('publisher') && !watch('publisherId') && (
              <InheritedNote
                bookValue={`${mockBook.publisher} • ${mockBook.publisherId}`}
                onCopy={() => {
                  setValue('publisher', mockBook.publisher)
                  setValue('publisherId', mockBook.publisherId)
                }}
              />
            )}
            <div className="flex flex-col gap-1">
              <label htmlFor="f-imslp" className="text-sm text-ink-soft">
                IMSLP no.
              </label>
              <input
                id="f-imslp"
                placeholder={!watch('imslpNumber') ? mockBook.imslpNumber : undefined}
                className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-soft/40 placeholder:italic"
                {...register('imslpNumber', { maxLength: 255 })}
              />
              {!watch('imslpNumber') && (
                <InheritedNote
                  bookValue={mockBook.imslpNumber}
                  onCopy={() => setValue('imslpNumber', mockBook.imslpNumber)}
                />
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="f-description" className="text-sm text-ink-soft">
                Description
              </label>
              <textarea
                id="f-description"
                rows={3}
                className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                {...register('description')}
              />
            </div>
          </div>

          {/* Book Details (new, was "Source Details") — the book page
              range, split out of Frontmatter into its own section so it
              reads as "where this piece lives inside its source book"
              rather than bundled with the piece's own bibliographic
              fields. Source Book itself (new) sits above the page range —
              picking a different book is the thing that makes "page
              22–24 of what?" answerable, so it reads first. */}
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <SectionHeading>Book Details</SectionHeading>
            <Controller
              name="sourceBookId"
              control={control}
              render={({ field }) => (
                <SourceBookField value={field.value} onChange={field.onChange} options={SOURCE_BOOK_OPTIONS} />
              )}
            />
            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-1">
                <label htmlFor="f-page-start" className="text-sm text-ink-soft">
                  Start page
                </label>
                <input
                  id="f-page-start"
                  type="number"
                  className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                  {...register('sourcePageStart')}
                />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <label htmlFor="f-page-end" className="text-sm text-ink-soft">
                  End page
                </label>
                <input
                  id="f-page-end"
                  type="number"
                  className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                  {...register('sourcePageEnd')}
                />
              </div>
            </div>
          </div>

          {/* Musical Details (was "Piece Details", which was itself renamed
              from "Classification" earlier the same day — Key(s)/Sheet
              Type/Instruments, plus Duration moved down to the end of this
              section below. Your Tags moved out to Personal — it's the
              user's own organizational label, not a musical-classification
              fact about the piece. */}
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <SectionHeading>Musical Details</SectionHeading>
            {/* Key(s)/Duration share a row — Key(s) grows (it can hold an
                arbitrary-length modulation sequence), Duration keeps its
                original fixed width on the right. Stacks to its own row at
                narrow widths (unlike Publisher/Publisher ID, which never
                wraps) — Key(s) genuinely needs room a phone viewport can't
                spare next to a fixed-width Duration. A piece can genuinely
                be written in more than one key (e.g. a piece that
                modulates, or a medley) — multi-select, same combobox/pill
                pattern as Instruments/Your Tags, not the single-select
                treatment Sheet Type gets.

                min-[525px]:flex-row (the Edit Book modal's own breakpoint,
                also used by the Personal section's split below) instead of
                content-driven flex-wrap — deliberately, so the disclosure
                below can key off this exact same breakpoint to match
                Duration's own alignment in both states. flex-wrap's wrap
                point depends on how many keys are selected (an unrelated
                sibling's content), which made it impossible for a plain
                CSS rule elsewhere to reliably tell which state Duration was
                in; a fixed breakpoint sidesteps that entirely. Below
                525px, Duration is a plain stacked block — flex's default
                align-items:stretch doesn't override its own explicit
                width (w-1/2 there, see its own div below), so it sits at
                the column's natural start (left), matching every other
                stacked field in this form. */}
            <div className="flex flex-col gap-3 min-[525px]:flex-row">
              <div className="min-w-0 flex-1">
                <Controller
                  name="keys"
                  control={control}
                  render={({ field }) => (
                    <TagComboBox
                      label="Key(s)"
                      options={KEY_OPTIONS}
                      selected={field.value}
                      multiple
                      onChange={field.onChange}
                      filterOption={(o, q) => matchesKeyQuery(o.name, q)}
                      allowDuplicates
                      sequenceStyle
                    />
                  )}
                />
              </div>
              {/* Duration — used to be its own top-level "Duration" section,
                  then moved to the end of this one; now paired with Key(s)
                  instead. Manually entered as mm:ss (this input's whole
                  reason to exist), stored server-side as an integer of
                  seconds; the frontend only ever shows/accepts mm:ss.
                  w-1/2 while stacked on its own row below 525px (a bare
                  fixed-width box floating alone on an otherwise full-width
                  narrow form read as oddly small) — min-[525px]:w-48
                  restores the fixed width once it's paired with Key(s)
                  again, matching Publisher ID's split point. */}
              <div className="flex w-1/2 flex-col gap-1 min-[525px]:w-48 min-[525px]:shrink-0">
                <label htmlFor="f-duration" className="text-sm text-ink-soft">
                  Duration (mm:ss)
                </label>
                <input
                  id="f-duration"
                  placeholder="e.g. 3:45"
                  className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                  {...register('duration', {
                    pattern: { value: /^\d+:[0-5]\d$/, message: 'Enter duration as mm:ss (e.g. 3:45).' },
                  })}
                />
                {errors.duration && <p className="text-sm text-red-700">{errors.duration.message}</p>}
              </div>
            </div>

            {/* Tempo-calc disclosure — matches Duration's own alignment at
                the same min-[525px] breakpoint the row above uses: left
                (the default, no class needed) while Duration is stacked
                below Key(s), right-aligned once Duration sits paired on
                the right of that row. The revealed BPM/Measures/Beats/
                Calculate row follows the same split. Same chevron +
                text-xs/60 convention as the Piece View's own "Tempo
                details" disclosure (PiecePage.tsx), which is itself
                commented as matching this edit menu; duration is what
                matters day-to-day, the calc fields are a supporting,
                occasionally-needed alternate path to it. */}
            <div className="flex flex-col items-start gap-2 min-[525px]:items-end">
              <button
                type="button"
                onClick={() => setTempoOpen((o) => !o)}
                // Solid pre-blend (icon + label share one color) —
                // feedback-icon-color-preblend.
                className="flex items-center gap-1 text-xs text-[#9d9892] hover:text-ink-soft"
              >
                <IconChevronRight
                  size={12}
                  className={`transition-transform ${tempoOpen ? 'rotate-90' : ''}`}
                />
                Calculate from tempo
              </button>
              {tempoOpen && (
                <div className="flex flex-wrap items-end gap-3 min-[525px]:justify-end">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="f-bpm" className="text-sm text-ink-soft">
                      BPM
                    </label>
                    <input
                      id="f-bpm"
                      type="number"
                      min={1}
                      className="w-24 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                      {...register('bpm', { min: { value: 1, message: 'Must be positive.' } })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="f-measures" className="text-sm text-ink-soft">
                      Measures
                    </label>
                    <input
                      id="f-measures"
                      type="number"
                      min={1}
                      className="w-24 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                      {...register('measureCount', { min: { value: 1, message: 'Must be positive.' } })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="f-beats" className="text-sm text-ink-soft">
                      Beats / measure
                    </label>
                    <input
                      id="f-beats"
                      type="number"
                      min={1}
                      className="w-24 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                      {...register('beatsPerMeasure', { min: { value: 1, message: 'Must be positive.' } })}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleCalculateDuration}
                    disabled={!canCalculateDuration}
                    className="rounded-md border border-border bg-paper-raised px-3 py-2 font-display text-sm text-ink hover:border-accent disabled:pointer-events-none disabled:opacity-40"
                  >
                    Calculate
                  </button>
                </div>
              )}
            </div>

            {/* Sheet Type/Instruments now share a row, same order as
                before. Sheet Type is a small fixed lookup (5 seeded values)
                — a single-select dropdown, not a searchable combobox/pill;
                there's nothing to filter and only one value ever applies.
                Still custom-styled (SingleSelect), same as Practice status
                below, for visual consistency with the rest of the form.
                min-[525px]:flex-row — same unified breakpoint as every
                other paired row in this form. */}
            <div className="flex flex-col gap-3 min-[525px]:flex-row">
              <div className="min-w-0 flex-1">
                <Controller
                  name="sheetType"
                  control={control}
                  render={({ field }) => (
                    <SingleSelect
                      label="Sheet type"
                      options={SHEET_TYPE_SELECT_OPTIONS}
                      value={field.value}
                      onChange={field.onChange}
                      bookValue={mockBook.sheetType.name}
                      onCopy={() => field.onChange(mockBook.sheetType.name)}
                    />
                  )}
                />
              </div>
              <div className="min-w-0 flex-1">
                <Controller
                  name="instruments"
                  control={control}
                  render={({ field }) => (
                    <TagComboBox
                      label="Instruments"
                      options={INSTRUMENT_OPTIONS}
                      selected={field.value}
                      multiple
                      onChange={field.onChange}
                      bookValue={mockBook.instruments.map((i) => i.name).join(', ')}
                      onCopy={() => field.onChange(mockBook.instruments)}
                    />
                  )}
                />
              </div>
            </div>
          </div>

          {/* Personal — Your Tags moved here from Musical Details above
              (it's the user's own organizational label, not a musical fact
              about the piece). Two-column split inspired by the Edit Book
              modal's own closing IMSLP/Sheet Type/Instruments-vs-Description
              row: Practice status/Your tags stacked on the left, Your notes
              spanning the same height on the right — the one genuinely tall
              field gets the one genuinely tall column, same reasoning as
              that row. min-[525px]:flex-row/gap-3, matching that modal's
              breakpoint and gutter exactly — this same breakpoint was later
              adopted (2026-08-20) by every other paired row in this form
              too, so the whole modal now splits to stacked layout at one
              unified point instead of each row wrapping at its own
              content-driven flex-wrap threshold. */}
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <SectionHeading>Personal</SectionHeading>
            <div className="flex flex-col gap-3 min-[525px]:flex-row">
              <div className="flex min-w-0 flex-1 flex-col gap-4">
                <Controller
                  name="practiceStatus"
                  control={control}
                  render={({ field }) => (
                    <SingleSelect
                      label="Practice status"
                      options={PRACTICE_STATUS_OPTIONS}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
                <Controller
                  name="userTags"
                  control={control}
                  render={({ field }) => (
                    <TagComboBox
                      label="Your tags"
                      options={USER_TAG_OPTIONS}
                      selected={field.value}
                      multiple
                      onChange={field.onChange}
                    />
                  )}
                />
              </div>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
                <label htmlFor="f-notes" className="text-sm text-ink-soft">
                  Your notes
                </label>
                <textarea
                  id="f-notes"
                  rows={2}
                  className="min-h-[96px] flex-1 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                  {...register('userNotes')}
                />
              </div>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
