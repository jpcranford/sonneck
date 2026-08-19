import { useForm } from 'react-hook-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IconAlertTriangle, IconXFilled } from '@tabler/icons-react'
import { createBookManual } from '../api/books'
import { ApiError } from '../api/client'
import { Modal } from './Modal'

interface NewBookModalProps {
  open: boolean
  onClose: () => void
}

interface NewBookFormValues {
  bookTitle: string
  composer: string
  publisher: string
  yearWritten: string
}

// Books library view's "New Book" button (design mockup locked in
// 2026-08-18) — creates a Book with no underlying file (backend migration
// 00014), for a piece of sheet music you own but haven't scanned/uploaded
// yet. Deliberately minimal: only the four fields a book can meaningfully
// have before any pieces are attached to it — no sheet type/instruments/
// opus/IMSLP/description here, those only make sense once there's real
// content to classify. Title is the only required field, same reasoning
// as ValidateBook's real bookTitle requirement (CLAUDE.md > Book-level
// soft inheritance).
export function NewBookModal({ open, onClose }: NewBookModalProps) {
  const queryClient = useQueryClient()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<NewBookFormValues>({
    defaultValues: { bookTitle: '', composer: '', publisher: '', yearWritten: '' },
  })

  const createMutation = useMutation({
    mutationFn: (data: NewBookFormValues) =>
      createBookManual({
        bookTitle: data.bookTitle,
        composer: data.composer || null,
        publisher: data.publisher || null,
        yearWritten: data.yearWritten || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      handleClose()
    },
  })

  function handleClose() {
    reset()
    createMutation.reset()
    onClose()
  }

  function onSubmit(data: NewBookFormValues) {
    createMutation.mutate(data)
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      labelledBy="new-book-title"
      header={
        <div className="flex items-start justify-between gap-4">
          <h2 id="new-book-title" className="font-display text-2xl text-ink">
            New book
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="mt-1 shrink-0 text-ink-soft hover:text-accent"
          >
            <IconXFilled size={22} />
          </button>
        </div>
      }
      footer={
        <div className="flex flex-col gap-2">
          {createMutation.isError && (
            <p className="flex items-center gap-2 text-sm text-red-700">
              <IconAlertTriangle size={16} />
              {createMutation.error instanceof ApiError
                ? createMutation.error.message
                : 'Could not create this book. Please try again.'}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="new-book-form"
              disabled={createMutation.isPending}
              className="rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90 disabled:opacity-60"
            >
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      }
    >
      <form id="new-book-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="nb-title" className="text-sm text-ink-soft">
            Title <span className="italic text-ink-soft/60">(Required)</span>
          </label>
          <input
            id="nb-title"
            autoFocus
            className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
            {...register('bookTitle', { required: 'Title is required.', maxLength: 255 })}
          />
          {errors.bookTitle && <p className="text-sm text-red-700">{errors.bookTitle.message}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="nb-composer" className="text-sm text-ink-soft">
            Composer
          </label>
          <input
            id="nb-composer"
            className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
            {...register('composer', { maxLength: 255 })}
          />
        </div>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="nb-publisher" className="text-sm text-ink-soft">
              Publisher
            </label>
            <input
              id="nb-publisher"
              className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('publisher', { maxLength: 255 })}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="nb-year" className="text-sm text-ink-soft">
              Year first published
            </label>
            <input
              id="nb-year"
              className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('yearWritten', { maxLength: 255 })}
            />
          </div>
        </div>
      </form>
    </Modal>
  )
}
