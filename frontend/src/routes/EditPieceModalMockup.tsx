import { useRef, useState, type ReactNode } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { IconChevronDown, IconChevronRight, IconInfoCircle, IconXFilled } from '@tabler/icons-react'
import { Modal } from '../components/Modal'
import { InfoTooltip } from '../components/InfoTooltip'
import { useMockupTitle } from '../lib/useMockupTitle'

// ---------------------------------------------------------------------
// DESIGN MOCKUP — not wired to the API, no real mutations. Exists to lock
// in the Piece Properties Edit Menu's visual design (design doc §15)
// before building it for real, same review-before-code pattern as the
// Piece View (see project memory "frontend-piece-view"). Route is
// unlinked from nav — visit /mockup/edit-piece-modal directly.
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
]
const SHEET_TYPE_OPTIONS: TagOption[] = [
  { id: 1, name: 'Lead Sheet' },
  { id: 2, name: 'Solo Part' },
  { id: 3, name: 'Ensemble Score' },
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
  bookTitle: 'Album für die Jugend, Op. 68',
  composer: 'Robert Schumann',
  yearWritten: '1848',
  sheetType: SHEET_TYPE_OPTIONS[3],
  publisher: 'G. Schirmer',
  publisherId: 'HL50252950',
  imslpNumber: 'IMSLP04154',
  instruments: [INSTRUMENT_OPTIONS[0]],
}

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
}: {
  label: string
  options: TagOption[]
  selected: TagOption[]
  multiple: boolean
  onChange: (next: TagOption[]) => void
  bookValue?: string
  onCopy?: () => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Stable, decrementing negative IDs for on-the-fly "new tag" entries in
  // this mockup — avoids calling an impure function like Date.now() from
  // a component (real code will get real IDs back from the create-tag API
  // call instead).
  const nextNewTagId = useRef(-1)

  const filtered = options
    .filter((o) => !selected.some((s) => s.id === o.id))
    .filter((o) => o.name.toLowerCase().includes(query.toLowerCase()))
  const exactMatch = options.some((o) => o.name.toLowerCase() === query.trim().toLowerCase())

  function selectOption(opt: TagOption) {
    onChange(multiple ? [...selected, opt] : [opt])
    setQuery('')
    if (!multiple) setOpen(false)
    inputRef.current?.focus()
  }

  function createNew() {
    if (!query.trim()) return
    selectOption({ id: nextNewTagId.current--, name: query.trim() })
  }

  function removeTag(id: number) {
    onChange(selected.filter((s) => s.id !== id))
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
          {selected.map((tag) => (
            <span
              key={tag.id}
              className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent"
            >
              {tag.name}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  removeTag(tag.id)
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

export function EditPieceModalMockup() {
  useMockupTitle('Edit Piece Modal')

  const [open, setOpen] = useState(true)
  const [tempoOpen, setTempoOpen] = useState(false)
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
    console.log('Mockup submit (no real save):', data)
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
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="edit-piece-mockup-title" className="font-display text-2xl text-ink">
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

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="f-title" className="text-sm text-ink-soft">
                Title
              </label>
              <input
                id="f-title"
                className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                {...register('title', { required: 'Title is required.', maxLength: 255 })}
              />
              {errors.title && <p className="text-sm text-red-700">{errors.title.message}</p>}
            </div>
            {/* Composer/Arranger share a row once there's room for both at
                their 250px minimum (matches Modal's size="lg" comfortably);
                below that they stack, same as every other field here. */}
            <div className="flex flex-wrap gap-3">
              <div className="flex min-w-[250px] flex-1 flex-col gap-1">
                <label htmlFor="f-composer" className="text-sm text-ink-soft">
                  Composer
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
              <div className="flex min-w-[250px] flex-1 flex-col gap-1">
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

          {/* Classification */}
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <SectionHeading>Classification</SectionHeading>
            {/* A piece can genuinely be written in more than one key (e.g.
                a piece that modulates, or a medley) — multi-select, same
                combobox/pill pattern as Instruments/Your Tags below, not
                the single-select treatment Sheet Type gets. */}
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
                />
              )}
            />
            {/* Sheet Type is a small fixed lookup (4 seeded values) — a
                single-select dropdown, not a searchable combobox/pill;
                there's nothing to filter and only one value ever applies.
                Still custom-styled (SingleSelect), same as Practice status
                below, for visual consistency with the rest of the form. */}
            <Controller
              name="sheetType"
              control={control}
              render={({ field }) => (
                <SingleSelect
                  label="Sheet Type"
                  options={SHEET_TYPE_SELECT_OPTIONS}
                  value={field.value}
                  onChange={field.onChange}
                  bookValue={mockBook.sheetType.name}
                  onCopy={() => field.onChange(mockBook.sheetType.name)}
                />
              )}
            />
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
            <Controller
              name="userTags"
              control={control}
              render={({ field }) => (
                <TagComboBox
                  label="Your Tags"
                  options={USER_TAG_OPTIONS}
                  selected={field.value}
                  multiple
                  onChange={field.onChange}
                />
              )}
            />
          </div>

          {/* Piece Details */}
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <SectionHeading>Piece Details</SectionHeading>
            {/* Opus/Year written share a row on wide viewports, same
                250px-floor pattern as Composer/Arranger above. */}
            <div className="flex flex-wrap gap-3">
              <div className="flex min-w-[250px] flex-1 flex-col gap-1">
                <label htmlFor="f-opus" className="flex items-center gap-1 text-sm text-ink-soft">
                  Opus / catalog no.
                  <InfoTooltip
                    message="If this piece is part of a larger work which has a number assigned, enter that number."
                    ariaLabel="What Opus / catalog no. means"
                    triggerClassName="text-ink-soft/60 hover:text-ink-soft"
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
              <div className="flex min-w-[250px] flex-1 flex-col gap-1">
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
              <div className="flex w-36 shrink-0 flex-col gap-1">
                <label htmlFor="f-publisher-id" className="text-sm text-ink-soft">
                  Publisher ID
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
                bookValue={`${mockBook.publisher} · ${mockBook.publisherId}`}
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
            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-1">
                <label htmlFor="f-page-start" className="text-sm text-ink-soft">
                  Book page start
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
                  Book page end
                </label>
                <input
                  id="f-page-end"
                  type="number"
                  className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                  {...register('sourcePageEnd')}
                />
              </div>
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

          {/* Personal */}
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <SectionHeading>Personal</SectionHeading>
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
            <div className="flex flex-col gap-1">
              <label htmlFor="f-notes" className="text-sm text-ink-soft">
                Your notes
              </label>
              <textarea
                id="f-notes"
                rows={2}
                className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                {...register('userNotes')}
              />
            </div>
          </div>

          {/* Duration — manually entered as mm:ss (this input's whole
              reason to exist), stored server-side as an integer of
              seconds; the frontend only ever shows/accepts mm:ss. The
              tempo-calc fields live behind a small faint disclosure below
              the input — same chevron + text-xs/60 convention as the
              Piece View's own "Tempo details" disclosure (PiecePage.tsx),
              which is itself commented as matching this edit menu; duration
              is what matters day-to-day, the calc fields are a supporting,
              occasionally-needed alternate path to it. */}
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <SectionHeading>Duration</SectionHeading>
            <div className="flex flex-col gap-1">
              <label htmlFor="f-duration" className="text-sm text-ink-soft">
                Duration (mm:ss)
              </label>
              <input
                id="f-duration"
                placeholder="e.g. 3:45"
                className="w-32 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                {...register('duration', {
                  pattern: { value: /^\d+:[0-5]\d$/, message: 'Enter duration as mm:ss (e.g. 3:45).' },
                })}
              />
            </div>
            {errors.duration && <p className="text-sm text-red-700">{errors.duration.message}</p>}
            <div>
              <button
                type="button"
                onClick={() => setTempoOpen((o) => !o)}
                className="flex items-center gap-1 text-xs text-ink-soft/60 hover:text-ink-soft"
              >
                <IconChevronRight
                  size={12}
                  className={`transition-transform ${tempoOpen ? 'rotate-90' : ''}`}
                />
                Calculate from tempo
              </button>
              {tempoOpen && (
                <div className="mt-2 flex flex-wrap items-end gap-3 pl-5">
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
          </div>
        </form>
      </Modal>
    </div>
  )
}
