import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IconAlertTriangle, IconCheck, IconXFilled } from '@tabler/icons-react'
import { updatePerson } from '../api/people'
import { ApiError } from '../api/client'
import { afterMinDuration } from '../lib/minDuration'
import type { Person, PersonWriteRequest } from '../api/types'
import { Modal } from './Modal'

// The real Edit Person modal (composer/arranger overhaul, Phase 5's
// approved mockup: EditPersonModalMockup.tsx, /mockup/edit-person-modal,
// left intact as a standing reference). Deliberately minimal — "should be
// very minimal" per the original brief — Name/Biography/Birth year/Death
// year only; portrait editing stays on Person Details' own camera badge
// (its only edit trigger, per that phase's own locked decision), same "no
// redundant triggers" principle EditBookModal.tsx already follows for
// Book's cover image.
//
// The mockup's Wikipedia search-and-pick autofill is NOT wired up here —
// unlike IMSLP autofill (a real backend endpoint, internal/imslp), no
// Wikipedia search/parse endpoint exists on the backend yet. Building one
// is real backend work beyond "port an approved frontend mockup," so it's
// left for a later session; this modal ships without that affordance for
// now.

interface EditPersonModalProps {
  person: Person
  open: boolean
  onClose: () => void
}

interface FormValues {
  name: string
  bio: string
  birthYear: string
  deathYear: string
}

function personToFormValues(person: Person): FormValues {
  return {
    name: person.name,
    bio: person.bio ?? '',
    birthYear: person.birthYear != null ? String(person.birthYear) : '',
    deathYear: person.deathYear != null ? String(person.deathYear) : '',
  }
}

function toIntOrNull(value: string): number | null {
  if (value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function formValuesToWriteRequest(data: FormValues): PersonWriteRequest {
  return {
    name: data.name,
    bio: data.bio || null,
    birthYear: toIntOrNull(data.birthYear),
    deathYear: toIntOrNull(data.deathYear),
  }
}

type SaveState = 'idle' | 'saving' | 'saved'
// Same fixed "Saved" display window as EditBookModal.tsx's own version of
// this — the PATCH itself isn't on a timer, just this confirmation beat.
const SAVED_DISPLAY_MS = 900

export function EditPersonModal({ person, open, onClose }: EditPersonModalProps) {
  const queryClient = useQueryClient()
  const [saveState, setSaveState] = useState<SaveState>('idle')
  // Captured right before mutate() fires, read in onSuccess — see
  // lib/minDuration.ts: this app's mutations round-trip in ~1-15ms against
  // the local SQLite backend, faster than a browser paint, so without this
  // the stripe animation below would never actually be seen.
  const saveStartedAtRef = useRef(0)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: personToFormValues(person) })

  useEffect(() => {
    if (open) {
      reset(personToFormValues(person))
      // Guards a narrow but real edge case, same as EditBookModal.tsx's
      // own identical effect: closing the modal while a save is genuinely
      // in flight leaves saveState at 'saving', and this component stays
      // mounted across that close — without this, reopening before that
      // earlier request resolves would show a stale "Saving…" animation
      // for a session that hasn't submitted anything yet. This is a real
      // external-trigger sync (the `open` prop toggling), not a same-
      // render feedback loop — see Modal.tsx/EditBookModal.tsx for the
      // same reasoning and precedent.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: see the comment above.
      setSaveState('idle')
    }
  }, [open, person, reset])

  const saveMutation = useMutation({
    mutationFn: (data: FormValues) => {
      saveStartedAtRef.current = Date.now()
      return updatePerson(person.id, formValuesToWriteRequest(data))
    },
    onSuccess: () => {
      // Broad invalidation — a name change ripples into every piece/book
      // crediting this person (their credit resolves live, no
      // denormalization, same reasoning as a Book field edit fanning out
      // to its pieces).
      queryClient.invalidateQueries({ queryKey: ['people'] })
      queryClient.invalidateQueries({ queryKey: ['person'] })
      queryClient.invalidateQueries({ queryKey: ['pieces'] })
      queryClient.invalidateQueries({ queryKey: ['piece'] })
      queryClient.invalidateQueries({ queryKey: ['books'] })
      afterMinDuration(saveStartedAtRef.current, () => {
        setSaveState('saved')
        setTimeout(() => {
          setSaveState('idle')
          onClose()
        }, SAVED_DISPLAY_MS)
      })
    },
    onError: () => setSaveState('idle'),
  })

  function onSubmit(data: FormValues) {
    setSaveState('saving')
    saveMutation.mutate(data)
  }

  // Shift+Enter saves from anywhere in the form — same convention as every
  // other edit modal in this app.
  function handleFormKeyDown(event: ReactKeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault()
      handleSubmit(onSubmit)()
    }
  }

  const saving = saveState !== 'idle'

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="edit-person-title"
      header={
        <div className="-mx-6 flex items-start justify-between gap-4 border-b border-border px-6 pb-4">
          <div>
            <h2 id="edit-person-title" className="font-display text-2xl font-medium text-ink">
              Edit person
            </h2>
            <p className="text-sm text-ink-soft">{person.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mt-1 shrink-0 cursor-pointer text-ink-soft hover:text-accent"
          >
            <IconXFilled size={22} />
          </button>
        </div>
      }
      footer={
        <div className="flex flex-col gap-2">
          {saveMutation.isError && (
            <p className="flex items-center gap-2 text-sm text-red-700">
              <IconAlertTriangle size={16} />
              {saveMutation.error instanceof ApiError
                ? saveMutation.error.message
                : 'Could not save. Please try again.'}
            </p>
          )}
          {person.pieceCount > 0 && (
            <p
              className={`text-right text-xs text-ink-soft transition-opacity ${saving ? 'opacity-0' : 'opacity-100'}`}
            >
              Saving will update {person.pieceCount} {person.pieceCount === 1 ? 'work' : 'works'}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent disabled:cursor-default disabled:opacity-45"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="edit-person-form"
              disabled={saving}
              className="relative flex min-w-[130px] shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md bg-accent px-4 py-2 font-display whitespace-nowrap text-white disabled:cursor-default"
            >
              {saveState === 'saving' && (
                <span
                  aria-hidden="true"
                  className="absolute inset-0 animate-stripe-move bg-[length:56px_56px] [background-image:repeating-linear-gradient(45deg,rgba(255,255,255,0.3)_0,rgba(255,255,255,0.3)_10px,transparent_10px,transparent_20px)] motion-reduce:animate-none motion-reduce:opacity-60"
                />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                {saveState === 'idle' && 'Save'}
                {saveState === 'saving' && 'Saving…'}
                {saveState === 'saved' && (
                  <>
                    <IconCheck size={15} />
                    Saved
                  </>
                )}
              </span>
            </button>
          </div>
        </div>
      }
    >
      <form
        id="edit-person-form"
        onSubmit={handleSubmit(onSubmit)}
        onKeyDown={handleFormKeyDown}
        className="flex flex-col gap-4"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="f-name" className="text-sm text-ink-soft">
            Name <span className="text-ink-soft/60 italic">(Required)</span>
          </label>
          <input
            id="f-name"
            className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
            {...register('name', { required: 'Name is required.', maxLength: 255 })}
          />
          {errors.name && <p className="text-sm text-red-700">{errors.name.message}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="f-bio" className="text-sm text-ink-soft">
            Biography <span className="text-ink-soft/60 italic">(Markdown supported)</span>
          </label>
          <textarea
            id="f-bio"
            rows={5}
            className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
            {...register('bio')}
          />
        </div>

        <div className="flex flex-col gap-3 min-[400px]:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="f-birth-year" className="text-sm text-ink-soft">
              Birth year
            </label>
            <input
              id="f-birth-year"
              inputMode="numeric"
              className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('birthYear')}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="f-death-year" className="text-sm text-ink-soft">
              Death year
            </label>
            <input
              id="f-death-year"
              inputMode="numeric"
              className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('deathYear')}
            />
          </div>
        </div>
      </form>
    </Modal>
  )
}
