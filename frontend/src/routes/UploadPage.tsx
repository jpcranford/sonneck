import { useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  IconArrowLeft,
  IconArrowsDiagonal,
  IconBook2,
  IconChevronLeft,
  IconChevronRightFilled,
  IconCloudUpload,
  IconFileMusic,
  IconFileTypePdf,
  IconCircleCheckFilled,
  IconAlertTriangle,
  IconMusic,
} from '@tabler/icons-react'
import { getPieceThumbnailUrl, uploadPiece, updatePiece } from '../api/pieces'
import { ApiError } from '../api/client'
import type { Piece } from '../api/types'
import { namesToText, textToNames } from '../lib/joinNames'
import { loadWizardDraft } from '../lib/useWizardDraft'
import { PageLightbox } from '../components/PageLightbox'
import { SourceBookField } from '../components/SourceBookField'
import { BookUploadWizard } from './BookUploadWizard'

// Mirrors the backend's own cap (internal/handlers/helpers.go MaxUploadBytes)
// so an oversized file is rejected instantly instead of after a slow upload.
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024

function validateFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    return 'Only PDF files are supported.'
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return 'File exceeds the 500 MB upload limit.'
  }
  return null
}

// Same conversion EditPieceModal.tsx uses for these same two fields — kept
// as its own local copy rather than shared, same convention as the rest of
// this file (SourceBookField is the one thing actually reused as-is).
function toIntOrNull(value: string): number | null {
  if (value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

interface DetailsForm {
  title: string
  composer: string
  sourceBookId: number | null
  sourcePageStart: string
  sourcePageEnd: string
}

type Stage = 'landing' | 'select' | 'uploading' | 'details' | 'success' | 'book'

export function UploadPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // A hard reload mid-wizard would otherwise strand the user on the plain
  // landing fork with no obvious way back in — BookUploadWizard itself
  // knows how to resume a draft once mounted, but it only ever mounts
  // when stage === 'book', so getting there in the first place is this
  // page's own job, checked once at the lazy-init.
  const [stage, setStage] = useState<Stage>(() => (loadWizardDraft() ? 'book' : 'landing'))
  const [fileError, setFileError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [piece, setPiece] = useState<Piece | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Page cycler + lightbox state for the "About this piece" preview —
  // same assembly as PiecePage.tsx's own preview column, just living here
  // instead since this screen shows it before the piece has a page of its
  // own to navigate to. previewPage seeds from the upload's own
  // thumbnailPage in onSuccess below, same starting page the old static
  // thumb always showed.
  const [previewPage, setPreviewPage] = useState(1)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const {
    register,
    handleSubmit,
    reset: resetDetailsForm,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm<DetailsForm>()
  const watchedSourceBookId = watch('sourceBookId')

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      setProgress(0)
      return uploadPiece(file, setProgress)
    },
    onSuccess: ({ piece: uploaded, alreadyExists }) => {
      if (alreadyExists) {
        navigate(`/pieces/${uploaded.id}`, { state: { backLabel: 'Upload' } })
        return
      }
      queryClient.invalidateQueries({ queryKey: ['pieces'] })
      setPiece(uploaded)
      setPreviewPage(uploaded.thumbnailPage)
      setLightboxOpen(false)
      resetDetailsForm({
        title: uploaded.title,
        // Composer is an ordered Person list now (composer/arranger
        // overhaul, migration 00020) — bridged to this still-plain-text
        // field as a comma-separated string (namesToText/textToNames,
        // lib/joinNames.ts). EditPieceModal.tsx's own composer field got
        // a real multi-person TagComboBox in Stage C; this screen's own
        // one-shot upload-details field deliberately did not (out of that
        // stage's scope) and still uses this bridge.
        composer: namesToText(uploaded.composer.values.map((p) => p.name)),
        sourceBookId: null,
        sourcePageStart: '',
        sourcePageEnd: '',
      })
      setStage('details')
    },
    onError: () => setStage('select'),
  })

  const saveMutation = useMutation({
    mutationFn: (data: DetailsForm) =>
      updatePiece(piece!.id, {
        title: data.title,
        composers: textToNames(data.composer),
        arrangers: [],
        sourceBookId: data.sourceBookId,
        sourcePageStart: toIntOrNull(data.sourcePageStart),
        sourcePageEnd: toIntOrNull(data.sourcePageEnd),
        favorite: false,
        keys: [],
        instruments: [],
        userTags: [],
      }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['pieces'] })
      setPiece(updated)
      setStage('success')
    },
  })

  function beginUpload(file: File) {
    const error = validateFile(file)
    if (error) {
      setFileError(error)
      return
    }
    setFileError(null)
    setStage('uploading')
    uploadMutation.mutate(file)
  }

  function reset() {
    setStage('landing')
    setFileError(null)
    setProgress(0)
    setPiece(null)
    uploadMutation.reset()
    saveMutation.reset()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // The book wizard's own steps are wide (max-w-4xl) and manage their own
  // centering/padding/top-alignment — nesting them inside the narrow
  // single-piece flow's `items-center justify-center p-8` wrapper below
  // would both double up padding and vertically center content that's
  // meant to sit at the top (a tall Split/Titles screen would otherwise
  // risk being pushed above the viewport by justify-center). A plain
  // flex-1 column, matching every other page's own root, is all it needs.
  if (stage === 'book') {
    return (
      <div className="flex flex-1 flex-col">
        <BookUploadWizard onExit={() => setStage('landing')} />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      {/* Landing fork, not a segmented toggle/tabs: these two paths diverge
          into structurally different flows (one file field vs. the book-
          splitting wizard below), not just a different layout of the same
          data, so it's worth a beat of real explanation rather than a
          pill someone might not notice has two settings. */}
      {stage === 'landing' && (
        <div className="flex w-full max-w-md flex-col gap-4">
          <h1 className="font-display text-2xl font-medium text-ink">What are you uploading?</h1>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setStage('select')}
              className="flex items-start gap-3.5 rounded-xl border-[1.5px] border-border bg-paper-raised p-4 text-left transition-colors hover:border-accent"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-paper-sunken text-ink-soft">
                <IconFileMusic size={19} />
              </span>
              <span>
                <span className="block font-display text-[0.98rem] font-medium text-ink">
                  Upload a piece
                </span>
                <span className="block text-[0.8rem] text-ink-soft">
                  One PDF, one piece of music. The common case.
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setStage('book')}
              className="flex items-start gap-3.5 rounded-xl border-[1.5px] border-border bg-paper-raised p-4 text-left transition-colors hover:border-accent"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-paper-sunken text-ink-soft">
                <IconBook2 size={19} />
              </span>
              <span>
                <span className="block font-display text-[0.98rem] font-medium text-ink">
                  Upload a book
                </span>
                <span className="block text-[0.8rem] text-ink-soft">
                  One PDF containing several pieces — we'll walk you through splitting it up.
                </span>
              </span>
            </button>
          </div>
        </div>
      )}

      {stage === 'select' && (
        <div className="flex w-full max-w-md flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => setStage('landing')}
            className="flex items-center gap-1.5 self-start text-base text-ink-soft hover:text-ink"
          >
            <IconArrowLeft size={24} />
            Back
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragOver(false)
              const file = event.dataTransfer.files[0]
              if (file) beginUpload(file)
            }}
            className={`flex w-full flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-12 text-center transition-colors ${
              dragOver
                ? 'border-accent bg-accent-soft'
                : 'border-border bg-paper-raised hover:border-accent'
            }`}
          >
            <IconCloudUpload size={40} className="text-ink-soft" />
            <span className="font-display text-lg font-medium text-ink">
              Drag a PDF here, or tap to choose a file
            </span>
            <span className="text-sm text-ink-soft">Up to 500 MB</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) beginUpload(file)
            }}
          />
          {fileError && (
            <p className="flex items-center gap-2 text-sm text-red-700">
              <IconAlertTriangle size={16} />
              {fileError}
            </p>
          )}
          {uploadMutation.isError && (
            <p className="flex items-center gap-2 text-sm text-red-700">
              <IconAlertTriangle size={16} />
              {uploadMutation.error instanceof ApiError
                ? uploadMutation.error.message
                : 'Upload failed. Please try again.'}
            </p>
          )}
        </div>
      )}

      {stage === 'uploading' && (
        <div className="flex w-full max-w-md flex-col items-center gap-3">
          <IconFileTypePdf size={40} className="text-ink-soft" />
          <div className="h-2 w-full overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${Math.round(progress)}%` }}
            />
          </div>
          <span className="text-sm text-ink-soft">Uploading… {Math.round(progress)}%</span>
        </div>
      )}

      {stage === 'details' && piece && (
        <form
          onSubmit={handleSubmit((data) => saveMutation.mutate(data))}
          className="flex w-full max-w-2xl flex-col gap-4"
        >
          {/* "About this piece" directly mirrors the book wizard's own
              metadata-fill step heading ("About this book,"
              BookUploadAboutStep.tsx), since this screen does the
              identical job for the single-piece path. */}
          <h1 className="font-display text-2xl font-medium text-ink">About this piece</h1>
          {/* Same page cycler + lightbox assembly as PiecePage.tsx's own
              preview column (and BookUploadAboutStep.tsx's book-page
              equivalent) — click to enlarge, prev/next through the
              piece's own pages, rather than a single static image of just
              the thumbnail page. Wrapper sizing (340px / min-h-[440px])
              deliberately unchanged from the old static thumb it
              replaces — thumb on the left, fields + Save stacked on the
              right rather than spanning the full row under it. */}
          <div className="flex flex-col items-start gap-7 sm:flex-row">
            {/* Same reserved-frame fix as the Book Upload Wizard's cover
                preview (BookUploadAboutStep.tsx): thumbnail generation is
                synchronous and can take a real moment right after upload
                (internal/handlers/piece.go's handlePieceThumbnail), so
                without a reserved box this panel read as empty during that
                gap. min-h (not a fixed aspect-ratio box like the book
                cover's) — this thumb deliberately shows the full,
                uncropped page rather than a cropped "cover" treatment, so
                the box must be free to grow taller than the placeholder
                once the real image loads, not clipped to a fixed ratio.
                440px ≈ this wrapper's 340px width at a typical US Letter
                page's aspect ratio, just a reasonable placeholder guess. */}
            <div className="relative w-full max-w-[340px] min-h-[440px] shrink-0 overflow-hidden rounded-lg border border-border bg-paper-sunken shadow-sm sm:w-[340px]">
              <button
                type="button"
                onClick={() => setLightboxOpen(true)}
                aria-label={`View page ${previewPage} larger`}
                className="block w-full cursor-zoom-in"
              >
                <img
                  key={previewPage}
                  src={getPieceThumbnailUrl(piece.id, previewPage)}
                  alt={`Page ${previewPage} of ${piece.title}`}
                  className="h-auto w-full"
                />
              </button>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-2.5 right-2.5 flex items-center justify-center rounded-full bg-ink/80 p-1.5 text-white shadow-md backdrop-blur-sm"
              >
                <IconArrowsDiagonal size={14} />
              </div>
              {piece.pageCount > 1 && (
                <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-ink/80 px-2 py-1 shadow-md backdrop-blur-sm">
                  <button
                    type="button"
                    onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                    disabled={previewPage === 1}
                    aria-label="Previous page"
                    className="flex size-6 cursor-pointer items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-accent-on-dark disabled:pointer-events-none disabled:opacity-35"
                  >
                    <IconChevronLeft size={14} />
                  </button>
                  <span className="text-xs tabular-nums text-white/90">
                    {previewPage} / {piece.pageCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPreviewPage((p) => Math.min(piece.pageCount, p + 1))}
                    disabled={previewPage === piece.pageCount}
                    aria-label="Next page"
                    className="flex size-6 cursor-pointer items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-accent-on-dark disabled:pointer-events-none disabled:opacity-35"
                  >
                    <IconChevronRightFilled size={14} />
                  </button>
                </div>
              )}
            </div>
            {lightboxOpen && (
              <PageLightbox
                key={previewPage}
                imageUrl={getPieceThumbnailUrl(piece.id, previewPage)}
                alt={`Page ${previewPage} of ${piece.title}`}
                page={previewPage}
                pageCount={piece.pageCount}
                onClose={() => setLightboxOpen(false)}
                onPrev={() => setPreviewPage((p) => Math.max(1, p - 1))}
                onNext={() => setPreviewPage((p) => Math.min(piece.pageCount, p + 1))}
              />
            )}
            <div className="flex w-full min-w-0 flex-1 flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="title" className="text-sm text-ink-soft">
                  Title
                </label>
                <input
                  id="title"
                  className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                  {...register('title', { required: 'Title is required.', maxLength: 255 })}
                />
                {errors.title && <p className="text-sm text-red-700">{errors.title.message}</p>}
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="composer" className="text-sm text-ink-soft">
                  Composer
                </label>
                <input
                  id="composer"
                  className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                  {...register('composer', { required: 'Composer is required.', maxLength: 255 })}
                />
                {errors.composer && (
                  <p className="text-sm text-red-700">{errors.composer.message}</p>
                )}
              </div>
              {/* Book link prompt —
                  the single-piece path never gets a chance to associate a
                  sourceBookId at all otherwise, unlike the book wizard
                  (whose confirm-import step sets it automatically) or
                  editing later (EditPieceModal's own Book Details section).
                  Reuses SourceBookField as-is — the exact same search-as-
                  you-type component and copy already established there —
                  rather than inventing a one-off variant; the one-line
                  question above it is what turns a bare field into a
                  prompt, since "come back and link it later if you want"
                  is the point being made, not just "here's a field." Fully
                  optional: omitted validation rules, and the write below
                  passes sourceBookId through as-is (null unless a book was
                  picked). */}
              <div className="flex flex-col gap-1">
                <p className="text-sm text-ink-soft">
                  Is this piece from a book already in your library?
                </p>
                <Controller
                  name="sourceBookId"
                  control={control}
                  defaultValue={null}
                  render={({ field }) => (
                    <SourceBookField
                      value={field.value}
                      onChange={(value) => {
                        field.onChange(value)
                        // Clearing the matched book hides the page fields
                        // below (see the conditional render right after
                        // this), but hiding them doesn't clear their form
                        // values on its own — without this, a stale 5/7
                        // typed in before clearing the book would still
                        // get submitted alongside sourceBookId: null,
                        // orphaned page numbers with no book to describe.
                        if (value == null) {
                          setValue('sourcePageStart', '')
                          setValue('sourcePageEnd', '')
                        }
                      }}
                      initialTitle={null}
                    />
                  )}
                />
              </div>
              {/* Start/end page, shown only once a book is actually
                  matched — offering these with no book selected would beg
                  the question "page of what?" Fully optional (no
                  validation rules), same treatment as sourceBookId itself
                  and as EditPieceModal's own copy of these two fields,
                  which this mirrors exactly (label text, input type,
                  flex-1 two-up row) since it's the same data. */}
              {watchedSourceBookId != null && (
                <div className="flex gap-3">
                  <div className="flex flex-1 flex-col gap-1">
                    <label htmlFor="sourcePageStart" className="text-sm text-ink-soft">
                      Start page
                    </label>
                    <input
                      id="sourcePageStart"
                      type="number"
                      className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                      {...register('sourcePageStart')}
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <label htmlFor="sourcePageEnd" className="text-sm text-ink-soft">
                      End page
                    </label>
                    <input
                      id="sourcePageEnd"
                      type="number"
                      className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                      {...register('sourcePageEnd')}
                    />
                  </div>
                </div>
              )}
              {saveMutation.isError && (
                <p className="flex items-center gap-2 text-sm text-red-700">
                  <IconAlertTriangle size={16} />
                  {saveMutation.error instanceof ApiError
                    ? saveMutation.error.message
                    : 'Could not save. Please try again.'}
                </p>
              )}
              <button
                type="submit"
                disabled={saveMutation.isPending}
                className="rounded-md bg-accent px-4 py-2 font-display text-white disabled:opacity-60"
              >
                {saveMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      )}

      {stage === 'success' && piece && (
        <div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
          <IconCircleCheckFilled size={40} className="text-accent" />
          {/* font-medium on the h1 itself now (added under the app-wide
              "every serifed heading is at least 500 weight" rule) — this
              supersedes the earlier deliberate choice to keep the
              surrounding "…" uploaded text at regular weight, contrasting
              it against the piece-title span. The inner span's own
              font-medium is now redundant but harmless; left in place
              rather than touched for an unrelated reason. */}
          <h1 className="font-display text-2xl font-medium text-ink">
            "<span className="font-medium">{piece.title}</span>" uploaded
          </h1>
          {/* "View piece" alongside "Upload another file" — same
              accent-filled/bordered pairing as the Book Upload Wizard's
              own success screen ("Open book" next to "Upload another
              file", BookUploadWizard.tsx). */}
          <div className="mt-1 flex items-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
            >
              Upload another file
            </button>
            <Link
              to={`/pieces/${piece.id}`}
              state={{ backLabel: 'Upload' }}
              className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90"
            >
              <IconMusic size={16} />
              View Piece
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
