import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import {
  IconArrowLeft,
  IconArrowRight,
  IconChevronLeft,
  IconChevronRightFilled,
  IconCheck,
  IconInfoCircle,
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
// Locked design: https://claude.ai/code/artifact/6feed451-b077-4922-a810-7682faf48144
// (Option C — persistent left cover column, sticky, carrying Piece View's
// own floating page-cycler capsule). Full decision history for all 6
// wizard screens is in the frontend-book-upload-wizard memory, not
// repeated here.
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

const MOCK_FILENAME = 'Album_für_die_Jugend_Op_68.pdf'
const MOCK_PAGE_COUNT = 42
const TOTAL_STEPS = 6
const CURRENT_STEP = 3

interface FormValues {
  bookTitle: string
  composer: string
  yearWritten: string
  workOpusNumber: string
  publisher: string
  publisherId: string
  imslpNumber: string
  sheetType: string
  instruments: Tag[]
  description: string
}

// bookTitle pre-filled from the uploaded filename, imslpNumber
// auto-detected from it (design doc §5) — both real behaviors already
// established at the upload step, just shown here as their result.
// Everything else starts blank; nothing but bookTitle is required.
const defaultValues: FormValues = {
  bookTitle: 'Album für die Jugend, Op. 68',
  composer: '',
  yearWritten: '',
  workOpusNumber: '',
  publisher: '',
  publisherId: '',
  imslpNumber: 'IMSLP04154',
  sheetType: '',
  instruments: [],
  description: '',
}

// Stand-in for a real book-cover page image (this mockup has no real
// bookId to build a getBookPageThumbnailUrl(...) call against) — same
// drawn-SVG-page convention every other design-phase mockup in this app
// uses (PieceViewSample.tsx, EditPieceModalMockup.tsx).
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

export function UploadBookAboutMockup() {
  useMockupTitle('Upload — About This Book')

  const [previewPage, setPreviewPage] = useState(1)
  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues })

  function onSubmit(data: FormValues) {
    // Mockup only — the real build advances to Screen 4 (Page Selection).
    console.log('Mockup submit (no real save):', data)
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6 md:p-8">
      <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
        Design mockup —{' '}
        <span className="font-medium text-ink">Book Upload Wizard, Screen 3 of 6: "About this book"</span> (design
        doc §5). Not wired to real data.
      </div>

      {/* Wizard chrome — locked, carries unchanged through screens 4-6. */}
      <div className="flex items-center justify-between">
        <button type="button" className="flex items-center gap-1.5 text-base text-ink-soft hover:text-ink">
          <IconArrowLeft size={24} />
          Back
        </button>
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
            <CoverPagePlaceholder page={previewPage} />
            {/* Piece View's own floating capsule cycler (PiecePage.tsx),
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
            <div className="absolute bottom-2.5 left-1/2 flex w-max -translate-x-1/2 items-center gap-1 rounded-full bg-ink/80 py-1 pr-1 pl-3 shadow-md backdrop-blur-sm">
              <button
                type="button"
                onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                disabled={previewPage === 1}
                aria-label="Previous page"
                className="flex size-6 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-accent-on-dark disabled:pointer-events-none disabled:opacity-35"
              >
                <IconChevronLeft size={14} />
              </button>
              <span className="text-xs whitespace-nowrap tabular-nums text-white/90">
                {previewPage} / {MOCK_PAGE_COUNT}
              </span>
              <button
                type="button"
                onClick={() => setPreviewPage((p) => Math.min(MOCK_PAGE_COUNT, p + 1))}
                disabled={previewPage === MOCK_PAGE_COUNT}
                aria-label="Next page"
                className="flex size-6 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-accent-on-dark disabled:pointer-events-none disabled:opacity-35"
              >
                <IconChevronRightFilled size={14} />
              </button>
            </div>
          </div>
          <div className="text-[0.78rem] leading-relaxed text-ink-soft">
            <strong className="block text-ink">{MOCK_FILENAME}</strong>
            {MOCK_PAGE_COUNT} pages • 18.4 MB
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-col gap-3 min-[525px]:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
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
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor="f-composer" className="flex items-center gap-1 text-sm text-ink-soft">
                Composer
                <InfoTooltip
                  message="If no composer is set here, you will be later prompted to enter one for each piece."
                  ariaLabel="What happens if Composer is left blank"
                  triggerClassName="text-[#9d9892] hover:text-ink-soft"
                >
                  <IconInfoCircle size={13} />
                </InfoTooltip>
              </label>
              <input
                id="f-composer"
                placeholder="e.g. Robert Schumann"
                className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-soft/40 placeholder:italic"
                {...register('composer', { maxLength: 255 })}
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
                className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-soft/40 placeholder:italic"
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
                className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-soft/40 placeholder:italic"
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
                className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-soft/40 placeholder:italic"
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
                className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-soft/40 placeholder:italic"
                {...register('publisherId', { maxLength: 255 })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 min-[525px]:flex-row">
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
              <input
                id="f-imslp"
                className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                {...register('imslpNumber', { maxLength: 255 })}
              />
            </div>
            <Controller
              name="sheetType"
              control={control}
              render={({ field }) => (
                <div className="min-w-0 flex-1">
                  <SingleSelect
                    label="Sheet Type"
                    options={SHEET_TYPE_SELECT_OPTIONS}
                    value={field.value}
                    onChange={field.onChange}
                  />
                </div>
              )}
            />
          </div>

          <div className="flex flex-col gap-3 min-[525px]:flex-row">
            <Controller
              name="instruments"
              control={control}
              render={({ field }) => (
                // TagComboBox's own internal input has no placeholder
                // styling of its own (a shared component used all over the
                // app — not changing its global default for one page's
                // request). Scoped here instead via an arbitrary variant
                // targeting just this instance's input, matching every
                // other placeholder on this page (italic, ink-soft/40).
                <div className="min-w-0 flex-1 [&_input::placeholder]:text-ink-soft/40 [&_input::placeholder]:italic">
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
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor="f-description" className="text-sm text-ink-soft">
                Description
              </label>
              <input
                id="f-description"
                placeholder="Optional notes about this book…"
                className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-soft/40 placeholder:italic"
                {...register('description')}
              />
            </div>
          </div>

          <div className="mt-2 flex justify-end border-t border-border pt-5">
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-md bg-accent px-5 py-2.5 font-display text-white hover:bg-accent/90"
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
