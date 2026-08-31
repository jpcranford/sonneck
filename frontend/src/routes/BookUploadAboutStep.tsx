import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  IconArrowLeft,
  IconArrowRight,
  IconArrowsDiagonal,
  IconChevronLeft,
  IconChevronRightFilled,
  IconCheck,
  IconInfoCircle,
  IconAlertTriangle,
  IconRotate,
  IconX,
} from '@tabler/icons-react'
import { updateBook, getBookPageThumbnailUrl } from '../api/books'
import { lookupImslp } from '../api/imslp'
import { listInstruments, listSheetTypes } from '../api/lookups'
import { ApiError } from '../api/client'
import { namesToText, textToNames } from '../lib/joinNames'
import type { Book, BookWriteRequest, Tag } from '../api/types'
import { TagComboBox } from '../components/TagComboBox'
import { SingleSelect } from '../components/SingleSelect'
import { InfoTooltip } from '../components/InfoTooltip'
import { PageLightbox } from '../components/PageLightbox'
import { ImslpAutofillButton } from '../components/ImslpAutofillButton'
import { TOTAL_WIZARD_STEPS } from './BookUploadWizard'

// Book Upload Wizard, Screen 3 of 6: "About this book" (design doc §5 step
// 1). Real build of UploadBookAboutMockup.tsx (/mockup/upload-book-about,
// kept as a standing design reference) — same layout/behavior, wired to
// the actual uploaded book instead of fixture data. If the two ever look
// different, that's either a bug or a change that needs porting to both.

const CURRENT_STEP = 3

interface FormValues {
  bookTitle: string
  composer: string
  arranger: string
  yearWritten: string
  workOpusNumber: string
  publisher: string
  publisherId: string
  isbn: string
  imslpNumber: string
  sheetType: string
  instruments: Tag[]
  description: string
}

// Composer/Arranger are ordered Person lists now (composer/arranger
// overhaul, migration 00020) — bridged to/from this still-plain-text field
// as a comma-separated string via namesToText/textToNames (lib/joinNames.ts).
// EditBookModal.tsx's own composer/arranger fields got a real multi-person
// TagComboBox in Stage C; this wizard screen deliberately did not (out of
// that stage's scope) and still uses this bridge.
function bookToFormValues(book: Book): FormValues {
  return {
    bookTitle: book.bookTitle,
    composer: namesToText(book.composer.map((p) => p.name)),
    arranger: namesToText(book.arranger.map((p) => p.name)),
    yearWritten: book.yearWritten ?? '',
    workOpusNumber: book.workOpusNumber ?? '',
    publisher: book.publisher ?? '',
    publisherId: book.publisherId ?? '',
    isbn: book.isbn ?? '',
    imslpNumber: book.imslpNumber ?? '',
    sheetType: book.sheetType?.name ?? '',
    instruments: book.instruments,
    description: book.description ?? '',
  }
}

// Strips a leading "IMSLP" label (with or without a following
// space/colon/hash/dash, any case) before the value is ever sent to the
// backend — same rule and same independently-implemented copy as
// EditBookModal.tsx/EditPieceModal.tsx's own stripImslpPrefix (not shared
// code across files, per those files' own comments): the citation adds
// its own "IMSLP #" label (buildCitation, internal/handlers/citation.go),
// so a value typed in as "IMSLP04154" would otherwise render doubled
// ("IMSLP #IMSLP04154"). Only strips an actual prefix match; a value with
// no "IMSLP" text is returned as-is. The backend's own filename-detection
// (detectImslpNumber, internal/handlers/filename.go) is now fixed to
// return a prefix-free value in the first place, but this still matters
// for a user typing a prefixed value in by hand.
function stripImslpPrefix(value: string): string {
  return value.replace(/^\s*imslp[\s:#-]*/i, '')
}

function formValuesToWriteRequest(data: FormValues): BookWriteRequest {
  return {
    bookTitle: data.bookTitle,
    composers: textToNames(data.composer),
    arrangers: textToNames(data.arranger),
    yearWritten: data.yearWritten || null,
    workOpusNumber: data.workOpusNumber || null,
    sheetTypeName: data.sheetType || null,
    publisher: data.publisher || null,
    publisherId: data.publisherId || null,
    description: data.description || null,
    imslpNumber: stripImslpPrefix(data.imslpNumber) || null,
    isbn: data.isbn || null,
    instruments: data.instruments.map((i) => i.name),
  }
}

function formatFileSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface BookUploadAboutStepProps {
  book: Book
  pageCount: number
  // Only available right after the file picker/drop, from the browser's
  // own File object — a page reload mid-wizard loses it (File objects
  // aren't something draft persistence can serialize), so this is shown
  // when known and simply omitted otherwise rather than faked.
  fileSizeBytes: number | null
  // Printed-PDF page offset (design doc §5, added post-launch) — lifted
  // to BookUploadWizard.tsx (like pageAssignments/pieceFields) so it
  // survives Back navigation and reaches the Confirm step's import
  // request, not just local state here.
  pageOffset: number
  onPageOffsetChange: (offset: number) => void
  onBack: () => void
  onNext: (updatedBook: Book) => void
  onCancel: () => void
  cancelPending: boolean
}

export function BookUploadAboutStep({
  book,
  pageCount,
  fileSizeBytes,
  pageOffset,
  onPageOffsetChange,
  onBack,
  onNext,
  onCancel,
  cancelPending,
}: BookUploadAboutStepProps) {
  const [previewPage, setPreviewPage] = useState(1)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  // Tracks whether *this* previewPage's thumbnail has actually finished
  // loading — see the preview box's own comment below for why this
  // exists (a real page's aspect ratio isn't known until the image
  // itself loads, but the box still needs to reserve visible space
  // before that).
  const [thumbLoaded, setThumbLoaded] = useState(false)
  useEffect(() => {
    setThumbLoaded(false)
  }, [previewPage])
  // The one field this screen adds beyond book metadata. Bound to the
  // same previewPage the cover cycler above already drives — flipping to
  // a page you're sure about and correcting it there is the whole
  // interaction. printedPage is never stored directly: solving for a new
  // offset on edit (rather than storing the typed value) is what makes
  // this keep counting forward correctly if you flip to another page
  // afterward, instead of freezing at whatever was last typed.
  const printedPage = previewPage + pageOffset

  function handlePrintedPageChange(raw: string) {
    if (raw.trim() === '') return
    const typed = Number(raw)
    if (!Number.isFinite(typed)) return
    onPageOffsetChange(typed - previewPage)
  }

  const {
    register,
    handleSubmit,
    control,
    watch,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: bookToFormValues(book) })

  const [imslpFetchState, setImslpFetchState] = useState<'idle' | 'fetching' | 'done'>('idle')
  // Which fields the *most recent* autofill actually touched — drives a
  // brief highlight ring so it's obvious which values just changed.
  const [imslpFilledFields, setImslpFilledFields] = useState<Set<string>>(new Set())
  const isValidImslpNumber = /^\d+$/.test(stripImslpPrefix(watch('imslpNumber')).trim())

  const imslpMutation = useMutation({
    mutationFn: () => lookupImslp(stripImslpPrefix(watch('imslpNumber')).trim()),
    onSuccess: (info) => {
      const filled = new Set<string>()
      const current = getValues()
      // Only fields currently blank — this is meant to save typing, not
      // silently overwrite something already entered (design mockup's
      // own rule, carried into the real build).
      if (!current.composer && info.composer) {
        setValue('composer', info.composer)
        filled.add('composer')
      }
      if (!current.yearWritten && info.yearWritten) {
        setValue('yearWritten', info.yearWritten)
        filled.add('yearWritten')
      }
      if (!current.workOpusNumber && info.workOpusNumber) {
        setValue('workOpusNumber', info.workOpusNumber)
        filled.add('workOpusNumber')
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

  function runImslpAutofill() {
    if (imslpFetchState !== 'idle' || !isValidImslpNumber) return
    setImslpFetchState('fetching')
    imslpMutation.mutate()
  }

  // Runs once, automatically — no click needed, unlike a manually-typed
  // number elsewhere (EditPieceModal.tsx), since a filename-detected
  // number is already considered confirmed by the time this screen
  // exists at all (design doc §5). The delay is deliberate, not filler:
  // it's what keeps this screen from ever silently arriving *pre-filled*
  // — the user needs to actually see the blank "About this book" screen
  // first, then watch the fetch/highlight sequence play out on it, not
  // have the fields already different the instant it mounts (matches the
  // design mockup this was built from, UploadBookAboutMockup.tsx).
  useEffect(() => {
    const timer = window.setTimeout(runImslpAutofill, 700)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate one-shot on mount: filename detection already ran server-side before this screen existed, this just reacts to its result once. Re-running on every render (runImslpAutofill is recreated each render) would refire the whole fetch/highlight sequence any time this component re-renders for an unrelated reason.
  }, [])

  const { data: sheetTypeOptions = [] } = useQuery({
    queryKey: ['sheetTypes'],
    queryFn: listSheetTypes,
  })
  const { data: instrumentOptions = [] } = useQuery({
    queryKey: ['instruments'],
    queryFn: listInstruments,
  })
  const sheetTypeSelectOptions = [
    { value: '', label: '—' },
    ...sheetTypeOptions.map((o) => ({ value: o.name, label: o.name })),
  ]

  const saveMutation = useMutation({
    mutationFn: (data: FormValues) => updateBook(book.id, formValuesToWriteRequest(data)),
    onSuccess: (updated) => onNext(updated),
  })

  function onSubmit(data: FormValues) {
    saveMutation.mutate(data)
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6 md:p-8">
      {/* Wizard chrome — identical across screens 3-6. */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex cursor-pointer items-center gap-1.5 text-base text-ink-soft hover:text-ink"
        >
          <IconArrowLeft size={24} />
          Back
        </button>
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-xs text-ink-soft">
            Step {CURRENT_STEP} of {TOTAL_WIZARD_STEPS}
          </span>
          <div className="flex gap-1.5">
            {Array.from({ length: TOTAL_WIZARD_STEPS }, (_, i) => i + 1).map((step) => (
              <span
                key={step}
                className={`h-1 w-5 rounded-full ${
                  step < CURRENT_STEP
                    ? 'bg-accent-on-dark'
                    : step === CURRENT_STEP
                      ? 'bg-accent'
                      : 'bg-border'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      <div>
        <h1 className="font-display text-2xl font-medium text-ink">About this book</h1>
        <p className="text-sm text-ink-soft">
          These fields apply to the whole book. Every piece can still override with its own values.
        </p>
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-7 sm:flex-row sm:items-start"
      >
        <div className="flex w-full shrink-0 flex-col gap-2.5 sm:sticky sm:top-5 sm:w-[210px]">
          {/* aspect-[2/3] is a *loading-state placeholder only*, not the
              real page's shape — dropped the instant the image actually
              loads (thumbLoaded), same fix already applied to Piece
              Details' own preview (PiecePage.tsx's own comment on this).
              A forced aspect box + object-cover previously stayed on
              permanently, which cropped/masked whatever part of the real
              page didn't fit 2:3 — most scanned pages aren't exactly 2:3.
              Thumbnail generation is synchronous and renders on first
              request per page (see internal/handlers/book.go's
              handleBookPageThumbnail), so right after upload, or right
              after turning to a not-yet-viewed page, this can take a real
              moment — without a reserved, colored box the panel read as
              genuinely empty during that gap. So: reserve the placeholder
              box (sunken background, 2:3) only until thumbLoaded flips
              true, then let the box collapse/expand to the image's own
              real aspect ratio (h-auto) with no cropping at all.
              key={previewPage} forces a fresh <img> per page turn so the
              previous page's frame doesn't sit frozen on screen while the
              new one renders (the thumbLoaded reset effect above keys off
              the same previewPage for the same reason). */}
          <div
            className={`relative w-full overflow-hidden rounded-lg border border-border bg-paper-sunken shadow-sm ${thumbLoaded ? '' : 'aspect-[2/3]'}`}
          >
            {/* Lightbox trigger — same click-to-enlarge treatment as
                Piece Details' own preview thumbnail (PageLightbox.tsx).
                The whole thumbnail is clickable, not just the corner
                badge — the badge is a discoverability hint, not the only
                hit target. */}
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              aria-label={`View page ${previewPage} larger`}
              className={`block w-full cursor-zoom-in ${thumbLoaded ? '' : 'h-full'}`}
            >
              <img
                key={previewPage}
                src={getBookPageThumbnailUrl(book.id, previewPage)}
                onLoad={() => setThumbLoaded(true)}
                alt=""
                className={thumbLoaded ? 'h-auto w-full' : 'invisible h-full w-full'}
              />
            </button>
            {/* Always-visible "view larger" hint, not a hover reveal —
                same device-aware reasoning as the lightbox's own zoom
                hint: this has to be discoverable by tap alone. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-2 right-2 flex items-center justify-center rounded-full bg-ink/80 p-1.5 text-white shadow-md backdrop-blur-sm"
            >
              <IconArrowsDiagonal size={14} />
            </div>
            <div className="absolute bottom-2.5 left-1/2 flex w-max -translate-x-1/2 items-center gap-1 rounded-full bg-ink/80 px-2 py-1 shadow-md backdrop-blur-sm">
              <button
                type="button"
                onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                disabled={previewPage === 1}
                aria-label="Previous page"
                className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-accent-on-dark disabled:pointer-events-none disabled:opacity-35"
              >
                <IconChevronLeft size={14} />
              </button>
              <span className="text-xs whitespace-nowrap tabular-nums text-white/90">
                PDF p. {previewPage} / {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPreviewPage((p) => Math.min(pageCount, p + 1))}
                disabled={previewPage === pageCount}
                aria-label="Next page"
                className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-accent-on-dark disabled:pointer-events-none disabled:opacity-35"
              >
                <IconChevronRightFilled size={14} />
              </button>
            </div>
          </div>

          <div className="text-[0.78rem] leading-relaxed text-ink-soft">
            {book.originalFilename && (
              <strong className="block break-words text-ink">{book.originalFilename}</strong>
            )}
            {pageCount} pages{fileSizeBytes != null ? ` • ${formatFileSize(fileSizeBytes)}` : ''}
          </div>

          {/* Printed-PDF page offset — sets one offset for the whole
              book, not a per-page correction. sourcePageStart/
              sourcePageEnd (the fields citations actually use) get
              physical page + this offset for every piece at import,
              rather than the raw PDF position — see
              ConfirmImportRequest.PageOffset (internal/handlers/wizard.go). */}
          <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-paper-raised p-3">
            <label htmlFor="f-printed-page" className="text-sm text-ink-soft">
              Printed-PDF page offset
            </label>
            <input
              id="f-printed-page"
              type="number"
              value={printedPage}
              onChange={(event) => handlePrintedPageChange(event.target.value)}
              className="w-full rounded-md border border-border bg-paper px-3 py-1.5 text-ink tabular-nums"
            />
            <p className="text-[0.78rem] leading-relaxed text-ink-soft">
              Flip the preview above to a page you're sure about and enter what's actually printed
              on the page. Safe to skip if they already match.
            </p>
            <p className="text-[0.78rem] leading-relaxed text-ink-soft">
              This book's page numbers will start at page <b>{1 + pageOffset}</b> and count up from
              there.
            </p>
            {pageOffset !== 0 && (
              <button
                type="button"
                onClick={() => onPageOffsetChange(0)}
                className="flex w-fit cursor-pointer items-center gap-1.5 text-[0.78rem] text-ink-soft hover:text-ink"
              >
                <IconRotate size={12} />
                Reset — no offset
              </button>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* Book title stands alone, full width — same restructure as
              EditBookModal.tsx: Title / Composer-Arranger /
              Year-Opus / Publisher-PublisherID / ISBN-IMSLP / SheetType+
              Instruments-Description. Kept in sync deliberately — this
              screen and the Edit Book Modal cover nearly the same field
              set, so a user shouldn't have to relearn field positions
              between first entering a book's info here and editing it
              again later. */}
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="f-book-title" className="text-sm text-ink-soft">
              Book Title <span className="text-ink-soft/60 italic">(Required)</span>
            </label>
            <input
              id="f-book-title"
              className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('bookTitle', { required: 'Book title is required.', maxLength: 255 })}
            />
            {errors.bookTitle && <p className="text-sm text-red-700">{errors.bookTitle.message}</p>}
          </div>

          <div className="flex flex-col gap-3 min-[525px]:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor="f-composer" className="flex items-center gap-1 text-sm text-ink-soft">
                Composer
                <InfoTooltip
                  message="If neither composer nor arranger is set here, you will be later prompted to enter one for each piece."
                  ariaLabel="What happens if Composer and Arranger are both left blank"
                  triggerClassName="text-[#9d9892] hover:text-ink-soft"
                >
                  <IconInfoCircle size={13} />
                </InfoTooltip>
              </label>
              <input
                id="f-composer"
                placeholder="e.g. Robert Schumann"
                className={`w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink transition-shadow duration-700 placeholder:text-ink-soft/40 placeholder:italic ${imslpFilledFields.has('composer') ? 'ring-2 ring-accent-on-dark' : ''}`}
                {...register('composer', { maxLength: 255 })}
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor="f-arranger" className="text-sm text-ink-soft">
                Arranger
              </label>
              <input
                id="f-arranger"
                placeholder="e.g. Louis Köhler"
                className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-soft/40 placeholder:italic"
                {...register('arranger', { maxLength: 255 })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 min-[525px]:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor="f-year" className="text-sm text-ink-soft">
                Year Written
              </label>
              <input
                id="f-year"
                placeholder="e.g. 1848"
                className={`w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink transition-shadow duration-700 placeholder:text-ink-soft/40 placeholder:italic ${imslpFilledFields.has('yearWritten') ? 'ring-2 ring-accent-on-dark' : ''}`}
                {...register('yearWritten', { maxLength: 255 })}
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor="f-opus" className="text-sm text-ink-soft">
                Work/Opus Number
              </label>
              <input
                id="f-opus"
                placeholder="e.g. Op. 68"
                className={`w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink transition-shadow duration-700 placeholder:text-ink-soft/40 placeholder:italic ${imslpFilledFields.has('workOpusNumber') ? 'ring-2 ring-accent-on-dark' : ''}`}
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
                placeholder="e.g. G. Schirmer"
                className={`w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink transition-shadow duration-700 placeholder:text-ink-soft/40 placeholder:italic ${imslpFilledFields.has('publisher') ? 'ring-2 ring-accent-on-dark' : ''}`}
                {...register('publisher', { maxLength: 255 })}
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor="f-publisher-id" className="text-sm text-ink-soft">
                Publisher ID
              </label>
              <input
                id="f-publisher-id"
                placeholder="e.g. HL50252950"
                className={`w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink transition-shadow duration-700 placeholder:text-ink-soft/40 placeholder:italic ${imslpFilledFields.has('publisherId') ? 'ring-2 ring-accent-on-dark' : ''}`}
                {...register('publisherId', { maxLength: 255 })}
              />
            </div>
          </div>

          {/* ISBN/IMSLP — moved IMSLP out of the row it used to share with
              Sheet Type and paired it with the new ISBN field instead,
              same reasoning as EditBookModal.tsx: Sheet Type moves down to
              join Instruments in the closing stacked column below, freeing
              this row for the two identifier fields to sit together. */}
          <div className="flex flex-col gap-3 min-[525px]:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor="f-isbn" className="text-sm text-ink-soft">
                ISBN Number
              </label>
              <input
                id="f-isbn"
                placeholder="e.g. 978-0-13-235088-4"
                className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-soft/40 placeholder:italic"
                {...register('isbn', { maxLength: 255 })}
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="f-imslp" className="text-sm text-ink-soft">
                  IMSLP No.
                </label>
                {watch('imslpNumber') && (
                  <span className="flex items-center gap-1 text-xs text-accent">
                    <IconCheck size={12} />
                    Detected from filename
                  </span>
                )}
              </div>
              {/* relative + pr-9 reserve room for ImslpAutofillButton
                  inside the input itself — same placement as
                  EditPieceModal.tsx's own copy of this field. */}
              <div className="relative">
                <input
                  id="f-imslp"
                  className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 pr-9 text-ink"
                  {...register('imslpNumber', { maxLength: 255 })}
                />
                <ImslpAutofillButton
                  state={imslpFetchState}
                  valid={isValidImslpNumber}
                  onClick={runImslpAutofill}
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
              left, Description spanning the same height on the right —
              the one genuinely tall field gets the one genuinely tall
              column, same treatment as EditBookModal.tsx. Description
              becomes a real multi-line textarea here (was a single-line
              input) specifically because it now needs to visually balance
              a two-field-tall left column, not just sit beside Instruments
              alone. */}
          <div className="flex flex-col gap-3 min-[525px]:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <Controller
                name="sheetType"
                control={control}
                render={({ field }) => (
                  <SingleSelect
                    label="Sheet Type"
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
                  <div className="[&_input::placeholder]:text-ink-soft/40 [&_input::placeholder]:italic">
                    <TagComboBox
                      label="Instruments"
                      options={instrumentOptions}
                      selected={field.value}
                      multiple
                      onChange={field.onChange}
                    />
                  </div>
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
                placeholder="Optional notes about this book…"
                className="min-h-[96px] flex-1 resize-none rounded-md border border-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-soft/40 placeholder:italic"
                {...register('description')}
              />
            </div>
          </div>

          {saveMutation.isError && (
            <p className="flex items-center gap-2 text-sm text-red-700">
              <IconAlertTriangle size={16} />
              {saveMutation.error instanceof ApiError
                ? saveMutation.error.message
                : 'Could not save. Please try again.'}
            </p>
          )}

          {/* Cancel upload shares this row with Next — a page-level action
              on the same footing as Next, not a step-nav control like
              Back. Plain text link, same visual weight as Back up in the
              chrome, not a bordered button — see UploadBookAboutMockup.tsx
              (design reference) for the full reasoning. Solid red (not a
              translucent shade): IconX is two crossing lines, and a
              translucent color would double-blend at the crossing point
              (the icon-preblend rule elsewhere in this app); permanently
              red rather than hover-only, same as the Delete Piece/Delete
              Book toolbar buttons — destructive should read as such at a
              glance. */}
          <div className="mt-2 flex items-center justify-between border-t border-border pt-5">
            <button
              type="button"
              onClick={onCancel}
              disabled={cancelPending}
              className="flex cursor-pointer items-center gap-1.5 text-base text-red-700 hover:text-red-800 disabled:cursor-default disabled:opacity-45"
            >
              <IconX size={24} />
              Cancel upload
            </button>
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="flex cursor-pointer items-center gap-1.5 rounded-md bg-accent px-5 py-2.5 font-display text-white hover:bg-accent/90 disabled:cursor-default disabled:opacity-60"
            >
              {saveMutation.isPending ? 'Saving…' : 'Next'}
              {!saveMutation.isPending && <IconArrowRight size={16} />}
            </button>
          </div>
        </div>
      </form>

      {/* Rendered here, outside the sm:sticky preview column above, not
          nested inside it — position: sticky creates its own stacking
          context, which would trap this fixed z-50 overlay's stacking
          authority to just that column's subtree. The result was a real,
          visible bug: the Sheet Type/Instruments fields (a later DOM
          sibling in the outer stacking context, with no sticky/z-index of
          their own) painted on top of the lightbox instead of under it. A
          fixed-position element escapes an ancestor's layout, but not its
          stacking context — this is the general fix for that. */}
      {lightboxOpen && (
        <PageLightbox
          key={previewPage}
          imageUrl={getBookPageThumbnailUrl(book.id, previewPage)}
          alt={`Page ${previewPage} of ${book.bookTitle}`}
          page={previewPage}
          pageCount={pageCount}
          // This screen's own "printed-PDF page offset" field is right
          // next to this preview — see UploadBookAboutMockup.tsx's own
          // comment on why a bare "n / N" here could otherwise read as
          // that instead of the PDF's own physical page (matches this
          // screen's inline cycler, which already says "PDF p.").
          pagePrefix="PDF p. "
          onClose={() => setLightboxOpen(false)}
          onPrev={() => setPreviewPage((p) => Math.max(1, p - 1))}
          onNext={() => setPreviewPage((p) => Math.min(pageCount, p + 1))}
        />
      )}
    </div>
  )
}
