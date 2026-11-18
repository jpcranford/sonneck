import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IconX } from '@tabler/icons-react'
import { ApiError } from '../api/client'
import { getSetlist, updateSetlistEntry } from '../api/setlists'
import { useFreshOnOpen } from '../hooks/useFreshOnOpen'
import type { SetlistEntry } from '../api/types'
import { Modal } from './Modal'
import { showAlert } from '../lib/dialogs'
import { isMultilineField } from '../lib/multilineField'
import { MarkdownHint } from './MarkdownHint'

// A piece entry's Edit Entry modal — its `role` (the small-caps label above
// it in the Program list, e.g. "Prelude") and its description (shown under
// it on Setlist Details). Reached from a piece entry's right-click "Edit
// Entry" item on SetlistPage.tsx. Inside EditSetlistModal's Program tab the
// same edit is an inline card instead (never a second modal stacked on that
// one). Real port of routes/EditRoleMockup.tsx. Save is disabled until
// something changes; a field left blank clears it.

interface EditRoleModalProps {
  open: boolean
  onClose: () => void
  setlistId: number
  // The piece entry being edited — null while closed. Re-synced on every
  // open, same persistent-instance posture as EditEntryModal.tsx.
  entry: SetlistEntry | null
}

export function EditRoleModal({ open, onClose, setlistId, entry }: EditRoleModalProps) {
  const queryClient = useQueryClient()
  const [role, setRole] = useState('')
  const [description, setDescription] = useState('')
  // The entry as saved — from the fresh copy once it lands.
  const [saved, setSaved] = useState({ role: '', description: '' })

  useEffect(() => {
    if (!open || !entry) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: persistent instance re-synced to whichever entry is opened, same as EditEntryModal.tsx.
    setRole(entry.role ?? '')
    setDescription(entry.description ?? '')
    setSaved({ role: entry.role ?? '', description: entry.description ?? '' })
  }, [open, entry])

  // The fields fill from the entry as the server has it now, not the copy
  // the page held when it was opened (hooks/useFreshOnOpen) — locked until
  // then. An entry removed meanwhile (another device, another tab) closes
  // the window with a note instead of saving over nothing.
  const loadingFresh = useFreshOnOpen(
    open && entry !== null,
    ['setlist', setlistId],
    () => getSetlist(setlistId),
    (fresh) => {
      const current = fresh.entries.find((e) => e.id === entry?.id)
      if (!current) {
        showAlert('This entry has been removed from the setlist.')
        onClose()
        return
      }
      setRole(current.role ?? '')
      setDescription(current.description ?? '')
      setSaved({ role: current.role ?? '', description: current.description ?? '' })
    },
  )

  const canSave = role.trim() !== saved.role || description.trim() !== saved.description

  // PATCH .../entries/{id} is a full replace; a piece entry only carries
  // `role` and `description` (its custom_* columns are never written for a
  // piece — see repo.UpdateSetlistEntry), so they're the whole body here.
  const saveMutation = useMutation({
    mutationFn: () =>
      updateSetlistEntry(setlistId, entry!.id, {
        role: role.trim() || null,
        description: description.trim() || null,
        customCountsAsMusic: false,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['setlist', setlistId], updated)
      // The copy-as-text program is cached separately (see EditSetlistModal).
      queryClient.invalidateQueries({ queryKey: ['setlist', setlistId, 'program'] })
      onClose()
    },
    onError: (error) => {
      showAlert(error instanceof ApiError ? error.message : 'Could not save this entry.')
    },
  })

  function handleSave() {
    if (!canSave || !entry || loadingFresh) return
    saveMutation.mutate()
  }

  function handleFormKeyDown(event: ReactKeyboardEvent<HTMLFormElement>) {
    // A line break in a description/notes field, never a save.
    if (isMultilineField(event.target)) return
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault()
      handleSave()
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="edit-role-title"
      size="md"
      header={
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="edit-role-title" className="font-display text-2xl font-medium text-ink">
              Edit entry
            </h2>
            <p className="truncate text-sm text-ink-soft">{entry?.piece?.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mt-1 shrink-0 cursor-pointer text-ink-soft hover:text-accent"
          >
            <IconX size={22} />
          </button>
        </div>
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display font-medium text-ink hover:border-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || saveMutation.isPending || loadingFresh}
            className="cursor-pointer rounded-md bg-accent-fill px-4 py-2 font-display font-medium text-white hover:bg-accent-fill/90 disabled:opacity-50"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          handleSave()
        }}
        onKeyDown={handleFormKeyDown}
        className="flex flex-col gap-4"
      >
        <fieldset disabled={loadingFresh} className="contents">
          <div className="flex flex-col gap-1">
            <label htmlFor="f-entry-role" className="text-sm text-ink-soft">
              Role
            </label>
            <input
              id="f-entry-role"
              type="text"
              autoFocus
              value={role}
              onChange={(event) => setRole(event.target.value)}
              placeholder="Prelude"
              className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="f-piece-entry-description" className="text-sm text-ink-soft">
              Description
            </label>
            <MarkdownHint>
              <textarea
                id="f-piece-entry-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Second verse a cappella; organ back in for the last."
                rows={3}
                className="w-full resize-none px-3 pt-2 pb-1 text-ink bg-transparent outline-none focus-visible:outline-none"
              />
            </MarkdownHint>
          </div>
        </fieldset>
      </form>
    </Modal>
  )
}
