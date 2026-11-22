import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { IconX } from '@tabler/icons-react'
import { Modal } from '../components/Modal'
import { isMultilineField } from '../lib/multilineField'
import { MarkdownHint } from '../components/MarkdownHint'

// Setlists — a piece entry's Edit Entry modal: its `role` (the small-caps
// label shown above a piece in the Program list, e.g. "Opener") and its
// description (shown under it). Reached from a piece entry's right-click
// "Edit Entry" item on SetlistDetailsMockup.tsx. (Inside the Edit Program
// modal a piece row's pencil edits them inline instead, as a card in the
// row's own position — EditSetlistMockup.tsx's renderRoleForm — never a
// second modal on top of that one.) Save waits for a change; a field left
// blank clears it.
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
  initialDescription?: string
  onSave: (values: { role?: string; description?: string }) => void
}

export function EditRoleModal({
  open,
  onClose,
  pieceTitle,
  initialRole = '',
  initialDescription = '',
  onSave,
}: EditRoleModalProps) {
  const [role, setRole] = useState(initialRole)
  const [description, setDescription] = useState(initialDescription)

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: persistent instance re-synced to whichever entry is opened, same as EditEntryMockup.tsx.
    setRole(initialRole)
    setDescription(initialDescription)
  }, [open, initialRole, initialDescription])

  const canSave =
    role.trim() !== initialRole.trim() || description.trim() !== initialDescription.trim()

  function handleSave() {
    if (!canSave) return
    onSave({ role: role.trim() || undefined, description: description.trim() || undefined })
    onClose()
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
            <p className="truncate text-sm text-ink-soft">{pieceTitle}</p>
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
            disabled={!canSave}
            className="cursor-pointer rounded-md bg-accent-fill px-4 py-2 font-display font-medium text-white hover:bg-accent-fill/90 disabled:opacity-50"
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
        className="flex flex-col gap-4"
      >
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
            placeholder="Opener"
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
              placeholder="Take the repeat; hold the last chord a little longer."
              rows={3}
              className="w-full resize-none px-3 pt-2 pb-1 text-ink bg-transparent outline-none focus-visible:outline-none"
            />
          </MarkdownHint>
        </div>
      </form>
    </Modal>
  )
}
