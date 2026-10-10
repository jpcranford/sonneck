import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  IconBan,
  IconBook2,
  IconCloudUpload,
  IconFileMusic,
  IconFileTypePdf,
  IconX,
} from '@tabler/icons-react'
import { Modal } from '../components/Modal'
import { useMockupTitle } from '../lib/useMockupTitle'

// Drag-and-drop upload anywhere in the app (design doc §13), design B from
// a four-way comparison: a single "Drop to upload" overlay while a file is
// dragged over the app, then a dialog asking "Is this a piece or a book?"
// with the Upload page's own two landing cards. A piece then continues on
// the Upload page's uploading step; a book opens the book wizard with its
// upload already started. Fixture-only: nothing is uploaded here.
//
// Locked answers from that round:
// - More than one file: refused, "one at a time".
// - A book while a book-wizard draft already exists: refused, with the
//   choice to open that draft or delete it (and upload this one instead).
// - The overlay stays off while any modal is open, and on the Upload page
//   itself, whose own dropzones already handle drops.
// - Without the `upload` permission: a refusal instead of a drop target.
//
// This page installs the same window-level drag listeners the real one
// will, so a file dragged anywhere over it — sidebar included — shows the
// overlay.

type Refusal = 'permission' | 'type' | 'multiple'

interface DroppedFile {
  name: string
  size: number
}

const SAMPLE_PDF: DroppedFile = {
  name: 'Bach - Two-Part Inventions, BWV 772-786.pdf',
  size: 4404019,
}
const SAMPLE_DRAFT = {
  title: 'Czerny — 100 Progressive Studies, Op. 139',
  step: 'Split pages',
  stepNumber: 2,
}

function formatSize(bytes: number): string {
  return bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function isPdf(name: string, type: string): boolean {
  return type === 'application/pdf' || name.toLowerCase().endsWith('.pdf')
}

const REFUSALS: Record<Refusal, { title: string; detail: string }> = {
  permission: {
    title: "You don't have permission to upload",
    detail: 'Ask an admin for the Upload permission.',
  },
  type: { title: 'Only PDF files can be uploaded', detail: 'Sonneck stores sheet music as PDFs.' },
  multiple: { title: 'Drop one PDF at a time', detail: 'Each upload is one piece or one book.' },
}

function DropOverlay({ refusal }: { refusal: Refusal | null }) {
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-6 backdrop-blur-[2px]">
      <div
        className={`w-full max-w-sm rounded-xl border-2 border-dashed bg-paper-raised px-6 py-7 text-center shadow-xl ${
          refusal ? 'border-danger' : 'border-accent'
        }`}
      >
        <div className={`mb-2 flex justify-center ${refusal ? 'text-danger' : 'text-accent'}`}>
          {refusal ? <IconBan size={26} /> : <IconCloudUpload size={26} />}
        </div>
        <p className="font-display text-base font-medium text-ink">
          {refusal ? REFUSALS[refusal].title : 'Drop to upload'}
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          {refusal ? REFUSALS[refusal].detail : "You'll choose piece or book next."}
        </p>
      </div>
    </div>,
    document.body,
  )
}

// The Upload page's own landing cards (UploadPage.tsx, stage 'landing') —
// same icons, wording and styling, so the question reads identically
// wherever it's asked.
function ChoiceCard({
  icon,
  title,
  detail,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  detail: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer items-start gap-3.5 rounded-xl border-[1.5px] border-border bg-paper-raised p-4 text-left transition-colors hover:border-accent"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-paper-hover text-ink-soft">
        {icon}
      </span>
      <span>
        <span className="block font-display text-base font-medium text-ink">{title}</span>
        <span className="block text-xs text-ink-soft">{detail}</span>
      </span>
    </button>
  )
}

// The app's standard modal header and footer buttons (EditRoleModal.tsx,
// EditEntryModal.tsx): a 2xl serif title with an optional soft subtitle and
// the filled close X; serif footer buttons — outlined Cancel, filled accent
// for the main action, outlined red for a destructive one.
function ModalHeader({
  id,
  title,
  subtitle,
  onClose,
}: {
  id: string
  title: string
  subtitle?: React.ReactNode
  onClose: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 id={id} className="font-display text-2xl font-medium text-ink">
          {title}
        </h2>
        {subtitle && <div className="truncate text-sm text-ink-soft">{subtitle}</div>}
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
  )
}

function FooterButton({
  primary,
  destructive,
  onClick,
  children,
}: {
  primary?: boolean
  destructive?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer rounded-md px-4 py-2 font-display font-medium ${
        primary
          ? 'bg-accent-fill text-white hover:bg-accent-fill/90'
          : destructive
            ? 'border border-border bg-paper-raised text-danger hover:border-danger'
            : 'border border-border bg-paper-raised text-ink hover:border-accent'
      }`}
    >
      {children}
    </button>
  )
}

export function DropToUploadMockup() {
  useMockupTitle('Drop to Upload')

  const [canUpload, setCanUpload] = useState(true)
  const [hasDraft, setHasDraft] = useState(false)
  const [demoModalOpen, setDemoModalOpen] = useState(false)

  const [dragging, setDragging] = useState<{ refusal: Refusal | null } | null>(null)
  const [dropped, setDropped] = useState<DroppedFile | null>(null)
  const [step, setStep] = useState<'ask' | 'draft'>('ask')
  const [refused, setRefused] = useState<Refusal | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)
  const depthRef = useRef(0)

  const anyModalOpen = demoModalOpen || dropped !== null || refused !== null

  function refusalFor(files: { name: string; type: string }[]): Refusal | null {
    if (!canUpload) return 'permission'
    if (files.length > 1) return 'multiple'
    if (files.length === 1 && !isPdf(files[0].name, files[0].type)) return 'type'
    return null
  }

  function handleDrop(files: { name: string; type: string; size: number }[]) {
    const refusal = refusalFor(files)
    if (refusal) {
      setRefused(refusal)
      return
    }
    setStep('ask')
    setDropped({ name: files[0].name, size: files[0].size })
  }

  // Window-level, like the real feature: only file drags count (never a
  // text selection or an in-app drag like setlist reordering), and nothing
  // happens while any modal is open.
  useEffect(() => {
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files')

    function onDragEnter(event: DragEvent) {
      if (!hasFiles(event) || anyModalOpen) return
      event.preventDefault()
      depthRef.current += 1
      const items = Array.from(event.dataTransfer?.items ?? []).filter(
        (item) => item.kind === 'file',
      )
      // Some browsers hide the type until the drop — treat a blank type as
      // "maybe a PDF" here; the drop checks again with the real file name.
      const refusal = refusalFor(
        items.map((item) => ({ name: '', type: item.type || 'application/pdf' })),
      )
      setDragging({ refusal })
    }
    function onDragOver(event: DragEvent) {
      if (!hasFiles(event)) return
      // Always cancelled for a file, even while a modal is open — otherwise
      // a stray drop outside the modal's own dropzone makes the browser open
      // the PDF in place of the app. A modal's own dropzone sets its own
      // dropEffect, so this leaves it alone then.
      event.preventDefault()
      if (anyModalOpen) return
      if (event.dataTransfer) event.dataTransfer.dropEffect = dragging?.refusal ? 'none' : 'copy'
    }
    function onDragLeave(event: DragEvent) {
      if (!hasFiles(event) || anyModalOpen) return
      depthRef.current = Math.max(0, depthRef.current - 1)
      if (depthRef.current === 0) setDragging(null)
    }
    function onDrop(event: DragEvent) {
      if (!hasFiles(event)) return
      event.preventDefault()
      depthRef.current = 0
      setDragging(null)
      if (anyModalOpen) return
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length === 0) return
      // A refusal already shown while dragging needs no second notice.
      if (dragging?.refusal) return
      handleDrop(files.map((f) => ({ name: f.name, type: f.type, size: f.size })))
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  })

  function choosePiece() {
    setOutcome(`Upload page, uploading step — "${dropped?.name}" uploads as a piece.`)
    setDropped(null)
  }

  function chooseBook() {
    if (hasDraft) {
      setStep('draft')
      return
    }
    setOutcome(
      `Book wizard — "${dropped?.name}" uploads as a book, then the wizard carries on as usual.`,
    )
    setDropped(null)
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl font-medium text-ink">Drop to Upload</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Drag a PDF from your desktop anywhere over this page — sidebar included — and drop it. The
          app asks whether it's a piece or a book, then carries on along the matching Upload path.
          Nothing is actually uploaded here. Use the buttons below to try the refusals without a
          real file.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-paper-raised p-5">
        <h2 className="font-display text-base font-medium text-ink">Scenario</h2>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={!canUpload}
            onChange={(e) => setCanUpload(!e.target.checked)}
            className="accent-accent"
          />
          Viewer without the <code>upload</code> permission
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={hasDraft}
            onChange={(e) => setHasDraft(e.target.checked)}
            className="accent-accent"
          />
          A book upload is already in progress (a book-wizard draft exists)
        </label>
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() =>
              handleDrop([
                { name: SAMPLE_PDF.name, type: 'application/pdf', size: SAMPLE_PDF.size },
              ])
            }
            className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm text-ink hover:border-accent"
          >
            Simulate dropping a PDF
          </button>
          <button
            type="button"
            onClick={() =>
              handleDrop([
                { name: 'Prelude.pdf', type: 'application/pdf', size: 1 },
                { name: 'Fugue.pdf', type: 'application/pdf', size: 1 },
              ])
            }
            className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm text-ink hover:border-accent"
          >
            Simulate dropping two PDFs
          </button>
          <button
            type="button"
            onClick={() =>
              handleDrop([{ name: 'Rehearsal notes.docx', type: 'application/msword', size: 1 }])
            }
            className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm text-ink hover:border-accent"
          >
            Simulate dropping a non-PDF
          </button>
          <button
            type="button"
            onClick={() => setDemoModalOpen(true)}
            className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm text-ink hover:border-accent"
          >
            Open a modal (drops are ignored while it's open)
          </button>
        </div>
        {outcome && (
          <p className="flex items-start justify-between gap-3 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">
            <span>
              <b className="font-medium">Would go to:</b> {outcome}
            </span>
            <button
              type="button"
              onClick={() => setOutcome(null)}
              aria-label="Dismiss"
              className="cursor-pointer"
            >
              <IconX size={13} />
            </button>
          </p>
        )}
      </div>

      {dragging && <DropOverlay refusal={dragging.refusal} />}

      <Modal
        open={dropped !== null}
        onClose={() => setDropped(null)}
        labelledBy="drop-ask-title"
        header={
          step === 'ask' ? (
            <ModalHeader
              id="drop-ask-title"
              title="Is this a piece or a book?"
              subtitle={
                dropped && (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <IconFileTypePdf size={16} className="shrink-0" />
                    <span className="truncate">{dropped.name}</span>
                    <span className="shrink-0">• {formatSize(dropped.size)}</span>
                  </span>
                )
              }
              onClose={() => setDropped(null)}
            />
          ) : (
            <ModalHeader
              id="drop-ask-title"
              title="A book upload is already in progress"
              subtitle={SAMPLE_DRAFT.title}
              onClose={() => setDropped(null)}
            />
          )
        }
        footer={
          step === 'ask' ? (
            <div className="flex items-center justify-end gap-2">
              <FooterButton onClick={() => setDropped(null)}>Cancel</FooterButton>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <FooterButton onClick={() => setDropped(null)}>Cancel</FooterButton>
              <FooterButton
                destructive
                onClick={() => {
                  setHasDraft(false)
                  setOutcome(`Draft deleted. Book wizard — "${dropped?.name}" uploads as a book.`)
                  setDropped(null)
                }}
              >
                Delete draft and upload this one
              </FooterButton>
              <FooterButton
                primary
                onClick={() => {
                  setOutcome(
                    `Book wizard, resuming "${SAMPLE_DRAFT.title}" at ${SAMPLE_DRAFT.step}. The dropped file is set aside.`,
                  )
                  setDropped(null)
                }}
              >
                Open draft
              </FooterButton>
            </div>
          )
        }
      >
        {dropped && step === 'ask' && (
          <div className="flex flex-col gap-3">
            <ChoiceCard
              icon={<IconFileMusic size={19} />}
              title="Upload a piece"
              detail="One PDF, one piece of music. The common case."
              onClick={choosePiece}
            />
            <ChoiceCard
              icon={<IconBook2 size={19} />}
              title="Upload a book"
              detail="One PDF containing several pieces — we'll walk you through splitting it up."
              onClick={chooseBook}
            />
          </div>
        )}
        {dropped && step === 'draft' && (
          <p className="text-sm text-ink">
            This book is waiting at step {SAMPLE_DRAFT.stepNumber} of 4, {SAMPLE_DRAFT.step}. Finish
            it or delete it before uploading another book.
          </p>
        )}
      </Modal>

      <Modal
        open={refused !== null}
        onClose={() => setRefused(null)}
        labelledBy="drop-refused-title"
        header={
          refused && (
            <ModalHeader
              id="drop-refused-title"
              title={REFUSALS[refused].title}
              onClose={() => setRefused(null)}
            />
          )
        }
        footer={
          <div className="flex items-center justify-end gap-2">
            <FooterButton primary onClick={() => setRefused(null)}>
              OK
            </FooterButton>
          </div>
        }
      >
        {refused && <p className="text-sm text-ink">{REFUSALS[refused].detail}</p>}
      </Modal>

      <Modal
        open={demoModalOpen}
        onClose={() => setDemoModalOpen(false)}
        labelledBy="drop-demo-title"
        header={
          <ModalHeader
            id="drop-demo-title"
            title="Any open modal"
            onClose={() => setDemoModalOpen(false)}
          />
        }
        footer={
          <div className="flex items-center justify-end gap-2">
            <FooterButton primary onClick={() => setDemoModalOpen(false)}>
              Close
            </FooterButton>
          </div>
        }
      >
        <p className="text-sm text-ink">
          While a modal like this is open, dragging a file over the app shows no overlay and a drop
          does nothing — the modal may have its own file input (Edit Book's custom cover, Upload
          Portrait).
        </p>
      </Modal>
    </div>
  )
}
