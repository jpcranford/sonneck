import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { IconArrowLeft, IconXFilled } from '@tabler/icons-react'
import { Modal } from '../components/Modal'
import { Toggle } from '../components/Toggle'
import { useMockupTitle } from '../lib/useMockupTitle'

// Setlists design pass, Phase 11 — the Edit Entry modal (decision 16),
// reached from a custom entry's own right-click "Edit Entry" item on the
// Setlist Details page (decision 11), not nested inside the Edit Setlist
// modal (EditSetlistMockup.tsx). Decision 22 (Phase 8's own build)
// absorbed three of this modal's four original fields into the Edit
// Program tab's own inline custom-entry form (name/duration/description,
// the last upgraded there to real Markdown) plus the "Count as music"
// toggle (added in Round 4) — leaving this phase's own scope genuinely
// open for a while (see the plan's own decision 22 note). Direct
// instruction resolved it: build this as its own real standalone modal
// after all, carrying the exact same field set Edit Program's inline
// "edit an existing custom entry" form already has (name, duration, the
// "Count as music" toggle, description) — not just the toggle alone, and
// not folded into Edit Program's own form. The two now genuinely
// duplicate the same four fields in two different places on purpose: this
// modal is the fast, single-entry path from a right-click on the Setlist
// Details page itself; Edit Program's own inline form stays for editing an
// entry while already reordering/adding others.
//
// Field styling here is the app's standard top-level-modal convention
// (`px-3 py-2` inputs, `text-sm text-ink-soft` labels — EditBookModal.tsx/
// EditPieceModal.tsx/EditSetlistMockup.tsx's own "Setlist Details" tab),
// not EditSetlistMockup.tsx's denser `py-1.5` nested-inline-form sizing —
// that smaller size exists there specifically because the form sits
// beside the "+ Piece" search bar inside a bordered card in a scrolling
// list; this modal's fields ARE the whole modal body, the same shape as
// every other top-level Edit modal in this app, not a nested block.

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

export interface EditEntryValues {
  name: string
  durationSeconds?: number
  description?: string
  countsAsMusic: boolean
}

interface EditEntryModalProps {
  open: boolean
  onClose: () => void
  // Pre-edit values — re-applied every time the modal opens (see the sync
  // effect below), not just read once at mount, since a caller normally
  // keeps one modal instance around and re-opens it for a different entry
  // each time (SetlistDetailsMockup.tsx's own single `editingEntry` +
  // `editEntryOpen` pair), the same "controlled prop, persistent instance"
  // shape EditSetlistModal's own `initialTab` already uses.
  initialName: string
  initialDurationSeconds?: number
  initialDescription?: string
  initialCountsAsMusic?: boolean
  onSave: (values: EditEntryValues) => void
}

export function EditEntryModal({
  open,
  onClose,
  initialName,
  initialDurationSeconds,
  initialDescription = '',
  initialCountsAsMusic = false,
  onSave,
}: EditEntryModalProps) {
  const [name, setName] = useState(initialName)
  const [duration, setDuration] = useState(initialDurationSeconds != null ? formatDuration(initialDurationSeconds) : '')
  const [description, setDescription] = useState(initialDescription)
  const [countsAsMusic, setCountsAsMusic] = useState(initialCountsAsMusic)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: this modal's own instance persists across open/close (the caller toggles `open`, doesn't conditionally render this component), so the fields have to re-sync to whichever entry is being edited on every open, not just once at mount — same posture EditSetlistModal's own `initialTab` sync effect takes for the identical reason.
    setName(initialName)
    setDuration(initialDurationSeconds != null ? formatDuration(initialDurationSeconds) : '')
    setDescription(initialDescription)
    setCountsAsMusic(initialCountsAsMusic)
  }, [open, initialName, initialDurationSeconds, initialDescription, initialCountsAsMusic])

  function handleCancel() {
    onClose()
  }

  function handleSave() {
    if (!name.trim()) return
    onSave({
      name: name.trim(),
      durationSeconds: parseDurationInput(duration),
      description: description.trim() || undefined,
      countsAsMusic,
    })
    onClose()
  }

  // This app's standard modal shortcut: Shift+Enter saves from anywhere in
  // the form (EditBookModal.tsx/EditPersonModal.tsx/EditSetlistMockup.tsx's
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
      onClose={handleCancel}
      labelledBy="edit-entry-title"
      size="md"
      header={
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="edit-entry-title" className="font-display text-2xl font-medium text-ink">
              Edit entry
            </h2>
            <p className="text-sm text-ink-soft">{initialName}</p>
          </div>
          <button
            type="button"
            onClick={handleCancel}
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
            onClick={handleCancel}
            className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!name.trim()}
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
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="f-entry-name" className="text-sm text-ink-soft">
            Name <span className="text-ink-soft/60 italic">(Required)</span>
          </label>
          <input
            ref={nameInputRef}
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

// Page-wrapper demo — same shape as EditSetlistMockup.tsx's own: a few
// buttons opening the modal against different starting states, keyed so
// switching between them doesn't carry stale field values from one demo
// entry into the next.
export function EditEntryMockup() {
  useMockupTitle('Edit Entry')
  const [open, setOpen] = useState(true)
  const [demo, setDemo] = useState<'announcement' | 'response' | 'bare'>('announcement')

  function openDemo(which: typeof demo) {
    setDemo(which)
    setOpen(true)
  }

  const demoValues: Record<
    typeof demo,
    { name: string; durationSeconds?: number; description?: string; countsAsMusic?: boolean }
  > = {
    announcement: {
      name: 'Welcome & Announcements',
      durationSeconds: 180,
      description: 'Reminder: mention the *bake sale* sign-up sheet before the offering.',
      countsAsMusic: false,
    },
    response: {
      name: 'Congregational Response',
      durationSeconds: 120,
      countsAsMusic: true,
    },
    bare: {
      name: 'Postlude Improvisation',
      durationSeconds: 300,
      countsAsMusic: false,
    },
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-6 md:px-8 md:py-8">
      <Link to="/mockup" className="inline-flex w-fit items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
        <IconArrowLeft size={20} />
        Setlists
      </Link>

      <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
        Reference sample — <span className="font-medium text-ink">Edit Entry modal</span> (design doc §13, Phase 11,
        decision 16) — a single custom entry's own name/duration/"Count as music"/description, reached from a
        custom entry's right-click "Edit Entry" item on the Setlist Details page. Carries the exact same field set
        as the Edit Setlist modal's own Program Order tab uses for its inline "edit an existing custom entry" form
        (EditSetlistMockup.tsx) — deliberately duplicated, not shared, since that form exists for editing while
        already reordering/adding others, and this one is the fast single-entry path from a right-click. A piece
        entry's own right-click menu opens Edit Piece instead — this modal is custom-entry only.
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => openDemo('announcement')}
          className="w-fit cursor-pointer rounded-md bg-accent px-4 py-2 font-display text-sm text-white hover:bg-accent/90"
        >
          Edit "Welcome & Announcements"
        </button>
        <button
          type="button"
          onClick={() => openDemo('response')}
          className="w-fit cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-sm text-ink hover:border-accent"
        >
          Edit "Congregational Response" (Count as music: on)
        </button>
        <button
          type="button"
          onClick={() => openDemo('bare')}
          className="w-fit cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-sm text-ink hover:border-accent"
        >
          Edit "Postlude Improvisation" (no description)
        </button>
      </div>

      <EditEntryModal
        key={demo}
        open={open}
        onClose={() => setOpen(false)}
        initialName={demoValues[demo].name}
        initialDurationSeconds={demoValues[demo].durationSeconds}
        initialDescription={demoValues[demo].description}
        initialCountsAsMusic={demoValues[demo].countsAsMusic}
        onSave={() => {}}
      />
    </div>
  )
}
