import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IconXFilled } from '@tabler/icons-react'
import { ApiError } from '../api/client'
import { updateSetlistEntry } from '../api/setlists'
import type { SetlistEntry } from '../api/types'
import { Modal } from './Modal'
import { Toggle } from './Toggle'

// Real port of EditEntryMockup.tsx's own exported EditEntryModal (Setlists
// design pass, Phase 11 mockup approved; this is Phase 15's real build) — a
// single custom entry's own name/duration/"Count as music"/description,
// reached from that entry's own right-click "Edit Entry" item on the
// Setlist Details page (decision 11). Deliberately duplicates the same
// four fields the real EditSetlistModal's own Program Order tab already
// edits inline — that form exists for editing while already reordering/
// adding others; this one is the fast single-entry path from a right-click.
// A piece entry's own right-click menu opens Edit Piece instead — this
// modal is custom-entry only, same as the mockup.

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function parseDurationInput(value: string): number | undefined {
  const match = value.trim().match(/^(\d+):(\d{2})$/)
  if (!match) return undefined
  return Number(match[1]) * 60 + Number(match[2])
}

interface EditEntryModalProps {
  open: boolean
  onClose: () => void
  setlistId: number
  // The custom entry currently being edited — null while closed. Fields
  // re-sync from this every time the modal opens (see the effect below),
  // not just once at mount, since one modal instance is reused for
  // whichever entry's own "Edit Entry" item was clicked most recently.
  entry: SetlistEntry | null
}

export function EditEntryModal({ open, onClose, setlistId, entry }: EditEntryModalProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [duration, setDuration] = useState('')
  const [description, setDescription] = useState('')
  const [countsAsMusic, setCountsAsMusic] = useState(false)

  useEffect(() => {
    if (!open || !entry) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: this modal's own instance persists across open/close, so the fields have to re-sync to whichever entry is being edited on every open, not just once at mount — same posture EditSetlistModal's own initialTab sync effect takes for the identical reason.
    setName(entry.customName ?? '')
    setDuration(entry.customDurationSeconds != null ? formatDuration(entry.customDurationSeconds) : '')
    setDescription(entry.customNotes ?? '')
    setCountsAsMusic(entry.customCountsAsMusic)
  }, [open, entry])

  const saveMutation = useMutation({
    mutationFn: () =>
      updateSetlistEntry(setlistId, entry!.id, {
        role: entry!.role,
        customName: name.trim(),
        customDurationSeconds: parseDurationInput(duration) ?? null,
        customNotes: description.trim() || null,
        customCountsAsMusic: countsAsMusic,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['setlist', setlistId], updated)
      onClose()
    },
    onError: (error) => {
      window.alert(error instanceof ApiError ? error.message : 'Could not save this entry.')
    },
  })

  function handleSave() {
    if (!name.trim() || !entry) return
    saveMutation.mutate()
  }

  // This app's standard modal shortcut: Shift+Enter saves from anywhere in
  // the form (EditBookModal.tsx/EditPersonModal.tsx/EditSetlistModal.tsx's
  // own identical pattern) — guarded by the same `!name.trim()` check the
  // Save button's own `disabled` already uses.
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
      labelledBy="edit-entry-title"
      size="md"
      header={
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="edit-entry-title" className="font-display text-2xl font-medium text-ink">
              Edit entry
            </h2>
            <p className="text-sm text-ink-soft">{entry?.customName}</p>
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
            disabled={!name.trim() || saveMutation.isPending}
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
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="f-entry-name" className="text-sm text-ink-soft">
            Name <span className="text-ink-soft/60 italic">(Required)</span>
          </label>
          <input
            id="f-entry-name"
            type="text"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Welcome &amp; Announcements"
            className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
          />
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label htmlFor="f-entry-duration" className="text-sm text-ink-soft">
              Duration
            </label>
            <input
              id="f-entry-duration"
              type="text"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
              placeholder="3:00"
              className="mt-1 w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
            />
          </div>
          <div className="flex flex-1 py-2">
            <Toggle checked={countsAsMusic} onChange={setCountsAsMusic} label="Count as music" />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-entry-description" className="text-sm text-ink-soft">
            Description <span className="text-ink-soft/60 italic">(Markdown supported)</span>
          </label>
          <textarea
            id="f-entry-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Reminder: mention the bake sale sign-up sheet before the offering."
            rows={3}
            className="w-full resize-none rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
          />
        </div>
      </form>
    </Modal>
  )
}
