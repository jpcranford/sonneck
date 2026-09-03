import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IconAlertTriangle, IconChevronRight, IconCheck, IconInfoCircle, IconXFilled } from '@tabler/icons-react'
import { updateBook } from '../api/books'
import { lookupImslp } from '../api/imslp'
import { listInstruments, listSheetTypes } from '../api/lookups'
import { listPeople } from '../api/people'
import { getConfig } from '../api/config'
import { ApiError } from '../api/client'
import { afterMinDuration } from '../lib/minDuration'
import { US_RENEWAL_WINDOW_START, US_RENEWAL_WINDOW_END, inUSRenewalWindow } from '../lib/usRenewalWindow'
import type { Book, BookWriteRequest, Tag } from '../api/types'
import { Modal } from './Modal'
import { InfoTooltip } from './InfoTooltip'
import { ImslpAutofillButton } from './ImslpAutofillButton'
import { TagComboBox } from './TagComboBox'
import { SingleSelect } from './SingleSelect'
import { Toggle } from './Toggle'

// The real Book Properties Edit Menu (design doc §16). Every layout/
// behavior decision here mirrors the locked mockup (EditBookModalMockup.tsx,
// /mockup/edit-book-modal, left intact as a standing reference) deliberately
// — if the two ever look different, that's either a bug or a change that
// needs porting to both, not a sign this file is free to diverge. Reached
// from Book View's header pencil (BookDetailsPage.tsx) and Piece Details'
// Source Book card pencil (PiecePage.tsx), both previously inert.
//
// No book-inheritance UI here, unlike EditPieceModal — Book is the
// inheritance *source* for pieces (CLAUDE.md > Book-level soft
// inheritance), not a consumer of it, so there's nothing to resolve/copy
// against here the way there is on the piece side.

interface EditBookModalProps {
  book: Book
  open: boolean
  onClose: () => void
}

interface FormValues {
  bookTitle: string
  // Composer/Arranger (composer/arranger overhaul, Stage C) are ordered
  // Person lists now — real TagComboBox fields, same shape as
  // `instruments` below.
  composer: Tag[]
  arranger: Tag[]
  yearPublished: string
  workOpusNumber: string
  instruments: Tag[]
  sheetType: string
  publisher: string
  publisherId: string
  isbn: string
  imslpNumber: string
  description: string
  // Public Domain Badge feature (migration 00022) — plain fields, no
  // inheritance concept (Book is the inheritance root).
  copyrightStatus: string
  copyrightYear: string
  copyrightHolder: string
  copyrightSlug: string
  // US renewal follow-up — '' means "not explicitly picked" (preserved as
  // null on save, distinct from an explicit "false"), same tri-state shape
  // copyrightStatus above already uses for the identical reason (a plain
  // boolean form field can't represent "nothing picked yet").
  copyrightRenewed: '' | 'true' | 'false'
}

function bookToFormValues(book: Book): FormValues {
  return {
    bookTitle: book.bookTitle,
    // Composer/Arranger are already plain ordered Tag[] on Book (nothing
    // to inherit — Book is the top of the inheritance chain), so this is
    // a direct pass-through, same as `instruments` below.
    composer: book.composer,
    arranger: book.arranger,
    yearPublished: book.yearPublished ?? '',
    workOpusNumber: book.workOpusNumber ?? '',
    instruments: book.instruments,
    sheetType: book.sheetType?.name ?? '',
    publisher: book.publisher ?? '',
    publisherId: book.publisherId ?? '',
    isbn: book.isbn ?? '',
    imslpNumber: book.imslpNumber ?? '',
    description: book.description ?? '',
    copyrightStatus: book.copyrightStatus ?? '',
    copyrightYear: book.copyrightYear != null ? String(book.copyrightYear) : '',
    copyrightHolder: book.copyrightHolder ?? '',
    copyrightSlug: book.copyrightSlug ?? '',
    copyrightRenewed: book.copyrightRenewed == null ? '' : book.copyrightRenewed ? 'true' : 'false',
  }
}

// Strips a leading "IMSLP" label (with or without a following
// space/colon/hash/dash, any case) before the value is ever sent to the
// backend — same rule and same independently-implemented copy as
// EditPieceModal.tsx's own stripImslpPrefix (not shared code across the
// Go/TS boundary, per that file's own comment): the citation adds its own
// "IMSLP #" label (buildCitation, internal/handlers/citation.go), so a
// value typed in as "IMSLP04154" would otherwise render doubled ("IMSLP
// #IMSLP04154"). Only strips an actual prefix match; a value with no
// "IMSLP" text is returned as-is.
function stripImslpPrefix(value: string): string {
  return value.replace(/^\s*imslp[\s:#-]*/i, '')
}

function toIntOrNull(value: string): number | null {
  if (value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// Public Domain Badge feature — order matches the original design table
// exactly (design artifact, locked); same list as EditPieceModal.tsx's own
// copy (option lists are always duplicated per-caller in this app, only
// the real shared *components* — SingleSelect — aren't).
const COPYRIGHT_STATUS_OPTIONS = [
  {
    value: 'publicDomain',
    label: 'In Public Domain',
    description: 'No copyright applies. Sticky once picked — the calculation never overrides this.',
  },
  {
    value: 'likelyPublicDomain',
    label: 'Likely Public Domain',
    description:
      'Calculated automatically from copyright year and composer death year. Sticky if picked by hand too.',
  },
  {
    value: 'inCopyright',
    label: 'In Copyright',
    description:
      'Your own call — but if the calculation later determines the term has expired, this moves to Likely Public Domain on its own.',
  },
  {
    value: 'copyleft',
    label: 'Copyleft',
    description:
      'A license like Creative Commons has been attached to this piece. Same auto-upgrade as In Copyright if the calculation later says the term expired anyway.',
  },
]

// Book has no inheritance to preserve (unlike PieceWriteRequest, which
// blanks inherited fields so a full-replace write can't accidentally
// convert an inherited value into a permanent override) — every field here
// is the book's own, so this is a plain, direct mapping. isbn isn't
// stripped/normalized client-side the way imslpNumber is above — unlike
// imslpNumber, isbn is already normalized server-side on every write
// (handleUpdateBook's normalizeISBN), so there's nothing left for the
// client to do.
function formValuesToWriteRequest(data: FormValues): BookWriteRequest {
  return {
    bookTitle: data.bookTitle,
    composers: data.composer.map((t) => t.name),
    arrangers: data.arranger.map((t) => t.name),
    yearPublished: data.yearPublished || null,
    workOpusNumber: data.workOpusNumber || null,
    sheetTypeName: data.sheetType || null,
    publisher: data.publisher || null,
    publisherId: data.publisherId || null,
    description: data.description || null,
    imslpNumber: stripImslpPrefix(data.imslpNumber) || null,
    isbn: data.isbn || null,
    instruments: data.instruments.map((i) => i.name),
    // Public Domain Badge feature (migration 00022) — same plain
    // direct-mapping treatment as every other field above.
    copyrightStatus: (data.copyrightStatus || null) as BookWriteRequest['copyrightStatus'],
    copyrightYear: toIntOrNull(data.copyrightYear),
    copyrightHolder: data.copyrightHolder || null,
    copyrightSlug: data.copyrightSlug || null,
    copyrightRenewed: data.copyrightRenewed === '' ? null : data.copyrightRenewed === 'true',
  }
}

type SaveState = 'idle' | 'saving' | 'saved'
// How long the "Saved" checkmark stays up before the modal actually
// closes — the "saving" phase itself isn't on a timer (unlike the
// mockup's demo timings): it tracks the real PATCH request, which the
// design doc calls out as a single fast synchronous transaction (it
// already resyncs pieces_fts inside it), so this is the only fixed delay
// left — just enough that the confirmation is actually seen, not a flash.
const SAVED_DISPLAY_MS = 900

export function EditBookModal({ book, open, onClose }: EditBookModalProps) {
  const queryClient = useQueryClient()
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [copyrightOpen, setCopyrightOpen] = useState(false)
  // Captured right before mutate() fires, read in onSuccess — see
  // lib/minDuration.ts for why this exists: the real PATCH resolves in
  // ~1-15ms against this app's local SQLite backend, which is faster
  // than a browser paint, so without this the stripe animation below
  // mounts and unmounts before it's ever actually visible.
  const saveStartedAtRef = useRef(0)
  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: bookToFormValues(book) })

  useEffect(() => {
    if (open) {
      reset(bookToFormValues(book))
      // Guards a narrow but real edge case: closing the modal (Cancel/
      // Escape/backdrop) while a save is genuinely in flight leaves
      // saveState at 'saving', and this component stays mounted across
      // that close (book && <EditBookModal .../> is always rendered once
      // book data loads, same as EditPieceModal's own usage) — without
      // this, reopening before that earlier request resolves would show a
      // stale "Updating…" animation for a session that hasn't submitted
      // anything yet. (No eslint-disable needed here: adding watch() to
      // this form's useForm() destructure above already puts this
      // component on react-hooks/incompatible-library's bail-out path,
      // which also stops react-hooks/set-state-in-effect from analyzing
      // it — confirmed the rule no longer fires here.)
      setSaveState('idle')
    }
  }, [open, book, reset])

  // US renewal follow-up — server config, effectively static for the life
  // of the process, same long staleTime EditPieceModal.tsx's own copy uses.
  const { data: appConfig } = useQuery({
    queryKey: ['config'],
    queryFn: getConfig,
    staleTime: Infinity,
  })
  const { data: sheetTypeOptions = [] } = useQuery({
    queryKey: ['sheetTypes'],
    queryFn: listSheetTypes,
  })
  const { data: instrumentOptions = [] } = useQuery({
    queryKey: ['instruments'],
    queryFn: listInstruments,
  })
  // People catalog (composer/arranger overhaul, Stage C) — same
  // unpaginated lookup convention as every other field here.
  const { data: peopleOptions = [] } = useQuery({ queryKey: ['people'], queryFn: () => listPeople() })
  const sheetTypeSelectOptions = [
    { value: '', label: '—' },
    ...sheetTypeOptions.map((o) => ({ value: o.name, label: o.name })),
  ]

  // Effective/valid IMSLP number — no book-inheritance fallback needed
  // here (unlike EditPieceModal's own version of this), since Book is the
  // inheritance *source*, not a consumer of it (CLAUDE.md > Book-level
  // soft inheritance) — the form's own live value is already the whole
  // story.
  const imslpNumber = watch('imslpNumber')
  const isValidImslpNumber = /^\d+$/.test(stripImslpPrefix(imslpNumber).trim())
  const [imslpFetchState, setImslpFetchState] = useState<'idle' | 'fetching' | 'done'>('idle')
  // Which fields the *most recent* autofill actually touched — drives a
  // brief highlight ring, same convention as EditPieceModal.tsx.
  const [imslpFilledFields, setImslpFilledFields] = useState<Set<string>>(new Set())

  const imslpMutation = useMutation({
    mutationFn: () => lookupImslp(stripImslpPrefix(imslpNumber).trim()),
    onSuccess: (info) => {
      const filled = new Set<string>()
      const current = getValues()
      // Only fields currently blank — meant to save typing, not silently
      // overwrite something already entered. Composer is now an ordered
      // Person list (composer/arranger overhaul, Stage C) — same
      // placeholder-id append EditPieceModal.tsx's own version of this
      // uses, resolved server-side by name on save.
      if (current.composer.length === 0 && info.composer) {
        setValue('composer', [{ id: -1, name: info.composer }])
        filled.add('composer')
      }
      if (!current.workOpusNumber && info.workOpusNumber) {
        setValue('workOpusNumber', info.workOpusNumber)
        filled.add('workOpusNumber')
      }
      if (!current.yearPublished && info.yearWritten) {
        setValue('yearPublished', info.yearWritten)
        filled.add('yearPublished')
      }
      if (!current.publisher && info.publisher) {
        setValue('publisher', info.publisher)
        filled.add('publisher')
      }
      if (!current.publisherId && info.publisherId) {
        setValue('publisherId', info.publisherId)
        filled.add('publisherId')
      }
      setImslpFilledFields(filled)
      setImslpFetchState('done')
      window.setTimeout(() => setImslpFetchState('idle'), 1400)
      window.setTimeout(() => setImslpFilledFields(new Set()), 2400)
    },
    onError: () => setImslpFetchState('idle'),
  })

  function handleImslpAutofill() {
    if (imslpFetchState !== 'idle' || !isValidImslpNumber) return
    setImslpFetchState('fetching')
    imslpMutation.mutate()
  }

  const saveMutation = useMutation({
    // The Date.now() capture lives here, not in onSubmit below — onSubmit
    // is passed straight into react-hook-form's handleSubmit(), which the
    // react-hooks/purity and react-hooks/refs lint rules can't statically
    // prove doesn't invoke it during render, so an impure call or ref
    // write there gets flagged even though it never actually runs until a
    // real submit event. mutationFn has no such ambiguity — react-query
    // only ever calls it from mutate(), well after render.
    mutationFn: (data: FormValues) => {
      saveStartedAtRef.current = Date.now()
      return updateBook(book.id, formValuesToWriteRequest(data))
    },
    onSuccess: () => {
      // Broad invalidation, not just this book's own query — every piece
      // with this sourceBookId (an unknown set from here) may have just
      // had its *effective* composer/publisher/etc. change (CLAUDE.md >
      // Book-level soft inheritance), and any currently-mounted individual
      // ['piece', id] query needs to pick that up too, not just piece
      // list/search views.
      queryClient.invalidateQueries({ queryKey: ['books'] })
      queryClient.invalidateQueries({ queryKey: ['book'] })
      queryClient.invalidateQueries({ queryKey: ['pieces'] })
      queryClient.invalidateQueries({ queryKey: ['piece'] })
      afterMinDuration(saveStartedAtRef.current, () => {
        setSaveState('saved')
        setTimeout(() => {
          setSaveState('idle')
          onClose()
        }, SAVED_DISPLAY_MS)
      })
    },
    onError: () => setSaveState('idle'),
  })

  function onSubmit(data: FormValues) {
    setSaveState('saving')
    saveMutation.mutate(data)
  }

  // Shift+Enter saves from anywhere in the form — including a field with
  // its own open dropdown (Sheet Type, Instruments), which would
  // otherwise treat plain Enter as "pick
  // the highlighted row" and never reach a submit at all. Those fields'
  // own handlers (SingleSelect/TagComboBox) explicitly skip Shift+Enter
  // rather than acting on it, so this handler is the only thing that
  // fires — no double effect of both picking an option and saving.
  function handleFormKeyDown(event: ReactKeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault()
      handleSubmit(onSubmit)()
    }
  }

  const saving = saveState !== 'idle'

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="edit-book-title"
      size="xl"
      header={
        // -mx-6/px-6 bleeds the line to the dialog's true edges — same
        // full-bleed convention as EditPieceModal's own pinned-header
        // divider (its page-preview toggle section), plain 1px, no scrim:
        // this app already draws the fixed/scrolling boundary with a
        // simple border in two places (that divider, and every Modal's
        // own footer border-t), so a line here matches existing language.
        <div className="-mx-6 flex items-start justify-between gap-4 border-b border-border px-6 pb-4">
          <div>
            <h2 id="edit-book-title" className="font-display text-2xl font-medium text-ink">
              Edit book
            </h2>
            <p className="text-sm text-ink-soft">{book.bookTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mt-1 shrink-0 text-ink-soft hover:text-accent"
          >
            <IconXFilled size={22} />
          </button>
        </div>
      }
      footer={
        <div className="flex flex-col gap-2">
          {saveMutation.isError && (
            <p className="flex items-center gap-2 text-sm text-red-700">
              <IconAlertTriangle size={16} />
              {saveMutation.error instanceof ApiError
                ? saveMutation.error.message
                : 'Could not save. Please try again.'}
            </p>
          )}
          {book.pieceCount > 0 && (
            <p
              className={`text-right text-xs text-ink-soft transition-opacity ${saving ? 'opacity-0' : 'opacity-100'}`}
            >
              Saving will update {book.pieceCount} {book.pieceCount === 1 ? 'piece' : 'pieces'}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent disabled:cursor-default disabled:opacity-45"
            >
              Cancel
            </button>
            {/* Save carries the progress state itself. min-w, not a fixed
                width — "Updating N pieces…" is longer than "Save"/"Saved",
                and should push the button wider to stay on one line rather
                than wrap and grow taller instead (whitespace-nowrap is
                what actually prevents the wrap; min-w just keeps the idle
                state from looking undersized) — same pattern as the Book
                Upload Wizard's own stripe-animated Import button
                (BookUploadConfirmStep.tsx), ported here since this button
                had the same bug: fixed w-[190px] with no whitespace-nowrap
                let "Updating N pieces…" wrap onto a second line and grow
                the button taller instead of wider. */}
            <button
              type="submit"
              form="edit-book-form"
              disabled={saving}
              className="relative flex min-w-[190px] shrink-0 items-center justify-center overflow-hidden rounded-md bg-accent px-4 py-2 font-display whitespace-nowrap text-white disabled:cursor-default"
            >
              {saveState === 'saving' && (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 -left-14 w-[calc(100%+56px)] animate-stripe-move bg-[length:56px_56px] [background-image:repeating-linear-gradient(45deg,rgba(255,255,255,0.3)_0,rgba(255,255,255,0.3)_10px,transparent_10px,transparent_20px)] will-change-transform motion-reduce:animate-none motion-reduce:opacity-60"
                />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                {saveState === 'idle' && 'Save'}
                {saveState === 'saving' &&
                  (book.pieceCount > 0 ? `Updating ${book.pieceCount} pieces…` : 'Saving…')}
                {saveState === 'saved' && (
                  <>
                    <IconCheck size={15} />
                    Saved
                  </>
                )}
              </span>
            </button>
          </div>
        </div>
      }
    >
      <form
        id="edit-book-form"
        onSubmit={handleSubmit(onSubmit)}
        onKeyDown={handleFormKeyDown}
        className="flex flex-col gap-4"
      >
        {/* Book title stands alone, full width — not paired with Composer.
            Row order: Title / Composer-Arranger / Year-Opus /
            Publisher-PublisherID / ISBN-IMSLP / Sheet+Instruments-
            Description. Every paired row below collapses to stacked
            single fields below ~525px. */}
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="f-book-title" className="text-sm text-ink-soft">
            Book title <span className="text-ink-soft/60 italic">(Required)</span>
          </label>
          <input
            id="f-book-title"
            className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
            {...register('bookTitle', { required: 'Book title is required.', maxLength: 255 })}
          />
          {errors.bookTitle && <p className="text-sm text-red-700">{errors.bookTitle.message}</p>}
        </div>

        <div className="flex flex-col gap-3 min-[525px]:flex-row">
          {/* No persistent "one of these three required" hint here:
              composer-or-arranger-or-publisher is a cross-field rule the
              backend already enforces and reports (ValidateBook), and the
              footer below already surfaces whatever error a failed save
              returns — same "validation-error only" treatment already
              given every other backend-only rule in this app's forms
              (CLAUDE.md > Frontend: light client-side validation, "surface
              whatever error the backend returns" for anything beyond the
              cheap checks). */}
          <div className="min-w-0 flex-1">
            <Controller
              name="composer"
              control={control}
              render={({ field }) => (
                <TagComboBox
                  label="Composer"
                  options={peopleOptions}
                  selected={field.value}
                  multiple
                  onChange={field.onChange}
                  pillStyle="paper"
                  newOptionLabel="New person"
                  highlighted={imslpFilledFields.has('composer')}
                />
              )}
            />
          </div>
          <div className="min-w-0 flex-1">
            <Controller
              name="arranger"
              control={control}
              render={({ field }) => (
                <TagComboBox
                  label="Arranger"
                  options={peopleOptions}
                  selected={field.value}
                  multiple
                  onChange={field.onChange}
                  pillStyle="paper"
                  newOptionLabel="New person"
                />
              )}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 min-[525px]:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="f-year" className="text-sm text-ink-soft">
              Year published
            </label>
            <input
              id="f-year"
              className={`w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink transition-shadow duration-700 ${imslpFilledFields.has('yearPublished') ? 'ring-2 ring-accent-on-dark' : ''}`}
              {...register('yearPublished', { maxLength: 255 })}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="f-opus" className="text-sm text-ink-soft">
              Work/opus number
            </label>
            <input
              id="f-opus"
              className={`w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink transition-shadow duration-700 ${imslpFilledFields.has('workOpusNumber') ? 'ring-2 ring-accent-on-dark' : ''}`}
              {...register('workOpusNumber', { maxLength: 255 })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 min-[525px]:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="f-publisher" className="text-sm text-ink-soft">
              Publisher
            </label>
            <input
              id="f-publisher"
              className={`w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink transition-shadow duration-700 ${imslpFilledFields.has('publisher') ? 'ring-2 ring-accent-on-dark' : ''}`}
              {...register('publisher', { maxLength: 255 })}
            />
          </div>
          {/* flex-1, same as every other paired-row's second field — not
              the Piece edit menu's narrower fixed-width treatment. With
              four double-field rows stacked in a column, their split
              points need to line up with each other; a one-off-narrower
              Publisher ID would put its divider in a different place than
              every other row's. */}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="f-publisher-id" className="text-sm text-ink-soft">
              Publisher ID
            </label>
            <input
              id="f-publisher-id"
              className={`w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink transition-shadow duration-700 ${imslpFilledFields.has('publisherId') ? 'ring-2 ring-accent-on-dark' : ''}`}
              {...register('publisherId', { maxLength: 255 })}
            />
          </div>
        </div>

        {/* ISBN/IMSLP number, paired together — same split-row treatment
            as every row above it. */}
        <div className="flex flex-col gap-3 min-[525px]:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="f-isbn" className="text-sm text-ink-soft">
              ISBN number
            </label>
            <input
              id="f-isbn"
              className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 font-mono text-ink"
              {...register('isbn', { maxLength: 255 })}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="f-imslp" className="text-sm text-ink-soft">
              IMSLP number
            </label>
            {/* relative + pr-9 reserve room for ImslpAutofillButton inside
                the input itself — same placement as EditPieceModal's own
                IMSLP field (password show/hide-toggle convention). */}
            <div className="relative">
              <input
                id="f-imslp"
                className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 pr-9 font-mono text-ink"
                {...register('imslpNumber', { maxLength: 255 })}
              />
              <ImslpAutofillButton
                state={imslpFetchState}
                valid={isValidImslpNumber}
                onClick={handleImslpAutofill}
              />
            </div>
            {imslpMutation.isError && (
              <p className="text-sm text-red-700">
                {imslpMutation.error instanceof ApiError
                  ? imslpMutation.error.message
                  : 'Could not reach IMSLP.'}
              </p>
            )}
          </div>
        </div>

        {/* Closing two-column row: Sheet Type/Instruments stacked on the
            left, Description spanning the same height on the right — the
            one genuinely tall field gets the one genuinely tall column.
            gap-3 here too (not gap-5) — every multi-column row in this
            form uses the same gutter width, a direct fix from design
            review (a 20px gutter here against 12px everywhere else
            visibly narrowed this column against its neighbors). */}
        <div className="flex flex-col gap-3 min-[525px]:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <Controller
              name="sheetType"
              control={control}
              render={({ field }) => (
                <SingleSelect
                  label="Sheet type"
                  options={sheetTypeSelectOptions}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            <Controller
              name="instruments"
              control={control}
              render={({ field }) => (
                <TagComboBox
                  label="Instruments"
                  options={instrumentOptions}
                  selected={field.value}
                  multiple
                  onChange={field.onChange}
                />
              )}
            />
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="f-description" className="text-sm text-ink-soft">
              Description <span className="text-ink-soft/60 italic">(Markdown supported)</span>
            </label>
            <textarea
              id="f-description"
              rows={4}
              // resize-none — the drag handle had no real effect anyway:
              // flex-1/min-h-0 on this column drive the textarea's actual
              // height, so a manual resize either got fought back to the
              // flex-derived height or fought the layout around it.
              className="min-h-[96px] flex-1 resize-none rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('description')}
            />
          </div>
        </div>

        {/* Copyright — Public Domain Badge feature. Same collapsed-by-
            default posture as the Piece Edit menu's own Copyright section.
            No InheritedNote wiring here (unlike Piece's version) — Book is
            the top of the inheritance chain, nothing for it to inherit
            from, and its Copyright Status trigger has no live-calculated
            default to show either (needs an effective copyright year +
            composer death years, both pulled *through* Piece → Book
            inheritance), so it just shows a plain "Not set" placeholder
            instead. */}
        <div className="border-t border-border pt-4">
          <button
            type="button"
            onClick={() => setCopyrightOpen((o) => !o)}
            className="flex cursor-pointer items-center gap-1 text-sm text-ink-soft hover:text-ink"
          >
            <IconChevronRight
              size={14}
              className={`transition-transform ${copyrightOpen ? 'rotate-90' : ''}`}
            />
            Copyright
          </button>
          {copyrightOpen && (
            <div className="mt-3 flex flex-col gap-4 rounded-md border border-dashed border-border p-4">
              <Controller
                name="copyrightStatus"
                control={control}
                render={({ field }) => (
                  <SingleSelect
                    label="Copyright status"
                    options={COPYRIGHT_STATUS_OPTIONS}
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="Not set"
                    placeholderDescription="No status set for this book yet."
                    onClear={() => field.onChange('')}
                  />
                )}
              />
              <div className="flex flex-col gap-3 min-[525px]:flex-row">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <label htmlFor="f-copyright-year" className="flex items-center gap-1 text-sm text-ink-soft">
                    Copyright year
                    <InfoTooltip
                      message="Enter the year copyright was first established for this book — usually the year of first publication."
                      ariaLabel="What Copyright year means"
                      triggerClassName="text-[#9d9892] hover:text-ink-soft"
                    >
                      <IconInfoCircle size={13} />
                    </InfoTooltip>
                  </label>
                  <input
                    id="f-copyright-year"
                    type="number"
                    className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                    {...register('copyrightYear')}
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <label htmlFor="f-copyright-holder" className="text-sm text-ink-soft">
                    Copyright holder
                  </label>
                  <input
                    id="f-copyright-holder"
                    className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                    {...register('copyrightHolder', { maxLength: 255 })}
                  />
                </div>
              </div>

              {/* US renewal follow-up — same gate/shape as
                  EditPieceModal.tsx's copy, but plain-boolean tri-state (no
                  InheritedNote — Book has nothing to inherit from). */}
              {appConfig?.copyrightRegion === 'en-US' && inUSRenewalWindow(watch('copyrightYear')) && (
                <div className="flex items-center gap-1.5 rounded-md border border-dashed border-border p-3">
                  <Controller
                    name="copyrightRenewed"
                    control={control}
                    render={({ field }) => (
                      <Toggle
                        checked={field.value === 'true'}
                        onChange={(next) => field.onChange(next ? 'true' : 'false')}
                        label="This work was renewed"
                      />
                    )}
                  />
                  <InfoTooltip
                    message={`US works published ${US_RENEWAL_WINDOW_START}–${US_RENEWAL_WINDOW_END} needed a separate renewal filing to keep protection past the first 28 years. Enable this if your source shows a "(renewed …)" note next to the copyright year above.`}
                    ariaLabel="What 'This work was renewed' means"
                    triggerClassName="text-[#9d9892] hover:text-ink-soft"
                  >
                    <IconInfoCircle size={13} />
                  </InfoTooltip>
                </div>
              )}

              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor="f-copyright-slug" className="text-sm text-ink-soft">
                  Copyright details
                </label>
                <input
                  id="f-copyright-slug"
                  placeholder="Optional — e.g. license terms, renewal notes"
                  className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-soft/40 placeholder:italic"
                  {...register('copyrightSlug')}
                />
              </div>
            </div>
          )}
        </div>
      </form>
    </Modal>
  )
}
