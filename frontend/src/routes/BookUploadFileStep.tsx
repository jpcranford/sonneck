import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { IconArrowLeft, IconCloudUpload, IconAlertTriangle } from '@tabler/icons-react'
import { uploadBook } from '../api/books'
import { ApiError } from '../api/client'
import type { Book } from '../api/types'

// Book Upload Wizard, "drag-and-drop the book file" step — deliberately
// just the existing single-piece dropzone (UploadPage.tsx's `stage ===
// 'select'` block)
// reused verbatim, pointed at uploadBook instead of uploadPiece, not a
// designed screen of its own — no wizard step-counter chrome here, same
// as the piece flow's own dropzone doesn't have one.

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

interface BookUploadFileStepProps {
  onBack: () => void
  onUploaded: (book: Book, pageCount: number, fileSizeBytes: number) => void
}

export function BookUploadFileStep({ onBack, onUploaded }: BookUploadFileStepProps) {
  const [fileError, setFileError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingSizeRef = useRef(0)

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      setProgress(0)
      pendingSizeRef.current = file.size
      return uploadBook(file, setProgress)
    },
    onSuccess: ({ book, pageCount }) => onUploaded(book, pageCount, pendingSizeRef.current),
  })

  function beginUpload(file: File) {
    const error = validateFile(file)
    if (error) {
      setFileError(error)
      return
    }
    setFileError(null)
    uploadMutation.mutate(file)
  }

  if (uploadMutation.isPending) {
    return (
      <div className="flex w-full flex-1 flex-col items-center justify-center gap-6 p-8">
        <div className="flex w-full max-w-md flex-col items-center gap-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${Math.round(progress)}%` }}
            />
          </div>
          <span className="text-sm text-ink-soft">Uploading… {Math.round(progress)}%</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="flex w-full max-w-md flex-col items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex cursor-pointer items-center gap-1.5 self-start text-base text-ink-soft hover:text-ink"
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
    </div>
  )
}
