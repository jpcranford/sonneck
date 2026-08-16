import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  IconCloudUpload,
  IconFileTypePdf,
  IconCircleCheckFilled,
  IconAlertTriangle,
} from '@tabler/icons-react'
import { uploadPiece, updatePiece } from '../api/pieces'
import { ApiError } from '../api/client'
import type { Piece } from '../api/types'

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

type Stage = 'select' | 'uploading' | 'details' | 'success'

export function UploadPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [stage, setStage] = useState<Stage>('select')
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
    setStage('select')
    setFileError(null)
    setProgress(0)
    setPiece(null)
    uploadMutation.reset()
    saveMutation.reset()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      {stage === 'select' && (
        <div className="flex w-full max-w-md flex-col items-center gap-3">
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
            <span className="font-display text-lg text-ink">
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
          className="flex w-full max-w-md flex-col gap-4"
        >
          <h1 className="font-display text-2xl text-ink">Piece details</h1>
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
            {errors.composer && <p className="text-sm text-red-700">{errors.composer.message}</p>}
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
        </form>
      )}

      {stage === 'success' && piece && (
        <div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
          <IconCircleCheckFilled size={40} className="text-accent" />
          <h1 className="font-display text-2xl text-ink">
            "<span className="font-medium">{piece.title}</span>" uploaded
          </h1>
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
          >
            Upload another piece
          </button>
        </div>
      )}
    </div>
  )
}
