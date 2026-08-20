import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  IconArrowLeft,
  IconArrowRight,
  IconChevronLeft,
  IconChevronRightFilled,
  IconCheck,
  IconInfoCircle,
  IconAlertTriangle,
} from '@tabler/icons-react'
import { updateBook, getBookPageThumbnailUrl } from '../api/books'
import { listInstruments, listSheetTypes } from '../api/lookups'
import { ApiError } from '../api/client'
import type { Book, BookWriteRequest, Tag } from '../api/types'
import { TagComboBox } from '../components/TagComboBox'
import { SingleSelect } from '../components/SingleSelect'
import { InfoTooltip } from '../components/InfoTooltip'
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
  yearWritten: string
  workOpusNumber: string
  publisher: string
  publisherId: string
  imslpNumber: string
  sheetType: string
  instruments: Tag[]
  description: string
}

function bookToFormValues(book: Book): FormValues {
  return {
    bookTitle: book.bookTitle,
    composer: book.composer ?? '',
    yearWritten: book.yearWritten ?? '',
    workOpusNumber: book.workOpusNumber ?? '',
    publisher: book.publisher ?? '',
    publisherId: book.publisherId ?? '',
    imslpNumber: book.imslpNumber ?? '',
    sheetType: book.sheetType?.name ?? '',
    instruments: book.instruments,
    description: book.description ?? '',
  }
}

function formValuesToWriteRequest(data: FormValues): BookWriteRequest {
  return {
    bookTitle: data.bookTitle,
    composer: data.composer || null,
    yearWritten: data.yearWritten || null,
    workOpusNumber: data.workOpusNumber || null,
    sheetTypeName: data.sheetType || null,
    publisher: data.publisher || null,
    publisherId: data.publisherId || null,
    description: data.description || null,
    imslpNumber: data.imslpNumber || null,
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
  onBack: () => void
  onNext: (updatedBook: Book) => void
}

export function BookUploadAboutStep({
  book,
  pageCount,
  fileSizeBytes,
  onBack,
  onNext,
}: BookUploadAboutStepProps) {
  const [previewPage, setPreviewPage] = useState(1)
  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: bookToFormValues(book) })

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
          className="flex items-center gap-1.5 text-base text-ink-soft hover:text-ink"
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
          {/* aspect-[2/3] + bg-paper-sunken, matching the "cover preview"
              box used elsewhere (BookGridCard, BookDetailsPage's own book
              cover) — not just styling parity. Thumbnail generation is
              synchronous and renders on first request per page (see
              internal/handlers/book.go's handleBookPageThumbnail), so right
              after upload, or right after turning to a not-yet-viewed page,
              this can take a real moment. Without a reserved, colored box
              the panel read as genuinely empty during that gap; the sunken
              background now fills it immediately, and key={previewPage}
              forces a fresh <img> per page turn so the previous page's
              frame doesn't sit frozen on screen while the new one renders. */}
          <div className="relative aspect-[2/3] overflow-hidden rounded-lg border border-border bg-paper-sunken shadow-sm">
            <img
              key={previewPage}
              src={getBookPageThumbnailUrl(book.id, previewPage)}
              alt=""
              className="h-full w-full object-cover object-top"
            />
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
                {previewPage} / {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPreviewPage((p) => Math.min(pageCount, p + 1))}
                disabled={previewPage === pageCount}
                aria-label="Next page"
                className="flex size-6 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-accent-on-dark disabled:pointer-events-none disabled:opacity-35"
              >
                <IconChevronRightFilled size={14} />
              </button>
            </div>
          </div>
          <div className="text-[0.78rem] leading-relaxed text-ink-soft">
            {book.originalFilename && (
              <strong className="block text-ink">{book.originalFilename}</strong>
            )}
            {pageCount} pages{fileSizeBytes != null ? ` • ${formatFileSize(fileSizeBytes)}` : ''}
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
              {errors.bookTitle && (
                <p className="text-sm text-red-700">{errors.bookTitle.message}</p>
              )}
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
                    options={sheetTypeSelectOptions}
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
                <div className="min-w-0 flex-1 [&_input::placeholder]:text-ink-soft/40 [&_input::placeholder]:italic">
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

          {saveMutation.isError && (
            <p className="flex items-center gap-2 text-sm text-red-700">
              <IconAlertTriangle size={16} />
              {saveMutation.error instanceof ApiError
                ? saveMutation.error.message
                : 'Could not save. Please try again.'}
            </p>
          )}

          <div className="mt-2 flex justify-end border-t border-border pt-5">
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="flex items-center gap-1.5 rounded-md bg-accent px-5 py-2.5 font-display text-white hover:bg-accent/90 disabled:opacity-60"
            >
              {saveMutation.isPending ? 'Saving…' : 'Next'}
              {!saveMutation.isPending && <IconArrowRight size={16} />}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
