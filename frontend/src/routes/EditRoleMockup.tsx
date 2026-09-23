import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { IconXFilled } from '@tabler/icons-react'
import { Modal } from '../components/Modal'

// Setlists — the Add/Edit role modal: one text box, the piece entry's own
// `role` (the small-caps label shown above a piece in the Program list,
// e.g. "Prelude"). Reached from a piece entry's right-click "Add Role"/
// "Edit Role" item on SetlistDetailsMockup.tsx. (Inside the Edit Program
// modal a piece row's pencil edits the role inline instead, as a card in
// the row's own position — EditSetlistMockup.tsx's renderRoleForm — never
// a second modal on top of that one.) Title reads "Add
// role" when the entry has none yet, "Edit role" once it does; saving an
// empty box clears an existing role (the backend's PATCH .../entries/{id}
// already accepts `role`, so the real build is frontend-only).
//
// Must render as a sibling of any other open Modal, never inside one —
// Modal.tsx doesn't portal, and its dialog's own open/close `scale-*`
// transform makes it the containing block for a nested `fixed` overlay
// (CLAUDE.md's standing overflow/transform portal gotcha).

interface EditRoleModalProps {
  open: boolean
  onClose: () => void
  // The entry being edited — shown under the title so it's clear which
  // piece this role belongs to (a piece can repeat within one setlist).
  pieceTitle: string
  // Re-applied every time the modal opens, same persistent-instance
  // posture as EditEntryMockup.tsx's own initial* props.
  initialRole?: string
  onSave: (role: string | undefined) => void
}

export function EditRoleModal({ open, onClose, pieceTitle, initialRole = '', onSave }: EditRoleModalProps) {
  const [role, setRole] = useState(initialRole)

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: persistent instance re-synced to whichever entry is opened, same as EditEntryMockup.tsx.
    setRole(initialRole)
  }, [open, initialRole])

  const hadRole = initialRole.trim() !== ''
  const trimmed = role.trim()
  // Empty is only a valid save when it means "remove the existing role".
  const canSave = trimmed !== '' || hadRole

  function handleSave() {
    if (!canSave) return
    onSave(trimmed || undefined)
    onClose()
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
            <p className="truncate text-sm text-ink-soft">{pieceTitle}</p>
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
            disabled={!canSave}
            className="cursor-pointer rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save
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
