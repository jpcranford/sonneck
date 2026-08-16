import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IconAlertTriangleFilled } from '@tabler/icons-react'
import { updatePiece } from '../api/pieces'
import { ApiError } from '../api/client'
import { pieceToWriteRequest } from '../lib/pieceToWriteRequest'
import type { Piece } from '../api/types'
import { Modal } from './Modal'

interface EditPieceModalProps {
  piece: Piece
  open: boolean
  onClose: () => void
}

interface EditForm {
  title: string
  composer: string
}

// Phase 4's minimal rename surface (CLAUDE.md-adjacent scope note): title +
// composer only, same as Upload's fill-in-details step — not the full
// Piece Properties Edit Menu (design doc §15), which is a later, bigger
// feature covering every field with proper inherited/override controls.
export function EditPieceModal({ piece, open, onClose }: EditPieceModalProps) {
  const queryClient = useQueryClient()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EditForm>({ defaultValues: { title: piece.title, composer: piece.composer.value } })

  useEffect(() => {
    if (open) reset({ title: piece.title, composer: piece.composer.value })
  }, [open, piece, reset])

  const saveMutation = useMutation({
    mutationFn: (data: EditForm) =>
      updatePiece(piece.id, {
        ...pieceToWriteRequest(piece),
        title: data.title,
        composer: data.composer,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pieces'] })
      onClose()
    },
  })

  return (
    <Modal open={open} onClose={onClose} labelledBy="edit-piece-title">
      <form
        onSubmit={handleSubmit((data) => saveMutation.mutate(data))}
        className="flex flex-col gap-4"
      >
        <h2 id="edit-piece-title" className="font-display text-2xl text-ink">
          Edit piece
        </h2>
        <div className="flex flex-col gap-1">
          <label htmlFor="edit-title" className="text-sm text-ink-soft">
            Title
          </label>
          <input
            id="edit-title"
            className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
            {...register('title', { required: 'Title is required.', maxLength: 255 })}
          />
          {errors.title && <p className="text-sm text-red-700">{errors.title.message}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="edit-composer" className="text-sm text-ink-soft">
            Composer
          </label>
          <input
            id="edit-composer"
            className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
            {...register('composer', { required: 'Composer is required.', maxLength: 255 })}
          />
          {errors.composer && <p className="text-sm text-red-700">{errors.composer.message}</p>}
        </div>
        {saveMutation.isError && (
          <p className="flex items-center gap-2 text-sm text-red-700">
            <IconAlertTriangleFilled size={16} />
            {saveMutation.error instanceof ApiError
              ? saveMutation.error.message
              : 'Could not save. Please try again.'}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="rounded-md bg-accent px-4 py-2 font-display text-white disabled:opacity-60"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
