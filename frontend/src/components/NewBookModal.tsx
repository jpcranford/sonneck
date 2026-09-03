import { useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IconAlertTriangle, IconXFilled } from '@tabler/icons-react'
import { createBookManual } from '../api/books'
import { listPeople } from '../api/people'
import { ApiError } from '../api/client'
import type { Tag } from '../api/types'
import { afterMinDuration } from '../lib/minDuration'
import { Modal } from './Modal'
import { TagComboBox } from './TagComboBox'

interface NewBookModalProps {
  open: boolean
  onClose: () => void
}

interface NewBookFormValues {
  bookTitle: string
  composer: Tag[]
  publisher: string
  yearPublished: string
}

// Books library view's "New Book" button — creates a Book with no
// underlying file (backend migration 00014), for a piece of sheet music
// you own but haven't scanned/uploaded
// yet. Deliberately minimal: only the four fields a book can meaningfully
// have before any pieces are attached to it — no sheet type/instruments/
// opus/IMSLP/description here, those only make sense once there's real
// content to classify. Title is the only required field, same reasoning
// as ValidateBook's real bookTitle requirement (CLAUDE.md > Book-level
// soft inheritance).
export function NewBookModal({ open, onClose }: NewBookModalProps) {
  const queryClient = useQueryClient()
  // Captured right before mutate() fires, read in onSuccess — see
  // lib/minDuration.ts. Without this, "Creating…" (and this modal
  // closing) resolves in ~1-15ms against this app's local SQLite
  // backend, faster than a browser paint, so the label is never actually
  // seen — same underlying bug as EditBookModal's stripe animation never
  // visibly playing.
  const createStartedAtRef = useRef(0)
  // Drives the button's label/disabled state instead of
  // createMutation.isPending directly — isPending flips to false the
  // instant the real request resolves, which on this app's fast local
  // backend is well before afterMinDuration lets handleClose actually
  // fire, and would otherwise leave the button reading "Create" for a
  // few hundred idle-looking ms while the modal still hasn't closed.
  const [isCreating, setIsCreating] = useState(false)
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<NewBookFormValues>({
    defaultValues: { bookTitle: '', composer: [], publisher: '', yearPublished: '' },
  })

  // People catalog (composer/arranger overhaul, Stage C pattern) — same
  // unpaginated listPeople() call as EditPieceModal.tsx/EditBookModal.tsx/
  // BookUploadAboutStep.tsx's own Composer TagComboBox option source.
  const { data: peopleOptions = [] } = useQuery({ queryKey: ['people'], queryFn: () => listPeople() })

  const createMutation = useMutation({
    // The Date.now() capture lives here, not in onSubmit below — onSubmit
    // is passed straight into react-hook-form's handleSubmit(), which the
    // react-hooks/purity and react-hooks/refs lint rules can't statically
    // prove doesn't invoke it during render, so an impure call or ref
    // write there gets flagged even though it never actually runs until a
    // real submit event. mutationFn has no such ambiguity — react-query
    // only ever calls it from mutate(), well after render.
    mutationFn: (data: NewBookFormValues) => {
      createStartedAtRef.current = Date.now()
      return createBookManual({
        bookTitle: data.bookTitle,
        // Composer is an ordered Person list now (composer/arranger
        // overhaul, migration 00020) — this form has no Arranger field of
        // its own, only Composer, same scope as before; arrangers is sent
        // empty.
        composers: data.composer.map((t) => t.name),
        arrangers: [],
        publisher: data.publisher || null,
        yearPublished: data.yearPublished || null,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      afterMinDuration(createStartedAtRef.current, handleClose)
    },
    onError: () => setIsCreating(false),
  })

  function handleClose() {
    reset()
    createMutation.reset()
    setIsCreating(false)
    onClose()
  }

  function onSubmit(data: NewBookFormValues) {
    setIsCreating(true)
    createMutation.mutate(data)
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      labelledBy="new-book-title"
      header={
        <div className="flex items-start justify-between gap-4">
          <h2 id="new-book-title" className="font-display text-2xl font-medium text-ink">
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
              disabled={isCreating}
              className="rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90 disabled:opacity-60"
            >
              {isCreating ? 'Creating…' : 'Create'}
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
          <Controller
            name="composer"
            control={control}
            render={({ field }) => (
              <TagComboBox
                label="Composer"
                options={peopleOptions}
                selected={field.value}
                multiple
                onChange={field.onChange}
                pillStyle="paper"
                newOptionLabel="New person"
              />
            )}
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
              {...register('yearPublished', { maxLength: 255 })}
            />
          </div>
        </div>
      </form>
    </Modal>
  )
}
