import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  IconArrowLeft,
  IconBook2,
  IconCloudUpload,
  IconFileMusic,
  IconFileTypePdf,
  IconCircleCheckFilled,
  IconAlertTriangle,
} from '@tabler/icons-react'
import { getPieceThumbnailUrl, uploadPiece, updatePiece } from '../api/pieces'
import { ApiError } from '../api/client'
import type { Piece } from '../api/types'
import { loadWizardDraft } from '../lib/useWizardDraft'
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

interface DetailsForm {
  title: string
  composer: string
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

  const {
    register,
    handleSubmit,
    reset: resetDetailsForm,
    formState: { errors },
  } = useForm<DetailsForm>()

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      setProgress(0)
      return uploadPiece(file, setProgress)
    },
    onSuccess: ({ piece: uploaded, alreadyExists }) => {
      if (alreadyExists) {
        navigate(`/pieces/${uploaded.id}`)
        return
      }
      queryClient.invalidateQueries({ queryKey: ['pieces'] })
      setPiece(uploaded)
      resetDetailsForm({ title: uploaded.title, composer: uploaded.composer.value })
      setStage('details')
    },
    onError: () => setStage('select'),
  })

  const saveMutation = useMutation({
    mutationFn: (data: DetailsForm) =>
      updatePiece(piece!.id, {
        title: data.title,
        composer: data.composer,
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
      {/* Landing fork — "B" from the "Piece or Book?" design review
          (https://claude.ai/code/artifact/9152253a-3609-40a0-8fef-d17bcda72dba),
          locked in over a segmented toggle/tabs: these two paths diverge
          into structurally different flows (one file field vs. the future
          book-splitting wizard below), not just a different layout of the
          same data, so it's worth a beat of real explanation rather than a
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
          <h1 className="font-display text-2xl font-medium text-ink">Piece details</h1>
          {/* Large first-page thumbnail so what's about to be saved is
              visually confirmed, not just taken on faith from the
              filename — locked design (design-review/upload-details-thumb-
              preview-v4.png, 2026-08-19): thumb on the left, fields +
              Save stacked on the right rather than spanning the full row
              under it. */}
          <div className="flex flex-col items-start gap-7 sm:flex-row">
            <div className="w-full max-w-[340px] shrink-0 overflow-hidden rounded-lg border border-border shadow-sm sm:w-[340px]">
              <img
                src={getPieceThumbnailUrl(piece.id, piece.thumbnailPage)}
                alt=""
                className="block w-full"
              />
            </div>
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
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
          >
            Upload another file
          </button>
        </div>
      )}
    </div>
  )
}
