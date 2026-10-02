import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  IconBan,
  IconBook2,
  IconCloudUpload,
  IconFileMusic,
  IconFileTypePdf,
  IconXFilled,
} from '@tabler/icons-react'
import { deleteBook, getBook } from '../api/books'
import { ApiError } from '../api/client'
import { hasPermission, useAuth } from '../lib/AuthContext'
import { setPendingUpload } from '../lib/pendingUpload'
import { clearWizardDraft, loadWizardDraft, type WizardDraftStep } from '../lib/useWizardDraft'
import { isAnyModalOpen, Modal } from './Modal'

// Drag-and-drop upload anywhere in the app (design doc §13; design B,
// /mockup/drop-to-upload). While a file is dragged over the app, a "Drop
// to upload" overlay; after the drop, "Is this a piece or a book?" with the
// Upload page's own two cards. Either answer hands the file to the Upload
// page (lib/pendingUpload.ts): a piece starts uploading there at once, a
// book opens the book wizard with its upload started.
//
// Refused, with the reason shown while dragging and after a drop: more than
// one file ("one at a time"), anything but a PDF, and any drop from a
// viewer without `upload`. A book while a book-wizard draft exists is
// refused too, offering to open that draft or delete it and carry on with
// this file. Stays out of the way entirely while any modal is open (one may
// have its own file input) and on the Upload page, whose own dropzones
// already take drops. Only file drags count, never a text selection or an
// in-app drag like setlist reordering.

type Refusal = 'permission' | 'type' | 'multiple'

const REFUSALS: Record<Refusal, { title: string; detail: string }> = {
  permission: {
    title: "You don't have permission to upload",
    detail: 'Ask an admin for the Upload permission.',
  },
  type: { title: 'Only PDF files can be uploaded', detail: 'Sonneck stores sheet music as PDFs.' },
  multiple: { title: 'Drop one PDF at a time', detail: 'Each upload is one piece or one book.' },
}

// The heading of the wizard screen a draft stopped on, as the wizard shows it.
const DRAFT_STEP_HEADINGS: Record<WizardDraftStep, string> = {
  about: 'About this book',
  split: 'Mark where each piece begins',
  titles: 'Name each piece',
  confirm: 'Ready to import',
}

function isPdf(name: string, type: string): boolean {
  return type === 'application/pdf' || name.toLowerCase().endsWith('.pdf')
}

function formatSize(bytes: number): string {
  return bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')

// The Upload page's own landing cards (UploadPage.tsx) — same icons, wording
// and styling, so the question reads the same wherever it's asked.
function ChoiceCard({
  icon,
  title,
  detail,
  onClick,
}: {
  icon: ReactNode
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
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-paper-sunken text-ink-soft">
        {icon}
      </span>
      <span>
        <span className="block font-display text-[0.98rem] font-medium text-ink">{title}</span>
        <span className="block text-[0.8rem] text-ink-soft">{detail}</span>
      </span>
    </button>
  )
}

function ModalHeader({
  id,
  title,
  subtitle,
  onClose,
}: {
  id: string
  title: string
  subtitle?: ReactNode
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
        <IconXFilled size={22} />
      </button>
    </div>
  )
}

const BUTTON =
  'cursor-pointer rounded-md px-4 py-2 font-display disabled:cursor-not-allowed disabled:opacity-50'
const BUTTON_SECONDARY = `${BUTTON} border border-border bg-paper-raised text-ink hover:border-accent`
const BUTTON_PRIMARY = `${BUTTON} bg-accent text-white hover:bg-accent/90`
const BUTTON_DESTRUCTIVE = `${BUTTON} border border-border bg-paper-raised text-danger hover:border-danger`

export function DropToUpload() {
  const me = useAuth()
  const canUpload = hasPermission(me, 'upload')
  const location = useLocation()
  const navigate = useNavigate()
  const onUploadPage = location.pathname === '/upload'

  const [dragging, setDragging] = useState<{ refusal: Refusal | null } | null>(null)
  const [dropped, setDropped] = useState<File | null>(null)
  const [step, setStep] = useState<'ask' | 'draft'>('ask')
  const [refused, setRefused] = useState<Refusal | null>(null)
  const [draft, setDraft] = useState(() => loadWizardDraft())
  const depthRef = useRef(0)

  // Read through a ref by the window listeners, which are registered once.
  const stateRef = useRef({ canUpload, onUploadPage, dragging })
  useEffect(() => {
    stateRef.current = { canUpload, onUploadPage, dragging }
  })

  useEffect(() => {
    const inactive = () => stateRef.current.onUploadPage || isAnyModalOpen()
    const refusalFor = (files: { name: string; type: string }[]): Refusal | null => {
      if (!stateRef.current.canUpload) return 'permission'
      if (files.length > 1) return 'multiple'
      if (files.length === 1 && !isPdf(files[0].name, files[0].type)) return 'type'
      return null
    }

    function onDragEnter(event: DragEvent) {
      if (!hasFiles(event) || inactive()) return
      event.preventDefault()
      depthRef.current += 1
      const items = Array.from(event.dataTransfer?.items ?? []).filter(
        (item) => item.kind === 'file',
      )
      // Some browsers hide a dragged file's type until the drop — a blank
      // type counts as "maybe a PDF" here; the drop checks the real name.
      setDragging({
        refusal: refusalFor(
          items.map((item) => ({ name: '', type: item.type || 'application/pdf' })),
        ),
      })
    }
    function onDragOver(event: DragEvent) {
      if (!hasFiles(event)) return
      // Always cancelled for a file, so a drop that lands anywhere unhandled
      // never makes the browser open the PDF in place of the app. While
      // inactive, the dropEffect is left to whatever dropzone is underneath.
      event.preventDefault()
      if (inactive() || !event.dataTransfer) return
      event.dataTransfer.dropEffect = stateRef.current.dragging?.refusal ? 'none' : 'copy'
    }
    function onDragLeave(event: DragEvent) {
      if (!hasFiles(event) || inactive()) return
      depthRef.current = Math.max(0, depthRef.current - 1)
      if (depthRef.current === 0) setDragging(null)
    }
    function onDrop(event: DragEvent) {
      if (!hasFiles(event)) return
      event.preventDefault()
      depthRef.current = 0
      const shownRefusal = stateRef.current.dragging?.refusal
      setDragging(null)
      if (inactive()) return
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length === 0) return
      // A refusal already on screen while dragging needs no second notice.
      if (shownRefusal) return
      const refusal = refusalFor(files)
      if (refusal) {
        setRefused(refusal)
        return
      }
      setStep('ask')
      setDropped(files[0])
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
  }, [])

  const { data: draftBook } = useQuery({
    queryKey: ['book', draft?.bookId],
    queryFn: () => getBook(draft!.bookId),
    enabled: step === 'draft' && draft !== null,
  })

  function handOff(kind: 'piece' | 'book') {
    if (!dropped) return
    setPendingUpload({ file: dropped, kind })
    setDropped(null)
    navigate('/upload')
  }

  function chooseBook() {
    const current = loadWizardDraft()
    if (current) {
      setDraft(current)
      setStep('draft')
      return
    }
    handOff('book')
  }

  // Same as the wizard's own Cancel: the draft's uploaded book (it has no
  // pieces yet) is deleted along with the draft, then the dropped book
  // carries on. A book that's already gone just clears the stale draft.
  const deleteDraftMutation = useMutation({
    mutationFn: async () => {
      if (!draft) return
      try {
        await deleteBook(draft.bookId)
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error
      }
    },
    onSuccess: () => {
      clearWizardDraft()
      setDraft(null)
      handOff('book')
    },
    onError: (error) => {
      window.alert(error instanceof ApiError ? error.message : 'Could not delete the draft.')
    },
  })

  function openDraft() {
    setDropped(null)
    navigate('/upload')
  }

  const draftStepHeading = draft ? DRAFT_STEP_HEADINGS[draft.step] : ''

  return (
    <>
      {dragging &&
        createPortal(
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6 backdrop-blur-[2px]">
            <div
              className={`w-full max-w-sm rounded-xl border-2 border-dashed bg-paper-raised px-6 py-7 text-center shadow-xl ${
                dragging.refusal ? 'border-danger' : 'border-accent'
              }`}
            >
              <div
                className={`mb-2 flex justify-center ${dragging.refusal ? 'text-danger' : 'text-accent'}`}
              >
                {dragging.refusal ? <IconBan size={26} /> : <IconCloudUpload size={26} />}
              </div>
              <p className="font-display text-base font-medium text-ink">
                {dragging.refusal ? REFUSALS[dragging.refusal].title : 'Drop to upload'}
              </p>
              <p className="mt-1 text-sm text-ink-soft">
                {dragging.refusal
                  ? REFUSALS[dragging.refusal].detail
                  : "You'll choose piece or book next."}
              </p>
            </div>
          </div>,
          document.body,
        )}

      <Modal
        open={dropped !== null}
        onClose={() => setDropped(null)}
        labelledBy="drop-upload-title"
        header={
          step === 'ask' ? (
            <ModalHeader
              id="drop-upload-title"
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
              id="drop-upload-title"
              title="A book upload is already in progress"
              subtitle={draftBook?.bookTitle}
              onClose={() => setDropped(null)}
            />
          )
        }
        footer={
          step === 'ask' ? (
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => setDropped(null)} className={BUTTON_SECONDARY}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button type="button" onClick={() => setDropped(null)} className={BUTTON_SECONDARY}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteDraftMutation.mutate()}
                disabled={deleteDraftMutation.isPending}
                className={BUTTON_DESTRUCTIVE}
              >
                {deleteDraftMutation.isPending ? 'Deleting…' : 'Delete draft and upload this one'}
              </button>
              <button type="button" onClick={openDraft} className={BUTTON_PRIMARY}>
                Open draft
              </button>
            </div>
          )
        }
      >
        {step === 'ask' ? (
          <div className="flex flex-col gap-3">
            <ChoiceCard
              icon={<IconFileMusic size={19} />}
              title="Upload a piece"
              detail="One PDF, one piece of music. The common case."
              onClick={() => handOff('piece')}
            />
            <ChoiceCard
              icon={<IconBook2 size={19} />}
              title="Upload a book"
              detail="One PDF containing several pieces — we'll walk you through splitting it up."
              onClick={chooseBook}
            />
          </div>
        ) : (
          <p className="text-sm text-ink">
            {draftBook ? 'This book' : 'A book'} is waiting at "{draftStepHeading}". Finish it or
            delete it before uploading another book.
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
            <button type="button" onClick={() => setRefused(null)} className={BUTTON_PRIMARY}>
              OK
            </button>
          </div>
        }
      >
        {refused && <p className="text-sm text-ink">{REFUSALS[refused].detail}</p>}
      </Modal>
    </>
  )
}
