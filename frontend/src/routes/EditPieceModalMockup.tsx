import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Controller, useForm } from 'react-hook-form'
import {
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronRightFilled,
  IconCloudDownload,
  IconCloudOff,
  IconInfoCircle,
  IconLoader2,
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
// design). Its own TagComboBox/SingleSelect/InheritedNote stay local
// duplicates rather than importing the real shared components (this page
// has always been self-contained), but small pure-logic pieces — page
// preview's PageCycleControl, key search's matchesKeyQuery — get imported
// directly, since duplicating actual logic (not just markup) is exactly
// the kind of drift risk keeping this in sync by hand is meant to avoid.
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

// Sibling-piece navigation (Option D from the toolbar/nav comparison
// artifact) — three real, fully-loadable pieces from the same source book
// as `defaultValues` above (mockBook, "Album für die Jugend, Op. 68"),
// consecutive numbers either side of No. 9 so stepping through them reads
// as genuinely browsing the book's own piece order, not arbitrary fixture
// data. Only title/workOpusNumber/arranger/description/sourcePageStart/
// sourcePageEnd actually differ per sibling — enough to make the swap
// obvious without needing three fully distinct fixtures. Index 1 (the
// middle one) is `defaultValues` itself, unchanged, so the modal still
// opens on exactly the piece it always has.
const SIBLING_PIECES: FormValues[] = [
  {
    ...defaultValues,
    title: 'No. 8, Wilder Reiter (The Wild Horseman)',
    workOpusNumber: 'Op. 68, No. 8',
    arranger: '',
    description: 'A galloping, energetic showpiece — a favorite recital opener from the Album.',
    sourcePageStart: '20',
    sourcePageEnd: '21',
  },
  defaultValues,
  {
    ...defaultValues,
    title: 'No. 10, Fröhlicher Landmann (The Happy Farmer)',
    workOpusNumber: 'Op. 68, No. 10',
    arranger: '',
    description: "Schumann's best-known miniature from the Album — a cheerful, march-like tune.",
    sourcePageStart: '25',
    sourcePageEnd: '26',
  },
]
const DEFAULT_SIBLING_INDEX = 1

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-xs font-medium tracking-wide text-ink-soft/70 uppercase">{children}</h3>
  )
}

// Stand-in for a real page image (this mockup has no piece.id to build a
// real getPieceThumbnailUrl(...) call against) — same drawn-SVG-page
// pattern PieceDetailsSample.tsx uses for its own preview, kept as its own
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
      <button type="button" onClick={onCopy} className="shrink-0 cursor-pointer text-accent hover:underline">
        Copy from book
      </button>
    </div>
  )
}

// Design doc §13 lists "IMSLP live autofill" as deferred — this is the
// first concrete look at it, mocked up here for feedback before building
// the real thing (the Book Upload Wizard gets its own separate mockup of
// this, since that trigger is automatic-on-upload rather than a manual
// click here — see UploadBookAboutMockup.tsx). Sits inside the IMSLP
// field itself, right-aligned and vertically centered — same placement
// convention as a password field's show/hide toggle — rather than beside
// it, so it reads as acting *on* that field specifically.
//
// Two faint-but-distinct states, not just shown-or-hidden: a bare cloud
// only means "fetchable" when the effective value (piece's own, or the
// book's inherited one) is actually number-only once any "IMSLP" label
// prefix is stripped — the same normalization stripImslpPrefix already
// applies before a real save. Anything else (blank, or text that isn't
// just digits) shows cloud-off instead, fainter still than the fetchable
// state — always visible either way, so the feature is discoverable even
// when there's nothing to fetch yet, rather than disappearing entirely.
// Both are solid pre-blend colors (#9d9892 / #c9c2b6, the same two faint
// tones this codebase already uses elsewhere for "faint icon" and
// "fainter still, disabled-reading" content respectively), never a
// translucent opacity utility — this app's icon-color rule (CLAUDE.md)
// applies here too.
function ImslpAutofillButton({
  state,
  valid,
  onClick,
}: {
  state: 'idle' | 'fetching' | 'done'
  valid: boolean
  onClick: () => void
}) {
  const disabled = !valid || state !== 'idle'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={valid ? 'Autofill blank fields from IMSLP' : 'No IMSLP number to autofill from'}
      title={valid ? 'Autofill blank fields from IMSLP' : 'No IMSLP number to autofill from'}
      className={`absolute top-1/2 right-2.5 flex size-5 -translate-y-1/2 items-center justify-center disabled:cursor-default ${
        valid ? 'cursor-pointer text-[#9d9892] hover:text-accent' : 'text-[#c9c2b6]'
      }`}
    >
      {!valid && <IconCloudOff size={16} />}
      {valid && state === 'idle' && <IconCloudDownload size={16} />}
      {valid && state === 'fetching' && <IconLoader2 size={16} className="animate-spin text-ink-soft" />}
      {valid && state === 'done' && <IconCheck size={16} className="text-accent" />}
    </button>
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
  // matches how the Piece Details page / TagPills already display a piece's key
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
                    // PieceDetailsSample.tsx's own key sequence) keep their
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
          // Solid pre-blend, not opacity — overlapping icon strokes would re-blend unevenly under real translucency.
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
                  className={`block w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-accent-soft ${
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

// Measures an element's real layout height via ResizeObserver's own entry
// data (entry.borderBoxSize), not getBoundingClientRect() — confirmed via
// direct measurement that getBoundingClientRect() was a real source of
// error: Modal's dialog pops in with a CSS `scale-95 -> scale-100`
// transform, and the very first observer callback fires while that
// transform is still mid-animation. getBoundingClientRect() reports the
// *visually rendered* (transform-affected) box, quietly undershooting by
// however much the transform hadn't finished animating yet.
// entry.borderBoxSize is layout size, unaffected by CSS transforms, so
// it's correct from the very first callback. `active` gates whether a
// given resize is actually recorded — used to freeze a measurement (e.g.
// the toggle row's own height should only be captured while the preview
// panel below it is collapsed, not mid-expansion).
function useMeasuredHeight(active = true) {
  const [el, setEl] = useState<Element | null>(null)
  const [height, setHeight] = useState(0)
  const ref = useCallback((node: HTMLElement | null) => setEl(node), [])
  useLayoutEffect(() => {
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      if (!active) return
      const entry = entries[0]
      setHeight(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height)
    })
    observer.observe(el, { box: 'border-box' })
    return () => observer.disconnect()
  }, [el, active])
  return [ref, height] as const
}

export function EditPieceModalMockup() {
  useMockupTitle('Edit Piece Modal')

  const [open, setOpen] = useState(true)
  const [tempoOpen, setTempoOpen] = useState(false)
  // Kept in sync with the real EditPieceModal.tsx: a viewport taller than
  // 800px starts with the preview already open, since there's room for it
  // without dominating the dialog.
  const [previewOpen, setPreviewOpen] = useState(
    () => typeof window !== 'undefined' && window.innerHeight > 800,
  )
  const [previewPage, setPreviewPage] = useState(MOCK_THUMBNAIL_PAGE)

  // Kept in sync with the real EditPieceModal.tsx — see that file's own
  // comment for the full reasoning behind this whole block. Short version
  // of a longer story (two earlier, both-wrong attempts): sizing the
  // preview off the *closed dialog's own rendered height* looks
  // reasonable but is fundamentally the wrong quantity on two separate
  // counts, and both mattered in practice, not just in theory.
  //
  // (1) Self-reference: opening the preview doesn't shrink anything else
  // to make room — Modal's header slot is shrink-0, so the dialog simply
  // grows by however tall the panel is. If the panel is sized to half of
  // the dialog as it existed *before* being added, it ends up as a third
  // of the *grown* total, not a half (T = rest + panel; panel = rest/2
  // gives panel/T = (rest/2)/(1.5*rest) = 1/3). Making the panel equal to
  // "rest" (not half of it) is what actually produces a 50/50 split of
  // the grown total: T = rest + panel = 2*rest, panel/T = 0.5.
  //
  // (2) The closed dialog's rendered height is frequently already less
  // than the true content it's showing — confirmed directly: on a dialog
  // whose fields alone already exceed Modal's max-h-[90vh] cap, the body
  // is already internally scrolling even with the preview collapsed, so
  // "closed dialog height" reads as the 90vh cap itself, not the fields'
  // real (larger) height. Sizing the panel off that number silently
  // treats an already-clipped quantity as if it were the true total, and
  // materially overshoots 50% of the actually-rendered dialog once opened
  // — reproduced directly this way, not a guess.
  //
  // The fix measures the pieces that make up "rest" directly, each
  // unclipped by Modal's own overflow ancestor (a plain child of an
  // overflow:auto parent still reports its own true natural height via
  // ResizeObserver, regardless of whether the *ancestor* is currently
  // clipping/scrolling it) — title block, the toggle row itself (only
  // while collapsed, so the panel's own height never feeds back into the
  // measurement), the scrollable fields area, and the footer:
  const [titleBlockRef, titleBlockHeight] = useMeasuredHeight()
  const [toggleRowRef, toggleRowHeight] = useMeasuredHeight(!previewOpen)
  const [fieldsRef, fieldsHeight] = useMeasuredHeight()
  const [footerRef, footerHeight] = useMeasuredHeight()

  const [viewportHeight, setViewportHeight] = useState(
    () => (typeof window === 'undefined' ? 800 : window.innerHeight),
  )
  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const dialogCapHeight = viewportHeight * 0.9 // matches Modal.tsx's max-h-[90vh]
  const preambleHeight = titleBlockHeight + toggleRowHeight
  const restHeight = preambleHeight + fieldsHeight + footerHeight
  // Uncapped case: panel = restHeight (see (1) above) gives an exact 50%
  // split of a grown-but-still-under-the-cap total (2*restHeight).
  // Capped case (2*restHeight would exceed the dialog's own ceiling):
  // the dialog pins at dialogCapHeight regardless — shrink-0 elements
  // (preamble, panel, footer) never compress to absorb the overflow, only
  // the scrollable fields area does — so hitting 50% of *that* fixed
  // total means solving preambleHeight + panel = 0.5 * dialogCapHeight
  // for panel directly, not deriving it from restHeight at all.
  const previewWrapperMaxHeight =
    restHeight * 2 <= dialogCapHeight
      ? restHeight
      : Math.max(0, dialogCapHeight / 2 - preambleHeight)
  const previewImageMaxHeight = Math.max(0, previewWrapperMaxHeight - 80)
  const {
    register,
    handleSubmit,
    control,
    watch,
    getValues,
    setValue,
    setError,
    clearErrors,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues })

  // Sibling-piece navigation state — see SIBLING_PIECES above. Loading a
  // different sibling reset()s the whole form to that piece's own values
  // (react-hook-form's own documented way to swap in new data), same as
  // EditPersonModal.tsx already does when its own `person` prop changes;
  // this mockup has no such prop, so an explicit call from goToSibling
  // stands in for it. The page preview resets to that piece's own first
  // page too — carrying over the previous piece's page number would be
  // showing the wrong piece's imagined page 3 as if it belonged to this one.
  const [siblingIndex, setSiblingIndex] = useState(DEFAULT_SIBLING_INDEX)
  function goToSibling(newIndex: number) {
    if (newIndex < 0 || newIndex >= SIBLING_PIECES.length) return
    setSiblingIndex(newIndex)
    reset(SIBLING_PIECES[newIndex])
    setPreviewPage(MOCK_THUMBNAIL_PAGE)
  }

  const composer = watch('composer')
  const bpm = Number(watch('bpm'))
  const measureCount = Number(watch('measureCount'))
  const beatsPerMeasure = Number(watch('beatsPerMeasure'))
  const canCalculateDuration = bpm > 0 && measureCount > 0 && beatsPerMeasure > 0

  const [imslpFetchState, setImslpFetchState] = useState<'idle' | 'fetching' | 'done'>('idle')
  // Which fields the *most recent* autofill actually touched — drives a
  // brief highlight ring so it's obvious which values just changed,
  // separate from imslpFetchState (that only tracks the button's own
  // icon/disabled state, not which fields to highlight).
  const [imslpFilledFields, setImslpFilledFields] = useState<Set<string>>(new Set())
  // Effective value first (piece's own, falling back to the book's
  // inherited one — same fallback the field's own placeholder already
  // uses), then stripped of any "IMSLP" label the same way a real save
  // would normalize it, before checking it's actually just digits.
  const effectiveImslpNumber = watch('imslpNumber') || mockBook.imslpNumber
  const isValidImslpNumber = /^\d+$/.test(stripImslpPrefix(effectiveImslpNumber).trim())

  // Mockup only — no real IMSLP lookup happens here; setTimeout stands in
  // for the request. Demonstrates the intended shape of the real feature
  // (design doc §13's deferred "IMSLP live autofill") before it's built:
  // only fills fields currently *blank* on the piece — book-inherited or
  // not — since this is meant to save typing, not silently overwrite
  // something already entered. Publisher/Publisher ID deliberately get a
  // *different* value than the book's own (G. Schirmer/HL50252950) to
  // show that IMSLP is a distinct source, not just repeating whatever
  // inheritance already displays — standing in for a real edition's
  // actual original publisher, which often differs from a modern
  // reprint's.
  function handleImslpAutofill() {
    if (imslpFetchState !== 'idle' || !isValidImslpNumber) return
    setImslpFetchState('fetching')
    window.setTimeout(() => {
      const filled = new Set<string>()
      const current = getValues()
      if (!current.composer) {
        setValue('composer', 'Robert Schumann')
        filled.add('composer')
      }
      if (!current.yearWritten) {
        setValue('yearWritten', '1848')
        filled.add('yearWritten')
      }
      if (!current.publisher) {
        setValue('publisher', 'J. Schuberth & Co.')
        filled.add('publisher')
      }
      if (!current.publisherId) {
        setValue('publisherId', 'Schuberth 2266')
        filled.add('publisherId')
      }
      setImslpFilledFields(filled)
      setImslpFetchState('done')
      window.setTimeout(() => setImslpFetchState('idle'), 1400)
      window.setTimeout(() => setImslpFilledFields(new Set()), 2400)
    }, 900)
  }

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

  // Split into two submit paths now that Save and Save & Close are
  // genuinely different actions (toolbar/nav comparison artifact, Option
  // D) — `closeAfter` is the only thing that differs between them, so both
  // route through this one validate-then-log function rather than
  // duplicating the composer check twice.
  function performSave(data: FormValues, closeAfter: boolean) {
    const effectiveComposer = data.composer.trim() || mockBook.composer
    if (!effectiveComposer) {
      setError('composer', { message: 'Composer is required (own value or inherited from book).' })
      return
    }
    clearErrors('composer')
    console.log(`Mockup submit (no real save, closeAfter=${closeAfter}):`, {
      ...data,
      imslpNumber: stripImslpPrefix(data.imslpNumber),
    })
    if (closeAfter) setOpen(false)
  }
  function onSubmitAndClose(data: FormValues) {
    performSave(data, true)
  }
  function onSubmitStayOpen(data: FormValues) {
    performSave(data, false)
  }

  // Shift+Enter saves (and closes) from anywhere in the form, including a
  // field with its own open dropdown — kept in sync with the real
  // EditPieceModal.tsx; see that file's own comment. Now maps to
  // onSubmitAndClose specifically (not the bare, now-nonexistent onSubmit)
  // since "Save" alone no longer closes — this is still the "from inside a
  // field" path; see the no-field-focused document listener below for the
  // brand new Left/Right/Enter/Shift+Enter shortcuts Option D added.
  function handleFormKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault()
      handleSubmit(onSubmitAndClose)()
    }
  }

  // New with Option D (toolbar/nav comparison artifact): Left/Right cycles
  // siblings, Enter is "Save, keep editing", Shift+Enter is "Save & Close"
  // — but ONLY while nothing text-entry-like has focus, so this never
  // collides with typing in a field (the guard mirrors the tag check
  // PiecePage.tsx/BookDetailsPage.tsx/PersonDetailsPage.tsx already use for
  // their own page-level shortcuts) or with a focused button/link's own
  // native Enter/Space behavior (BUTTON/A aren't in those three pages'
  // existing check — added here specifically because Enter and arrow keys,
  // unlike a plain letter-key shortcut, really do collide with what a
  // focused button already does with them).
  useEffect(() => {
    if (!open) return
    // globalThis.KeyboardEvent, not the bare name — this file's own top
    // import (`type KeyboardEvent` from 'react', used by handleFormKeyDown
    // above) shadows the DOM's native KeyboardEvent, which is the type a
    // real document-level 'keydown' listener actually needs.
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        tag === 'BUTTON' ||
        tag === 'A' ||
        target?.isContentEditable
      ) {
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goToSibling(siblingIndex - 1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        goToSibling(siblingIndex + 1)
      } else if (event.key === 'Enter' && event.shiftKey) {
        event.preventDefault()
        handleSubmit(onSubmitAndClose)()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        handleSubmit(onSubmitStayOpen)()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSubmit is a fresh function identity every render (react-hook-form doesn't memoize it); depending on it would tear down/re-add this listener every render for no behavioral difference. open/siblingIndex are the only real dependencies.
  }, [open, siblingIndex])

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
          className="w-fit cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
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
            <div ref={titleBlockRef} className="flex items-start justify-between gap-4">
              <div>
                <h2 id="edit-piece-mockup-title" className="font-display text-2xl font-medium text-ink">
                  Edit piece
                </h2>
                {/* watch('title'), not the static defaultValues constant —
                    the real component's subtitle mirrors its `piece` prop,
                    and this mockup's nearest equivalent is "whichever
                    sibling is currently loaded," which only the live form
                    value tracks once goToSibling can reset() to a
                    different one. */}
                <p className="text-sm text-ink-soft">{watch('title')}</p>
              </div>
              {/* Favorite lives on the Piece Details page's own header now (that
                  page already has its own real toggle) — editing it a
                  second time from here was redundant. A close button here
                  instead, now that Cancel/Save live in the sticky footer
                  below and might not always be in view while scrolling. */}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="mt-1 shrink-0 cursor-pointer text-ink-soft hover:text-accent"
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
            <div ref={toggleRowRef} className="-mx-6 border-b border-border px-6 pb-3">
              <button
                type="button"
                onClick={() => setPreviewOpen((o) => !o)}
                className="flex w-fit cursor-pointer items-center gap-1.5 rounded-full border border-border bg-paper px-3 py-1.5 text-xs text-ink-soft hover:text-ink"
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
                className="overflow-hidden transition-[max-height] duration-200 ease-in-out"
                style={{ maxHeight: previewOpen ? `${previewWrapperMaxHeight}px` : '0px' }}
              >
                {/* previewImageMaxHeight — kept in sync with the real
                    EditPieceModal.tsx; see that file's comment for the
                    full reasoning. */}
                <div className="flex flex-col gap-2 pt-3 pb-1">
                  <div
                    className="overflow-y-auto rounded-md border border-border bg-paper-sunken"
                    style={{ maxHeight: `${previewImageMaxHeight}px` }}
                  >
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
          // Option D (toolbar/nav comparison artifact): one row, two zones
          // — sibling-piece nav on the left (same "‹ N / M ›" language as
          // PageCycleControl, a hand-rolled local equivalent rather than
          // reusing that component directly, since its aria-labels/count
          // are hardcoded to "page", not "piece"), Cancel/Save/Save & Close
          // on the right. Save & Close is the accent-filled primary action
          // (also the form's native type="submit" target, so a plain Enter
          // pressed *inside* a text field still saves-and-closes, matching
          // this app's existing muscle memory) — plain Save is a secondary,
          // outlined action instead.
          <div ref={footerRef} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1 text-ink-soft">
              <button
                type="button"
                onClick={() => goToSibling(siblingIndex - 1)}
                disabled={siblingIndex <= 0}
                aria-label="Previous piece"
                title={siblingIndex > 0 ? SIBLING_PIECES[siblingIndex - 1].title : undefined}
                className="flex size-7 cursor-pointer items-center justify-center rounded hover:bg-accent-soft hover:text-accent disabled:pointer-events-none disabled:opacity-30"
              >
                <IconChevronLeft size={18} />
              </button>
              <span className="px-1 text-sm tabular-nums">
                {siblingIndex + 1} / {SIBLING_PIECES.length}
              </span>
              <button
                type="button"
                onClick={() => goToSibling(siblingIndex + 1)}
                disabled={siblingIndex >= SIBLING_PIECES.length - 1}
                aria-label="Next piece"
                title={
                  siblingIndex < SIBLING_PIECES.length - 1
                    ? SIBLING_PIECES[siblingIndex + 1].title
                    : undefined
                }
                className="flex size-7 cursor-pointer items-center justify-center rounded hover:bg-accent-soft hover:text-accent disabled:pointer-events-none disabled:opacity-30"
              >
                <IconChevronRightFilled size={18} />
              </button>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleSubmit(onSubmitStayOpen)()}
                className="cursor-pointer rounded-md border border-accent bg-paper-raised px-4 py-2 font-display text-accent hover:bg-accent-soft"
              >
                Save
              </button>
              <button
                type="submit"
                form="edit-piece-form"
                className="cursor-pointer rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90"
              >
                Save &amp; Close
              </button>
            </div>
          </div>
        }
      >
        <form
          ref={fieldsRef}
          id="edit-piece-form"
          onSubmit={handleSubmit(onSubmitAndClose)}
          onKeyDown={handleFormKeyDown}
          className="flex flex-col gap-6"
        >
          <div className="flex flex-col gap-3">
            {/* Title/Year written share a row, 2/3-1/3 split (flex-[2]/
                flex-1) — Title is the field that actually needs the room;
                Year written is short by nature. */}
            <div className="flex flex-col gap-3 min-[525px]:flex-row">
              <div className="flex min-w-0 flex-[2] flex-col gap-1">
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
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor="f-year" className="text-sm text-ink-soft">
                  Year written
                </label>
                <input
                  id="f-year"
                  placeholder={!watch('yearWritten') ? mockBook.yearWritten : undefined}
                  className={`rounded-md border border-border bg-paper-raised px-3 py-2 text-ink transition-shadow duration-700 placeholder:text-ink-soft/40 placeholder:italic ${imslpFilledFields.has('yearWritten') ? 'ring-2 ring-accent-on-dark' : ''}`}
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
            {/* Composer/Arranger share a row — min-[525px]:flex-row, the
                same fixed breakpoint every paired row in this form uses
                (rather than each row wrapping at its own content-driven
                flex-wrap point, which made the form visibly stagger as the
                modal narrowed — see Key(s)/Duration and Personal below,
                which established this breakpoint first). min-w-0 (not the
                old min-w-[250px]
                floor) so Composer can shrink freely once paired
                side-by-side above 525px. */}
            <div className="flex flex-col gap-3 min-[525px]:flex-row">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor="f-composer" className="text-sm text-ink-soft">
                  Composer
                </label>
                <input
                  id="f-composer"
                  placeholder={!composer ? mockBook.composer : undefined}
                  className={`rounded-md border border-border bg-paper-raised px-3 py-2 text-ink transition-shadow duration-700 placeholder:text-ink-soft/40 placeholder:italic ${imslpFilledFields.has('composer') ? 'ring-2 ring-accent-on-dark' : ''}`}
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
            {/* Opus / IMSLP no. share a row, 50/50 — min-[525px]:flex-row,
                same unified breakpoint as every other paired row in this
                form (see Composer/Arranger above). Year written moved up
                to pair with Title instead (2/3-1/3 split, see that row's
                own comment above). */}
            <div className="flex flex-col gap-3 min-[525px]:flex-row">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor="f-opus" className="flex items-center gap-1 text-sm text-ink-soft">
                  Opus / catalog no.
                  <InfoTooltip
                    message="If this piece is part of a larger work which has a number assigned, enter that number."
                    ariaLabel="What Opus / catalog no. means"
                    // Solid pre-blend, not opacity — overlapping icon strokes would re-blend unevenly under real translucency.
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
                <label htmlFor="f-imslp" className="text-sm text-ink-soft">
                  IMSLP no.
                </label>
                {/* relative + pr-9 reserve room for ImslpAutofillButton
                    inside the input itself, right-aligned and vertically
                    centered — same placement convention as a password
                    field's show/hide toggle. Always rendered, not shown-
                    only-when-present — see ImslpAutofillButton's own
                    comment for why the cloud-off state matters just as
                    much as the fetchable one. */}
                <div className="relative">
                  <input
                    id="f-imslp"
                    placeholder={!watch('imslpNumber') ? mockBook.imslpNumber : undefined}
                    className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 pr-9 font-mono text-ink placeholder:text-ink-soft/40 placeholder:italic"
                    {...register('imslpNumber', { maxLength: 255 })}
                  />
                  <ImslpAutofillButton
                    state={imslpFetchState}
                    valid={isValidImslpNumber}
                    onClick={handleImslpAutofill}
                  />
                </div>
                {!watch('imslpNumber') && (
                  <InheritedNote
                    bookValue={mockBook.imslpNumber}
                    onCopy={() => setValue('imslpNumber', mockBook.imslpNumber)}
                  />
                )}
              </div>
            </div>
            {/* Publisher/Publisher ID deliberately never wraps to separate
                rows, unlike the min-width-floor pairs above — both shrink
                freely (min-w-0 overrides the flex default of refusing to
                shrink below content width), so the pair always fits on one
                line even on a narrow phone viewport. Plain 50/50 split
                (flex-1/flex-1, not the old fixed-width Publisher ID). */}
            <div className="flex gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor="f-publisher" className="text-sm text-ink-soft">
                  Publisher
                </label>
                <input
                  id="f-publisher"
                  placeholder={!watch('publisher') ? mockBook.publisher : undefined}
                  className={`w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink transition-shadow duration-700 placeholder:text-ink-soft/40 placeholder:italic ${imslpFilledFields.has('publisher') ? 'ring-2 ring-accent-on-dark' : ''}`}
                  {...register('publisher', { maxLength: 255 })}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor="f-publisher-id" className="flex items-center gap-1 text-sm text-ink-soft">
                  Publisher ID
                  <InfoTooltip
                    message="Publisher serial or engraving plate number. Typically found in bottom margin notes."
                    ariaLabel="What Publisher ID means"
                    // Solid pre-blend, not opacity — overlapping icon strokes would re-blend unevenly under real translucency.
                    triggerClassName="text-[#9d9892] hover:text-ink-soft"
                  >
                    <IconInfoCircle size={13} />
                  </InfoTooltip>
                </label>
                <input
                  id="f-publisher-id"
                  placeholder={!watch('publisherId') ? mockBook.publisherId : undefined}
                  className={`w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink transition-shadow duration-700 placeholder:text-ink-soft/40 placeholder:italic ${imslpFilledFields.has('publisherId') ? 'ring-2 ring-accent-on-dark' : ''}`}
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
              <label htmlFor="f-description" className="text-sm text-ink-soft">
                Description <span className="text-ink-soft/60 italic">(Markdown supported)</span>
              </label>
              <textarea
                id="f-description"
                rows={3}
                className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                {...register('description')}
              />
            </div>
          </div>

          {/* Musical Details (was "Piece Details", which was itself renamed
              from "Classification" earlier the same day — Sheet Type/
              Instruments, then Key(s)/Duration, plus the tempo-calc
              disclosure tied to Duration. Your Tags moved out to Personal —
              it's the user's own organizational label, not a musical-
              classification fact about the piece. */}
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <SectionHeading>Musical Details</SectionHeading>
            {/* Sheet Type/Instruments share a row, first in this section.
                Sheet Type is a small fixed lookup (5 seeded values) — a
                single-select dropdown, not a searchable combobox/pill;
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
                text-xs/60 convention as the Piece Details page's own "Tempo
                details" disclosure (PiecePage.tsx), which is itself
                commented as matching this edit menu; duration is what
                matters day-to-day, the calc fields are a supporting,
                occasionally-needed alternate path to it. */}
            <div className="flex flex-col items-start gap-2 min-[525px]:items-end">
              <button
                type="button"
                onClick={() => setTempoOpen((o) => !o)}
                // Solid pre-blend (icon + label share one color).
                className="flex cursor-pointer items-center gap-1 text-xs text-[#9d9892] hover:text-ink-soft"
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
                    className="cursor-pointer rounded-md border border-border bg-paper-raised px-3 py-2 font-display text-sm text-ink hover:border-accent disabled:pointer-events-none disabled:cursor-default disabled:opacity-40"
                  >
                    Calculate
                  </button>
                </div>
              )}
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
              breakpoint and gutter exactly — this same breakpoint is
              adopted by every other paired row in this form too, so the
              whole modal splits to stacked layout at one
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
                  Your notes <span className="text-ink-soft/60 italic">(Markdown supported)</span>
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

          {/* Book Details (was "Source Details") — the book page range.
              Moved to the very end of the form: it's about where this
              piece lives inside its source book, not a fact about the
              piece itself the way every section above it is, so it reads
              last rather than competing with the piece's own bibliographic
              fields for early attention. Source Book itself sits above the
              page range within this section — picking a different book is
              the thing that makes "page 22–24 of what?" answerable, so it
              still reads first within the section even though the section
              itself moved. */}
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
        </form>
      </Modal>
    </div>
  )
}
