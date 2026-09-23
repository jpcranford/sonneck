import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IconXFilled } from '@tabler/icons-react'
import { ApiError } from '../api/client'
import { updateSetlistEntry } from '../api/setlists'
import type { SetlistEntry } from '../api/types'
import { Modal } from './Modal'

// The Add/Edit Role modal — one text box for a piece entry's own `role`
// (the small-caps label above it in the Program list, e.g. "Prelude").
// Reached from a piece entry's right-click "Add Role"/"Edit Role" item on
// SetlistPage.tsx. Inside EditSetlistModal's Program tab the same edit is
// an inline card instead (never a second modal stacked on that one). Real
// port of routes/EditRoleMockup.tsx. An empty save clears an existing
// role; it's disabled only when there's no role to clear.

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

  useEffect(() => {
    if (!open || !entry) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: persistent instance re-synced to whichever entry is opened, same as EditEntryModal.tsx.
    setRole(entry.role ?? '')
  }, [open, entry])

  const hadRole = Boolean(entry?.role)
  const canSave = role.trim() !== '' || hadRole

  // PATCH .../entries/{id} is a full replace; a piece entry only carries
  // `role` (its custom_* columns are never written for a piece — see
  // repo.UpdateSetlistEntry), so role is the whole body here.
  const saveMutation = useMutation({
    mutationFn: () =>
      updateSetlistEntry(setlistId, entry!.id, {
        role: role.trim() || null,
        customCountsAsMusic: false,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['setlist', setlistId], updated)
      onClose()
    },
    onError: (error) => {
      window.alert(error instanceof ApiError ? error.message : 'Could not save this role.')
    },
  })

  function handleSave() {
    if (!canSave || !entry) return
    saveMutation.mutate()
  }

  function handleFormKeyDown(event: ReactKeyboardEvent<HTMLFormElement>) {
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
              {hadRole ? 'Edit role' : 'Add role'}
            </h2>
            <p className="truncate text-sm text-ink-soft">{entry?.piece?.title}</p>
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
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || saveMutation.isPending}
            className="cursor-pointer rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
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
        className="flex flex-col gap-1"
      >
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
        {hadRole && <p className="text-xs text-ink-soft italic">Leave blank and save to remove the role.</p>}
      </form>
    </Modal>
  )
}
