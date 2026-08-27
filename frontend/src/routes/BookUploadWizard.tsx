import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { IconBook2, IconCircleCheckFilled } from '@tabler/icons-react'
import { deleteBook, getBook } from '../api/books'
import { ApiError } from '../api/client'
import type { Book, Piece as ApiPiece } from '../api/types'
import { computeLayout, type PageAssignments } from '../lib/pieceSplitLogic'
import { clearWizardDraft, loadWizardDraft, saveWizardDraft, type WizardDraftStep } from '../lib/useWizardDraft'
import { BookUploadFileStep } from './BookUploadFileStep'
import { BookUploadAboutStep } from './BookUploadAboutStep'
import { BookUploadSplitStep } from './BookUploadSplitStep'
import { BookUploadTitlesStep } from './BookUploadTitlesStep'
import { BookUploadConfirmStep, type NamedPiece } from './BookUploadConfirmStep'

// Book Upload Wizard (design doc §5) — the real, wired-up container that
// replaces UploadPage.tsx's old "coming soon" placeholder for
// `stage === 'book'`. Owns the wizard's cross-step state (the split's
// page assignments and each piece's title/composer are lifted here, not
// local to their own step components, so Back navigation doesn't lose
// them) and orchestrates the 6 steps, each ported from its own locked
// `/mockup/upload-book-*` reference — see each step file's own comment
// for what changed porting it from fixture data to the real API.

export const TOTAL_WIZARD_STEPS = 6

type WizardStep = 'file' | WizardDraftStep

const EMPTY_ASSIGNMENTS: PageAssignments = {
  starts: new Set(),
  skips: new Set(),
  shared: new Set(),
}

// The locked truncation rule (design doc §5's Confirmation screen,
// verified against the locked artifact's own worked example before being
// wired in): ≤3 pieces lists every title in full; >3 lists the first two
// titles, then "and N more pieces" where N is the remainder.
function formatImportedTitlesSentence(titles: string[]): string {
  const quoted = titles.map((t) => `"${t}"`)
  const verb = quoted.length === 1 ? 'is' : 'are'
  if (quoted.length <= 3) {
    const list =
      quoted.length === 1
        ? quoted[0]
        : quoted.length === 2
          ? `${quoted[0]} and ${quoted[1]}`
          : `${quoted[0]}, ${quoted[1]}, and ${quoted[2]}`
    return `${list} ${verb} now in your library.`
  }
  const remainder = quoted.length - 2
  return `${quoted[0]}, ${quoted[1]}, and ${remainder} more piece${remainder === 1 ? '' : 's'} are now in your library.`
}

// Reuses UploadPage.tsx's own "done" convention (IconCircleCheckFilled,
// same button copy/style) rather than duplicating it as a new pattern —
// generalized here for N pieces via the truncation rule above, since that
// single-piece screen's own JSX is typed around exactly one Piece and
// doesn't generalize cleanly without changing its own behavior.
function ImportSuccessScreen({
  pieces,
  bookId,
  onDone,
}: {
  pieces: ApiPiece[]
  bookId: number
  onDone: () => void
}) {
  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
        <IconCircleCheckFilled size={40} className="text-accent" />
        <h1 className="font-display text-2xl font-medium text-ink">
          {pieces.length} {pieces.length === 1 ? 'piece' : 'pieces'} imported
        </h1>
        <p className="text-sm text-ink-soft">
          {formatImportedTitlesSentence(pieces.map((p) => p.title))}
        </p>
        <div className="mt-1 flex items-center gap-3">
          <button
            type="button"
            onClick={onDone}
            className="rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
          >
            Upload another file
          </button>
          <Link
            to={`/books/${bookId}`}
            className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90"
          >
            <IconBook2 size={16} />
            Open book
          </Link>
        </div>
      </div>
    </div>
  )
}

interface BookUploadWizardProps {
  onExit: () => void
}

export function BookUploadWizard({ onExit }: BookUploadWizardProps) {
  const [step, setStep] = useState<WizardStep>('file')
  const [book, setBook] = useState<Book | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [fileSizeBytes, setFileSizeBytes] = useState<number | null>(null)
  const [pageAssignments, setPageAssignments] = useState<PageAssignments>(EMPTY_ASSIGNMENTS)
  const [pieceFields, setPieceFields] = useState<
    { title: string; composer: string; arranger: string }[]
  >([])
  // Printed-PDF page offset (design doc §5, added post-launch) — set on
  // Screen 3 ("About this book"), lifted here for the same reason
  // pageAssignments/pieceFields are: it must survive Back navigation and
  // feed the Confirm step's import request, not just live inside the
  // About step that collects it.
  const [pageOffset, setPageOffset] = useState(0)
  const [importedPieces, setImportedPieces] = useState<ApiPiece[] | null>(null)
  // Owned here, not inside BookUploadSplitStep, specifically so it
  // survives that step unmounting on Back navigation — see that
  // component's own comment on why a plain local ref there would silently
  // break the "first tap always starts a piece" rule after a round trip.
  const touchedPagesRef = useRef<Set<number>>(new Set())
  // Tracks which bookId draft-restoration has already been checked for —
  // NOT the same as "has restoration ever run." Re-running the check on
  // every `book` update (e.g. after saving Screen 3's edits, which
  // produces a new Book object with the same id) would silently overwrite
  // whatever split/title progress the user has made since with a stale
  // snapshot from before they started. Keying this off bookId, not a
  // one-shot boolean, is what keeps restoration a one-time thing per book
  // without also re-firing on every unrelated update to that same book.
  const restoredForBookIdRef = useRef<number | null>(null)

  function applyDraft(draft: ReturnType<typeof loadWizardDraft>) {
    if (!draft) return
    const restored: PageAssignments = {
      starts: new Set(draft.pageAssignments.starts),
      skips: new Set(draft.pageAssignments.skips),
      shared: new Set(draft.pageAssignments.shared),
    }
    setPageAssignments(restored)
    setPieceFields(draft.pieceFields)
    setPageOffset(draft.pageOffset)
    // Approximation, not exact: a page that was touched and cycled back to
    // fully "normal" wouldn't appear in any of these sets, so it would be
    // (incorrectly, but harmlessly) treated as never-touched again after a
    // restore. Acceptable for a reload-recovery path — the worst case is
    // one extra forced "start" tap on such a page, not data loss.
    touchedPagesRef.current = new Set([...restored.starts, ...restored.skips, ...restored.shared])
  }

  // Resuming on mount — the actual fix for "restore on return to an
  // in-progress import": a hard reload resets *this component's own*
  // step/book state to nothing, and resets UploadPage.tsx's `stage` back
  // to 'landing' too, so the book-keyed effect further down (which only
  // fires once a fresh upload hands back a matching bookId) never gets a
  // chance to run on its own after a reload — nothing re-uploads
  // anything. This checks for a draft immediately on mount, and if found,
  // re-fetches the real Book by id (the draft only stores the id) before
  // jumping straight to whatever step was in progress.
  const [initialDraft] = useState(() => loadWizardDraft())
  const [resuming, setResuming] = useState(!!initialDraft)

  useEffect(() => {
    if (!initialDraft) return
    let cancelled = false
    getBook(initialDraft.bookId)
      .then((fetchedBook) => {
        if (cancelled) return
        restoredForBookIdRef.current = initialDraft.bookId
        setBook(fetchedBook)
        setPageCount(initialDraft.pageCount)
        applyDraft(initialDraft)
        setStep(initialDraft.step)
        setResuming(false)
      })
      .catch(() => {
        // The book behind this draft no longer exists (deleted since) or
        // couldn't be fetched — a stale draft pointing nowhere useful.
        // Clear it and just start fresh rather than getting stuck.
        if (!cancelled) {
          clearWizardDraft()
          setResuming(false)
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialDraft is captured once via useState's lazy initializer specifically so this effect runs exactly once, at mount; it's intentionally not meant to re-run if it were ever reassigned (it never is).
  }, [])

  // Covers a different, narrower case than the mount-time resume above:
  // the user goes Back to the file step *within the same session* (no
  // reload) and re-uploads the exact same file. The backend dedupes on
  // hash and hands back the same bookId, so this picks its draft back up
  // without the user having lost anything, even though no reload/remount
  // ever happened for the mount-time effect to catch.
  useEffect(() => {
    if (!book || restoredForBookIdRef.current === book.id) return
    restoredForBookIdRef.current = book.id
    const draft = loadWizardDraft()
    if (draft && draft.bookId === book.id) {
      // Deliberate: pulling in outside data (localStorage) on a specific
      // external trigger (a genuinely new bookId becoming available), not
      // a same-render feedback loop — same justification/precedent as
      // Modal.tsx's and EditBookModal.tsx's own use of this disable.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      applyDraft(draft)
    }
  }, [book])

  useEffect(() => {
    if (!book || step === 'file') return
    saveWizardDraft({
      bookId: book.id,
      step,
      pageCount,
      pageAssignments: {
        starts: [...pageAssignments.starts],
        skips: [...pageAssignments.skips],
        shared: [...pageAssignments.shared],
      },
      pieceFields,
      pageOffset,
    })
  }, [book, step, pageCount, pageAssignments, pieceFields, pageOffset])

  function handleUploaded(uploadedBook: Book, uploadedPageCount: number, size: number) {
    setBook(uploadedBook)
    setPageCount(uploadedPageCount)
    setFileSizeBytes(size)
    // A fresh upload always starts clean — carrying over split/title state
    // from whatever book was previously in progress here (e.g. the user
    // went Back to the file step and picked a different file) wouldn't
    // make sense against a different page count. If this turns out to be
    // the same book (hash-deduped server-side, same id returned), the
    // restore effect above will pick its draft back up right after this.
    setPageAssignments(EMPTY_ASSIGNMENTS)
    setPieceFields([])
    setPageOffset(0)
    touchedPagesRef.current = new Set()
    setStep('about')
  }

  function handleImported(pieces: ApiPiece[]) {
    clearWizardDraft()
    setImportedPieces(pieces)
  }

  // Cancel upload (design doc §5, added post-launch) — only reachable from
  // the 'about'/'split'/'titles'/'confirm' steps below, never 'file': by
  // the time any of those renders, handleUploaded has already run and
  // `book` is a real, server-side row with an uploaded PDF, which is
  // exactly the state this needs to clean up. DELETE /api/books/{id}
  // already cascade-deletes the book's file (and, as of the same change
  // that added this button, its cached page thumbnails too — see
  // purgeBookPageThumbnails in internal/handlers/helpers.go); no pieces
  // exist yet at this stage of the wizard for it to also delete.
  const cancelUploadMutation = useMutation({
    mutationFn: () => deleteBook(book!.id),
    onSuccess: () => {
      clearWizardDraft()
      onExit()
    },
    onError: (error) => {
      window.alert(error instanceof ApiError ? error.message : 'Could not cancel this upload.')
    },
  })

  function handleCancelUpload() {
    const confirmed = window.confirm(
      'Cancel this upload? The uploaded file and its generated page previews will be permanently removed from the server.',
    )
    if (!confirmed) return
    cancelUploadMutation.mutate()
  }

  if (resuming) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-ink-soft">Resuming your in-progress import…</p>
      </div>
    )
  }

  if (importedPieces && book) {
    return <ImportSuccessScreen pieces={importedPieces} bookId={book.id} onDone={onExit} />
  }

  if (step === 'file' || !book) {
    return <BookUploadFileStep onBack={onExit} onUploaded={handleUploaded} />
  }

  if (step === 'about') {
    return (
      <BookUploadAboutStep
        book={book}
        pageCount={pageCount}
        fileSizeBytes={fileSizeBytes}
        pageOffset={pageOffset}
        onPageOffsetChange={setPageOffset}
        onBack={() => setStep('file')}
        onNext={(updatedBook) => {
          setBook(updatedBook)
          setStep('split')
        }}
        onCancel={handleCancelUpload}
        cancelPending={cancelUploadMutation.isPending}
      />
    )
  }

  if (step === 'split') {
    return (
      <BookUploadSplitStep
        bookId={book.id}
        pageCount={pageCount}
        pageOffset={pageOffset}
        pageAssignments={pageAssignments}
        onChange={setPageAssignments}
        touchedPagesRef={touchedPagesRef}
        onBack={() => setStep('about')}
        onCancel={handleCancelUpload}
        cancelPending={cancelUploadMutation.isPending}
        onNext={() => {
          const pieces = computeLayout(pageAssignments, pageCount)
          // If the piece count changed since fields were last filled in
          // (the user went back and re-split), start those fields over
          // rather than reconciling stale positions against a changed
          // layout — see BookUploadTitlesStep's own comment for why a
          // piece's identity here is its array position, not something
          // stabler to diff against.
          if (pieceFields.length !== pieces.length) {
            setPieceFields(pieces.map(() => ({ title: '', composer: '', arranger: '' })))
          }
          setStep('titles')
        }}
      />
    )
  }

  const pieces = computeLayout(pageAssignments, pageCount)

  if (step === 'titles') {
    return (
      <BookUploadTitlesStep
        bookId={book.id}
        bookComposer={book.composer}
        bookArranger={book.arranger}
        pageOffset={pageOffset}
        pageCount={pageCount}
        pieces={pieces}
        pieceFields={pieceFields}
        onChange={setPieceFields}
        onBack={() => setStep('split')}
        onNext={() => setStep('confirm')}
        onCancel={handleCancelUpload}
        cancelPending={cancelUploadMutation.isPending}
      />
    )
  }

  const namedPieces: NamedPiece[] = pieces.map((piece, i) => ({
    ...piece,
    title: pieceFields[i]?.title ?? '',
    composer: pieceFields[i]?.composer ?? '',
    arranger: pieceFields[i]?.arranger ?? '',
  }))
  return (
    <BookUploadConfirmStep
      bookId={book.id}
      bookTitle={book.bookTitle}
      pageCount={pageCount}
      pageOffset={pageOffset}
      pieces={namedPieces}
      onBack={() => setStep('titles')}
      onImported={handleImported}
      onCancel={handleCancelUpload}
      cancelPending={cancelUploadMutation.isPending}
    />
  )
}
