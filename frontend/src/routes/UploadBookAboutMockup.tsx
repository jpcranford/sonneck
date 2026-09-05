import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Controller, useForm } from 'react-hook-form'
import {
  IconArrowLeft,
  IconArrowRight,
  IconArrowsDiagonal,
  IconChevronLeft,
  IconChevronRightFilled,
  IconCheck,
  IconCloudDownload,
  IconCloudOff,
  IconInfoCircle,
  IconLoader2,
  IconRotate,
  IconX,
  IconXFilled,
} from '@tabler/icons-react'
import type { Tag } from '../api/types'
import { TagComboBox } from '../components/TagComboBox'
import { SingleSelect } from '../components/SingleSelect'
import { InfoTooltip } from '../components/InfoTooltip'
import { useMockupTitle } from '../lib/useMockupTitle'

// ---------------------------------------------------------------------
// DESIGN MOCKUP — Book Upload Wizard, Screen 3 of 6: "About this book"
// (design doc §5 step 1's book-metadata entry). Not wired to the API —
// local mock state only, same convention as EditBookModalMockup.tsx.
// Option C: persistent left cover column, sticky, carrying Piece Details
// page's own floating page-cycler capsule.
//
// The wizard chrome built here (Back top-left, step-counter + progress
// dots top-right, Next bottom-right) is locked to carry unchanged through
// screens 4-6 — reuse this shape rather than reinventing it per screen.
// ---------------------------------------------------------------------

const SHEET_TYPE_OPTIONS: Tag[] = [
  { id: 1, name: 'Lead Sheet' },
  { id: 2, name: 'Solo Piece' },
  { id: 3, name: 'Ensemble Piece – Full Score' },
  { id: 5, name: 'Ensemble Piece – Part' },
  { id: 4, name: 'PVG Score' },
]
const SHEET_TYPE_SELECT_OPTIONS = [
  { value: '', label: '—' },
  ...SHEET_TYPE_OPTIONS.map((o) => ({ value: o.name, label: o.name })),
]
const INSTRUMENT_OPTIONS: Tag[] = [
  { id: 1, name: 'Piano' },
  { id: 2, name: 'Organ' },
  { id: 3, name: 'Guitar' },
  { id: 4, name: 'Voice' },
]
// Real callers (EditPieceModal.tsx/EditBookModal.tsx/BookUploadAboutStep.tsx)
// source this from the real, unpaginated GET /api/people — this mockup has
// no backend to call, same "hardcoded fixture stands in for the lookup
// table" treatment INSTRUMENT_OPTIONS/SHEET_TYPE_OPTIONS above already get.
const PEOPLE_OPTIONS: Tag[] = [
  { id: 1, name: 'Robert Schumann' },
  { id: 2, name: 'Louis Köhler' },
  { id: 3, name: 'Frédéric Chopin' },
]

const MOCK_FILENAME = 'Album_für_die_Jugend_Op_68.pdf'
const MOCK_PAGE_COUNT = 42
const TOTAL_STEPS = 6
const CURRENT_STEP = 3

interface FormValues {
  bookTitle: string
  composer: Tag[]
  arranger: Tag[]
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

// bookTitle pre-filled from the uploaded filename, imslpNumber
// auto-detected from it (design doc §5) — both real behaviors already
// established at the upload step, just shown here as their result.
// imslpNumber is the bare digits, not "IMSLP04154" — detectImslpNumber
// (internal/handlers/filename.go) captures just the number, matching the
// stored-value-is-prefix-free convention every other IMSLP-number save
// path in the app already follows (a real bug, fixed: this mockup used to
// hardcode the unstripped form, faithfully reproducing it). Everything
// else starts blank, including arranger/isbn — nothing gets auto-detected
// for either. Composer or arranger is required (ValidateBook), but
// neither is pre-filled here any more than composer ever was — same
// "starts blank, user fills it in" treatment.
const defaultValues: FormValues = {
  bookTitle: 'Album für die Jugend, Op. 68',
  composer: [],
  arranger: [],
  yearWritten: '',
  workOpusNumber: '',
  publisher: '',
  publisherId: '',
  isbn: '',
  imslpNumber: '04154',
  sheetType: '',
  instruments: [],
  description: '',
}

// Same normalization every other IMSLP-number save path in the app
// already applies (a value typed with the label still attached, e.g.
// "IMSLP99999", shouldn't be treated as non-numeric just because of it).
function stripImslpPrefix(value: string): string {
  return value.replace(/^\s*imslp[\s:#-]*/i, '')
}

// Design doc §13's deferred "IMSLP live autofill" — see
// EditPieceModalMockup.tsx's own copy of this component for the full
// reasoning (same two faint-but-distinct states: a fetchable cloud once
// the effective number is valid/number-only, a fainter cloud-off
// otherwise, always visible either way). Not imported from there — every
// mockup route in this app is self-contained, and there's no *real*
// shared component to import here yet regardless, since this feature
// doesn't exist outside these two mockups.
//
// The trigger is genuinely different here, though: on the Piece Edit
// modal this is a manual click against a number the piece already has on
// record. Here, the number was *just* detected from the uploaded
// filename (design doc §5) moments before this screen ever appeared — so
// this screen also auto-runs the same fetch once, automatically, without
// waiting for a click. The button stays live afterward too, for
// re-running it if the user corrects a wrong auto-detected number.
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

// Stand-in for a real book-cover page image (this mockup has no real
// bookId to build a getBookPageThumbnailUrl(...) call against) — same
// drawn-SVG-page convention every other design-phase mockup in this app
// uses (PieceDetailsSample.tsx, EditPieceModalMockup.tsx).
function CoverPagePlaceholder({ page }: { page: number }) {
  return (
    <svg viewBox="0 0 200 260" className="h-auto w-full" role="img" aria-label={`Page ${page} preview`}>
      <rect x="0.5" y="0.5" width="199" height="259" fill="#fffdf9" stroke="#e4e0d8" />
      <text x="100" y="26" textAnchor="middle" fontFamily="Georgia, serif" fontSize="9" fill="#5c5349">
        Album für die Jugend
      </text>
      <text x="100" y="38" textAnchor="middle" fontFamily="Georgia, serif" fontSize="7" fill="#8f857a">
        Op. 68
      </text>
      {[58, 91, 124, 157, 190, 223].map((y) => (
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

// Local copy of PageLightbox.tsx, same "no shared component between a
// mockup and the real thing" convention as every other mockup in this
// codebase — see PieceDetailsSample.tsx's own copy for precedent. Renders
// CoverPagePlaceholder in place of a real page image, same as this
// mockup's inline preview above does.
function PageLightbox({
  page,
  pageCount,
  onClose,
  onPrev,
  onNext,
}: {
  page: number
  pageCount: number
  onClose: () => void
  onPrev: () => void
  onNext: () => void
}) {
  const [zoom, setZoom] = useState<'fit' | 'actual'>('fit')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft') onPrev()
      if (event.key === 'ArrowRight') onNext()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, onPrev, onNext])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-6 left-6 flex size-10 items-center justify-center rounded-full bg-ink/80 text-white shadow-md backdrop-blur-sm hover:bg-white/15 focus-visible:outline-accent-on-dark"
      >
        <IconXFilled size={20} />
      </button>

      <div className="pointer-events-none absolute top-6 right-6 rounded-full bg-ink/80 px-3 py-1.5 text-xs text-white/90 shadow-md backdrop-blur-sm">
        Click image to {zoom === 'fit' ? 'zoom in' : 'fit to screen'}
      </div>

      <button
        type="button"
        onClick={() => setZoom((z) => (z === 'fit' ? 'actual' : 'fit'))}
        aria-label={zoom === 'fit' ? 'Zoom in to actual size' : 'Zoom out to fit screen'}
        className={
          zoom === 'fit'
            ? 'flex max-h-[85vh] max-w-[90vw] cursor-zoom-in items-center justify-center'
            : 'max-h-[85vh] max-w-[90vw] cursor-zoom-out overflow-auto rounded-md'
        }
      >
        <div
          className={
            zoom === 'fit'
              ? 'w-[70vw] max-w-[440px] overflow-hidden rounded-md bg-paper-raised shadow-2xl sm:w-[420px]'
              : 'w-[820px] overflow-hidden rounded-md bg-paper-raised shadow-2xl'
          }
        >
          <CoverPagePlaceholder page={page} />
        </div>
      </button>

      {pageCount > 1 && (
        <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-ink/80 px-2 py-1 shadow-md backdrop-blur-sm">
          <button
            type="button"
            onClick={onPrev}
            disabled={page === 1}
            aria-label="Previous page"
            className="flex size-7 cursor-pointer items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-accent-on-dark disabled:pointer-events-none disabled:opacity-35"
          >
            <IconChevronLeft size={16} />
          </button>
          {/* "PDF p." prefix added (2026-08-27) to match the inline cycler
              below the main preview (this screen's own "PDF p. {n} / {N}"
              capsule, added for the same reason — this screen also has a
              printed-page number input right next to it, and a bare "n /
              N" could otherwise read as that instead of the PDF's own
              physical page). The lightbox is centered against the full
              viewport, not shrink-wrapped against a narrow cover box, so
              it isn't exposed to the width-clamping wrap bug the inline
              cycler's own comment describes — whitespace-nowrap added
              defensively anyway, cheap insurance against the same failure
              mode on a narrow viewport. */}
          <span className="text-xs whitespace-nowrap tabular-nums text-white/90">
            PDF p. {page} / {pageCount}
          </span>
          <button
            type="button"
            onClick={onNext}
            disabled={page === pageCount}
            aria-label="Next page"
            className="flex size-7 cursor-pointer items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-accent-on-dark disabled:pointer-events-none disabled:opacity-35"
          >
            <IconChevronRightFilled size={16} />
          </button>
        </div>
      )}
    </div>
  )
}

export function UploadBookAboutMockup() {
  useMockupTitle('Upload — About This Book')

  const [previewPage, setPreviewPage] = useState(1)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  // Printed-PDF page number offset — folded into this screen rather than
  // a dedicated wizard step (an earlier version of this feature, tried
  // and reverted). Bound to the same previewPage the cover cycler above
  // already drives, so flipping through the preview and correcting
  // whichever page you land on is the whole interaction. printedPage is
  // never stored directly — solving for a new offset on edit (instead of
  // storing the typed value) is what makes the field keep counting
  // forward correctly if you flip to another page afterward, rather than
  // freezing at whatever was last typed.
  const [pageOffset, setPageOffset] = useState(0)
  const printedPage = previewPage + pageOffset

  function handlePrintedPageChange(raw: string) {
    if (raw.trim() === '') return
    const typed = Number(raw)
    if (!Number.isFinite(typed)) return
    setPageOffset(typed - previewPage)
  }

  const {
    register,
    handleSubmit,
    control,
    watch,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues })

  const [imslpFetchState, setImslpFetchState] = useState<'idle' | 'fetching' | 'done'>('idle')
  const [imslpFilledFields, setImslpFilledFields] = useState<Set<string>>(new Set())
  const isValidImslpNumber = /^\d+$/.test(stripImslpPrefix(watch('imslpNumber')).trim())

  // Mockup only — no real IMSLP lookup happens here; setTimeout stands in
  // for the request. Fields it fills mirror EditPieceModalMockup.tsx's
  // own version of this (own reasoning there for why these specific
  // fields, and why only currently-blank ones) — composer/year/opus here
  // instead of composer/year/publisher/publisherId there, since this
  // fixture already starts with publisher/publisherId blank and workOpusNumber
  // is the one field a book-level IMSLP page reliably gives that this
  // fixture doesn't already have some value for. isValidImslpNumber guards
  // against firing when there's nothing usable — same rule as the
  // button's own disabled state, checked again here since the auto-run
  // effect below calls this directly, not through a click.
  function runImslpAutofill() {
    if (imslpFetchState !== 'idle' || !isValidImslpNumber) return
    setImslpFetchState('fetching')
    window.setTimeout(() => {
      const filled = new Set<string>()
      const current = getValues()
      if (current.composer.length === 0) {
        setValue('composer', [{ id: -1, name: 'Robert Schumann' }])
        filled.add('composer')
      }
      if (!current.yearWritten) {
        setValue('yearWritten', '1848')
        filled.add('yearWritten')
      }
      if (!current.workOpusNumber) {
        setValue('workOpusNumber', 'Op. 68')
        filled.add('workOpusNumber')
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

  // Runs once, automatically — no click needed, unlike the Piece Edit
  // modal's version, since a filename-detected number is already
  // considered confirmed by the time this screen exists at all (design
  // doc §5). The 700ms delay is deliberate, not filler: it's what keeps
  // this screen from ever silently arriving *pre-filled* — the user needs
  // to actually see the blank "About this book" screen first, then watch
  // the fetch/highlight sequence play out on it, not have the fields
  // already different the instant it mounts.
  useEffect(() => {
    const timer = window.setTimeout(runImslpAutofill, 700)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate one-shot on mount, matching "filename detection already ran, this screen just reacts to its result once" — re-running on every render (runImslpAutofill is recreated each render) would refire the whole fetch/highlight sequence any time this component re-renders for an unrelated reason.
  }, [])

  function onSubmit(data: FormValues) {
    // Mockup only — the real build advances to Screen 4 (Page Selection).
    console.log('Mockup submit (no real save):', data)
  }

  function handleCancelUpload() {
    const confirmed = window.confirm(
      "Cancel this upload? The uploaded file and its generated page previews will be permanently removed from the server.",
    )
    if (!confirmed) return
    // Mockup only. Real build: DELETE /api/books/{id} — already
    // cascade-deletes the book's uploaded PDF (handleDeleteBook,
    // internal/handlers/book.go), but that handler doesn't currently purge
    // this book's cached page thumbnails under data/cache/thumbnails —
    // needs a real fix alongside wiring this button up, not just a call
    // to the existing endpoint as-is. Then returns to the Upload landing
    // page, same "return to start" convention as UploadPage.tsx.
    console.log('Mockup: cancel confirmed — would delete book + cached thumbnails, return to Upload landing')
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6 md:p-8">
      <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
        Design mockup —{' '}
        <span className="font-medium text-ink">Book Upload Wizard, Screen 3 of 6: "About this book"</span> (design
        doc §5). Not wired to real data.
      </div>

      {/* Wizard chrome — locked, carries unchanged through screens 4-6.
          Back isn't real step-nav (this mockup doesn't simulate the whole
          wizard flow, just this one screen) — it routes to /mockup, same
          as every other mockup's Back control, so it's never a dead end. */}
      <div className="flex items-center justify-between">
        <Link to="/mockup" className="flex items-center gap-1.5 text-base text-ink-soft hover:text-ink">
          <IconArrowLeft size={24} />
          Back
        </Link>
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-xs text-ink-soft">
            Step {CURRENT_STEP} of {TOTAL_STEPS}
          </span>
          <div className="flex gap-1.5">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((step) => (
              <span
                key={step}
                className={`h-1 w-5 rounded-full ${
                  step < CURRENT_STEP ? 'bg-accent-on-dark' : step === CURRENT_STEP ? 'bg-accent' : 'bg-border'
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

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-7 sm:flex-row sm:items-start">
        {/* Cover column — sticky so it stays visible while the form
            scrolls, 210px wide (sized down from the piece-upload flow's
            own 340px thumb, since this screen has roughly 5x the form
            content that one does). */}
        <div className="flex w-full shrink-0 flex-col gap-2.5 sm:sticky sm:top-5 sm:w-[210px]">
          <div className="relative overflow-hidden rounded-lg border border-border bg-paper-raised shadow-sm">
            {/* Lightbox trigger — same click-to-enlarge treatment as
                Piece Details' own preview thumbnail. The whole cover is
                clickable, not just the corner badge. */}
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              aria-label={`View page ${previewPage} larger`}
              className="block w-full cursor-zoom-in"
            >
              <CoverPagePlaceholder page={previewPage} />
            </button>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-2 right-2 flex items-center justify-center rounded-full bg-ink/80 p-1.5 text-white shadow-md backdrop-blur-sm"
            >
              <IconArrowsDiagonal size={14} />
            </div>
            {/* Piece Details page's own floating capsule cycler (PiecePage.tsx),
                reused verbatim — a static page-1 cover doesn't always show
                what a book actually is (title pages, blanks, dedications),
                so being able to flip through it right here answers that
                without leaving the screen. */}
            {/* w-max is load-bearing, not decorative: an absolutely
                positioned element centered via left-1/2 + -translate-x-1/2
                has its shrink-to-fit width calculated against the space
                from left:50% to the containing block's right edge — only
                half the cover's width — before the translate visually
                re-centers it. On a narrow cover that half-width can be
                less than "N / NN" needs, wrapping the count onto two
                lines. w-max forces sizing to content instead, sidestepping
                that calculation entirely. */}
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
                PDF p. {previewPage} / {MOCK_PAGE_COUNT}
              </span>
              <button
                type="button"
                onClick={() => setPreviewPage((p) => Math.min(MOCK_PAGE_COUNT, p + 1))}
                disabled={previewPage === MOCK_PAGE_COUNT}
                aria-label="Next page"
                className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-accent-on-dark disabled:pointer-events-none disabled:opacity-35"
              >
                <IconChevronRightFilled size={14} />
              </button>
            </div>
          </div>
          <div className="text-[0.78rem] leading-relaxed text-ink-soft">
            <strong className="block break-words text-ink">{MOCK_FILENAME}</strong>
            {MOCK_PAGE_COUNT} pages • 18.4 MB
          </div>

          {/* Printed-PDF page number offset — sets one offset for the
              whole book, not a per-page correction. sourcePageStart/
              sourcePageEnd (the fields citations actually use) get
              physical page + this offset for every piece at import,
              rather than the raw PDF position. */}
          {/* Dashed border, matching EditPieceModal.tsx's own Copyright/
              Book Details disclosure boxes (direct request, 2026-09-05) —
              reads as an optional/secondary settings box rather than a
              regular solid-bordered field, same visual language this app
              already uses for "you probably don't need to touch this"
              sections. No bg-paper-raised here (the copyright box has none
              either) — this screen's own modal background already is
              paper-raised, so a matching fill was a no-op, not a
              deliberate distinct surface. */}
          <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-border p-4">
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
              Flip through the preview until you see a page number, then adjust the number above to match.
            </p>
            {pageOffset !== 0 && (
              <button
                type="button"
                onClick={() => setPageOffset(0)}
                className="flex w-fit cursor-pointer items-center gap-1.5 text-[0.78rem] text-ink-soft hover:text-ink"
              >
                <IconRotate size={12} />
                Reset — no offset
              </button>
            )}
          </div>
        </div>

        {lightboxOpen && (
          <PageLightbox
            key={previewPage}
            page={previewPage}
            pageCount={MOCK_PAGE_COUNT}
            onClose={() => setLightboxOpen(false)}
            onPrev={() => setPreviewPage((p) => Math.max(1, p - 1))}
            onNext={() => setPreviewPage((p) => Math.min(MOCK_PAGE_COUNT, p + 1))}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* Book title stands alone, full width — same field order as
              EditBookModalMockup.tsx: Title / Composer-
              Arranger / Year-Opus / Publisher-PublisherID / ISBN-IMSLP /
              SheetType+Instruments-Description. Kept in sync deliberately
              — this screen and the Edit Book Modal cover nearly the same
              field set, so a user shouldn't have to relearn field
              positions between first entering a book's info here and
              editing it again later. */}
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
            <div className="min-w-0 flex-1">
              <Controller
                name="composer"
                control={control}
                render={({ field }) => (
                  <TagComboBox
                    label="Composer"
                    options={PEOPLE_OPTIONS}
                    selected={field.value}
                    multiple
                    onChange={field.onChange}
                    pillStyle="paper"
                    newOptionLabel="New person"
                    highlighted={imslpFilledFields.has('composer')}
                    labelExtra={
                      <InfoTooltip
                        message="If neither composer nor arranger is set here, you will be later prompted to enter one for each piece."
                        ariaLabel="What happens if Composer and Arranger are both left blank"
                        triggerClassName="text-[#9d9892] hover:text-ink-soft"
                      >
                        <IconInfoCircle size={13} />
                      </InfoTooltip>
                    }
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
                    options={PEOPLE_OPTIONS}
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
              same reasoning as EditBookModalMockup.tsx: Sheet Type moves
              down to join Instruments in the closing stacked column below,
              freeing this row for the two identifier fields to sit
              together. */}
          <div className="flex flex-col gap-3 min-[525px]:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor="f-isbn" className="text-sm text-ink-soft">
                ISBN Number
              </label>
              <input
                id="f-isbn"
                placeholder="e.g. 978-0-13-235088-4"
                className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 font-mono text-ink placeholder:text-ink-soft/40 placeholder:italic"
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
                  EditPieceModalMockup.tsx's own copy of this field. */}
              <div className="relative">
                <input
                  id="f-imslp"
                  className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 pr-9 font-mono text-ink"
                  {...register('imslpNumber', { maxLength: 255 })}
                />
                <ImslpAutofillButton
                  state={imslpFetchState}
                  valid={isValidImslpNumber}
                  onClick={runImslpAutofill}
                />
              </div>
            </div>
          </div>

          {/* Closing two-column row: Sheet Type/Instruments stacked on the
              left, Description spanning the same height on the right —
              the one genuinely tall field gets the one genuinely tall
              column, same treatment as EditBookModalMockup.tsx. Description
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
                    options={SHEET_TYPE_SELECT_OPTIONS}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
              <Controller
                name="instruments"
                control={control}
                render={({ field }) => (
                  // TagComboBox's own internal input has no placeholder
                  // styling of its own (a shared component used all over
                  // the app — not changing its global default for one
                  // page's request). Scoped here instead via an arbitrary
                  // variant targeting just this instance's input, matching
                  // every other placeholder on this page (italic,
                  // ink-soft/40).
                  <div className="[&_input::placeholder]:text-ink-soft/40 [&_input::placeholder]:italic">
                    <TagComboBox
                      label="Instruments"
                      options={INSTRUMENT_OPTIONS}
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
                // resize-none, same reasoning as EditBookModalMockup.tsx's
                // own fix: flex-1/min-h-0 on this column drive the
                // textarea's actual height, so a manual resize handle
                // would either get fought back to the flex-derived height
                // or fight the layout around it.
                className="min-h-[96px] flex-1 resize-none rounded-md border border-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-soft/40 placeholder:italic"
                {...register('description')}
              />
            </div>
          </div>

          {/* Cancel upload shares this row with Next rather than living up
              in the top chrome — it's a page-level action on the same
              footing as Next/Import (not a step-nav control like Back),
              so it belongs where the other page-level actions are. Styled
              as a plain text link, not a bordered button — same visual
              weight as Back up in the chrome (same gap-1.5/text-base/icon
              size), so it doesn't compete with Next's own primacy. Solid
              red rather than a translucent shade — IconX is two
              overlapping crossing lines, so a translucent color would
              double-blend at the crossing point (the icon-preblend rule
              elsewhere in this app, e.g. plus/book-off); permanently red
              rather than hover-only, same reasoning as the Delete
              Piece/Delete Book toolbar buttons — destructive should read
              as such at a glance. */}
          <div className="mt-2 flex items-center justify-between border-t border-border pt-5">
            <button
              type="button"
              onClick={handleCancelUpload}
              className="flex cursor-pointer items-center gap-1.5 text-base text-red-700 hover:text-red-800"
            >
              <IconX size={24} />
              Cancel upload
            </button>
            <button
              type="submit"
              className="flex cursor-pointer items-center gap-1.5 rounded-md bg-accent px-5 py-2.5 font-display text-white hover:bg-accent/90"
            >
              Next
              <IconArrowRight size={16} />
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
