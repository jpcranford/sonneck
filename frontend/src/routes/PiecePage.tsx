import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  IconArrowLeft,
  IconArrowsDiagonal,
  IconBook2,
  IconChevronDownFilled,
  IconChevronLeft,
  IconChevronRight,
  IconChevronRightFilled,
  IconCopy,
  IconDice5,
  IconEditFilled,
  IconDownload,
  IconExternalLink,
  IconHeart,
  IconHeartFilled,
  IconImageInPicture,
  IconMusic,
  IconRefresh,
  IconShieldCheck,
  IconTrash,
} from '@tabler/icons-react'
import { getBook } from '../api/books'
import type { Book } from '../api/types'
import { formatBookMeta } from '../lib/formatBookMeta'
import { hyphenateISBN } from '../lib/isbn'
import {
  deletePiece,
  getCitation,
  getPiece,
  getPieceFileUrl,
  getPieceThumbnailUrl,
  getRandomPiece,
  replacePieceFile,
  setPieceThumbnailPage,
  updatePiece,
} from '../api/pieces'
import { ApiError } from '../api/client'
import { pieceToWriteRequest } from '../lib/pieceToWriteRequest'
import { secondsToMMSS } from '../lib/duration'
import { EditBookModal } from '../components/EditBookModal'
import { EditPieceModal } from '../components/EditPieceModal'
import { InfoTooltip } from '../components/InfoTooltip'
import { PageLightbox } from '../components/PageLightbox'
import { PracticeStatusIcon } from '../components/PracticeStatusIcon'

// Mirrors UploadPage's own cap (backend's MaxUploadBytes) — same reasoning
// as there: reject an oversized file instantly rather than after a slow
// upload attempt.
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024

function validateReplacementFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.pdf')) return 'Only PDF files are supported.'
  if (file.size > MAX_UPLOAD_BYTES) return 'File exceeds the 500 MB upload limit.'
  return null
}

function formatDuration(seconds: number | null): string | null {
  if (seconds == null) return null
  return secondsToMMSS(seconds)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// IMSLP's "ReverseLookup" special page resolves a work/file number straight
// to its page — no need to know the piece's title or composer to link to
// it. Built from the field's own displayed value verbatim (whatever's
// actually shown, prefix or not) rather than re-deriving/stripping it —
// this is a separate, deliberately dumb pass-through, not the citation's
// own stripImslpPrefix logic (internal/handlers/citation.go), which only
// applies at citation-format time.
function imslpReverseLookupUrl(imslpNumber: string): string {
  return `https://imslp.org/index.php?title=Special:ReverseLookup&action=submit&indexsearch=${encodeURIComponent(imslpNumber)}`
}

// The Source Book card's right-hand identifier slot shows either ISBN or
// IMSLP no. — never both. IMSLP always wins when both are
// set (same "IMSLP wins the fallback" rule buildCitation already applies
// to publisherId/ISBN in the citation string): "IMSLP #{number}" takes
// the ISBN's own slot rather than the
// ISBN just being hidden with nothing replacing it, since this is a
// single-line summary that always wants exactly one identifier shown, not
// a full field list like Book Details (where the row simply doesn't
// render at all). Strips any "IMSLP" label already baked into the stored
// value (legacy data, same as the backend's own stripImslpPrefix) so the
// "IMSLP #" prefix here never doubles up.
function bookIdentifierLabel(book: Book): string | null {
  if (book.imslpNumber) return `IMSLP #${book.imslpNumber.replace(/^\s*imslp[\s:#-]*/i, '')}`
  if (book.isbn) return hyphenateISBN(book.isbn)
  return null
}

function InheritedNote({ compact }: { compact?: boolean }) {
  return (
    <InfoTooltip
      message="Inherited from book"
      ariaLabel="Why this value is shown"
      triggerClassName={
        compact
          ? 'text-[0.65rem] text-ink-soft/75 hover:text-ink'
          : 'rounded-full border border-border px-1.5 py-px text-[0.65rem] font-medium text-ink-soft/75 hover:text-ink'
      }
    >
      {compact ? '• inherited' : 'inherited'}
    </InfoTooltip>
  )
}

// Inheritance is book-level metadata, not user-specific data — kept
// neutral (hollow, bordered) so accent green stays reserved for things the
// user themselves entered (userTags, userNotes, favorite, practiceStatus).
function EffectiveValue({ value, inherited }: { value: string | null; inherited: boolean }) {
  if (!value) return <span className="text-ink-soft/50">—</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      {value}
      {inherited && <InheritedNote />}
    </span>
  )
}

function DetailRow({
  label,
  children,
  small,
  tight,
}: {
  label: ReactNode
  children: ReactNode
  small?: boolean
  tight?: boolean
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 ${tight ? 'py-0.5' : 'py-1.5'} ${small ? 'text-xs' : 'text-sm'}`}
    >
      <span className="shrink-0 text-ink-soft">{label}</span>
      <span className="text-right text-ink">{children}</span>
    </div>
  )
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  className = '',
}: {
  icon: ReactNode
  label: string
  onClick?: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-sm whitespace-nowrap text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border ${className}`}
    >
      {icon}
      {label}
    </button>
  )
}

export function PiecePage() {
  const { id } = useParams<{ id: string }>()
  const pieceId = Number(id)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()

  // "Back to X": every entry point into this page (Library/Favorites/
  // Currently Practicing's cards, Book Details' pieces list, Upload's
  // post-upload views) passes `state: { backLabel }` when it navigates
  // here — see ClickableCard.tsx's
  // own `state` prop and each of those call sites. `location.key ===
  // 'default'` is React Router's own signal that there's no real history
  // entry behind this one (a hard refresh, or the piece URL opened
  // directly) — in that case there's nothing for a real "back" to do, so
  // fall back to the Library rather than leaving the button inert or
  // navigating the browser out of the app entirely.
  const backLabel = (location.state as { backLabel?: string } | null)?.backLabel
  const hasBackHistory = location.key !== 'default'

  function handleBack() {
    if (hasBackHistory) {
      navigate(-1)
    } else {
      navigate('/')
    }
  }

  const {
    data: piece,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['piece', pieceId],
    queryFn: () => getPiece(pieceId),
  })

  const notFound = error instanceof ApiError && error.code === 'NOT_FOUND'

  const { data: book } = useQuery({
    queryKey: ['book', piece?.sourceBookId],
    queryFn: () => getBook(piece!.sourceBookId!),
    enabled: piece?.sourceBookId != null,
  })

  const { data: citationData } = useQuery({
    queryKey: ['piece', pieceId, 'citation'],
    queryFn: () => getCitation(pieceId),
    enabled: !!piece,
  })

  // Load the preview at the piece's chosen thumbnail page, resetting
  // whenever we navigate to a different piece, without an effect — React
  // Router reuses this component instance across sibling route matches, so
  // pieceId can change without a remount. This is the render-time
  // "adjusting state when a prop changes" pattern rather than an effect,
  // since an effect here would cause an extra cascading render. Waits for
  // `piece` to actually be loaded (pageResetFor starts null) since
  // thumbnailPage isn't known until then.
  const [page, setPage] = useState(1)
  const [pageResetFor, setPageResetFor] = useState<number | null>(null)
  if (piece && pageResetFor !== pieceId) {
    setPageResetFor(pieceId)
    setPage(piece.thumbnailPage)
  }

  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [replaceConfirming, setReplaceConfirming] = useState(false)
  const [replaceProgress, setReplaceProgress] = useState(0)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [tempoOpen, setTempoOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [bookEditOpen, setBookEditOpen] = useState(false)
  const [copyToast, setCopyToast] = useState<{ x: number; y: number } | null>(null)
  const replaceFileInputRef = useRef<HTMLInputElement>(null)

  const favoriteMutation = useMutation({
    mutationFn: () =>
      updatePiece(piece!.id, { ...pieceToWriteRequest(piece!), favorite: !piece!.favorite }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['piece', pieceId], updated)
      queryClient.invalidateQueries({ queryKey: ['pieces'] })
    },
  })

  // Keyboard shortcuts: E opens the edit menu, F toggles favorite — matches
  // the Edit Piece toolbar button and the header's favorite toggle, just a
  // faster path to the same two actions. Skipped entirely while the edit
  // modal is already open (its own fields are the ones that should own
  // keystrokes then) or while focus is in any text-entry element, so typing
  // a title/description containing "e"/"f" is never intercepted. `repeat`
  // is checked separately from that, since holding the key down fires
  // repeated keydown events — harmless for opening the modal a second time,
  // but would otherwise flip favorite back and forth on every repeat tick.
  useEffect(() => {
    if (!piece || editOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return
      }
      const key = event.key.toLowerCase()
      if (key === 'e') {
        event.preventDefault()
        setEditOpen(true)
      } else if (key === 'f') {
        event.preventDefault()
        favoriteMutation.mutate()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- favoriteMutation is a fresh object every render (useMutation, not memoized); depending on it would tear down/re-add this listener on every render for no behavioral difference. piece/editOpen are the only real dependencies.
  }, [piece, editOpen])

  const replaceMutation = useMutation({
    mutationFn: (file: File) => {
      setReplaceProgress(0)
      return replacePieceFile(piece!.id, file, setReplaceProgress)
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['piece', pieceId], updated)
      queryClient.invalidateQueries({ queryKey: ['pieces'] })
      setReplaceConfirming(false)
      setPage(1)
    },
  })

  const setThumbnailMutation = useMutation({
    mutationFn: (thumbnailPage: number) => setPieceThumbnailPage(piece!.id, thumbnailPage),
    onSuccess: (updated) => {
      queryClient.setQueryData(['piece', pieceId], updated)
      // Library cards read thumbnailPage too — invalidate so they pick up
      // the new selection next time they're shown, not just this page.
      queryClient.invalidateQueries({ queryKey: ['pieces'] })
    },
  })

  // The dice button — a fresh mutation each click rather than a query, since
  // this is an action ("roll again"), not data this page reads on its own;
  // navigating seeds ['piece', <new id>] fresh the normal way (Piece Details page's
  // own useQuery above), so there's no need to also populate the cache here.
  const randomPieceMutation = useMutation({
    mutationFn: getRandomPiece,
    // Deliberately does NOT forward this page's own location.state: each
    // roll pushes a real new history entry (no `replace`), so a real
    // "back" only ever undoes one roll, landing on the piece just left
    // behind — not on wherever the chain originally started. Forwarding
    // the old backLabel here would make the button claim "Back to
    // Library"/"Back to Book" while actually navigating to the previous
    // random piece, a real label/behavior mismatch. Leaving state unset
    // instead falls back to the plain "Back" label (hasBackHistory is
    // still true), which matches what the button actually does.
    onSuccess: (randomPiece) => navigate(`/pieces/${randomPiece.id}`),
    onError: (error) => {
      window.alert(error instanceof ApiError ? error.message : 'Could not find a random piece.')
    },
  })

  // Same hard-delete-with-confirm mutation as PieceContextMenu's own
  // "Delete Piece" (library right-click menu) — this toolbar button is a
  // second entry point to the identical action, not a different one, so it
  // reuses the exact confirm() wording. Unlike the context menu (which
  // deletes a card out of a list the user stays on), deleting from this
  // page removes the very piece being viewed, so success navigates back to
  // the library instead of just invalidating queries in place.
  const deleteMutation = useMutation({
    mutationFn: () => deletePiece(piece!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pieces'] })
      navigate('/')
    },
    onError: (error) => {
      window.alert(error instanceof ApiError ? error.message : 'Could not delete this piece.')
    },
  })

  function handleDelete() {
    if (piece && window.confirm(`Delete "${piece.title}"? This can't be undone.`)) {
      deleteMutation.mutate()
    }
  }

  function handleReplaceFileChosen(file: File) {
    const validationError = validateReplacementFile(file)
    if (validationError) {
      window.alert(validationError)
      return
    }
    replaceMutation.mutate(file)
  }

  // Shared by the citation button and the file hash's copy button below —
  // same "copy this text, show a toast at the click point" behavior either
  // way, just different source text.
  function handleCopy(text: string, event: MouseEvent) {
    navigator.clipboard?.writeText(text).catch(() => {})
    setCopyToast({ x: event.clientX, y: event.clientY })
    window.setTimeout(() => setCopyToast(null), 1200)
  }

  function handleCopyCitation(event: MouseEvent) {
    if (!citationData) return
    handleCopy(citationData.citation, event)
  }

  return (
    // py- (not pt-only, as before) — this page had no bottom padding at
    // all, so a long citation string (or any tall page) ran flush into
    // the app footer with nothing separating them.
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-6 md:px-8 md:py-8">
      {/* Edit Piece is a proper labeled button in this top toolbar row,
          matching every other action button on this page (Download PDF,
          Replace File, Use Page as Thumbnail). Only rendered once piece
          has loaded; nothing to edit before then.
          flex-wrap + whitespace-nowrap below: at phone widths, the back
          link and the button group don't both fit on one row, and without
          this the back link breaks mid-phrase while "Edit Piece" wraps
          inside its own button. The row wraps instead: the back link
          gets its own line, the button group drops to a second line below
          it. */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-sm whitespace-nowrap text-ink-soft hover:text-ink"
        >
          <IconArrowLeft size={24} />
          Back{backLabel ? ` to ${backLabel}` : hasBackHistory ? '' : ' to Library'}
        </button>
        {piece && (
          <div className="flex items-center gap-2">
            {/* Delete Piece, icon-only, leftmost in the group, permanently
                red. Same destructive action as PieceContextMenu's "Delete
                Piece" (library right-click menu) — handleDelete above
                reuses its exact confirm() wording — now also reachable
                directly from the page. */}
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              aria-label="Delete Piece"
              title="Delete Piece"
              className="flex size-9 items-center justify-center rounded-md border border-border bg-paper-raised text-red-700 hover:border-red-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border"
            >
              <IconTrash size={18} />
            </button>
            <span aria-hidden="true" className="h-6 w-px bg-border" />
            {/* Icon-only, no label — this is a "roll again" action, not a
                page-editing one, so it doesn't belong grouped visually with
                Edit Piece as if it were another labeled action of the same
                kind. Same bordered-square treatment as other icon-only
                buttons elsewhere (e.g. Book Details' edit-pencil button). */}
            <button
              type="button"
              onClick={() => randomPieceMutation.mutate()}
              disabled={randomPieceMutation.isPending}
              aria-label="Random Piece"
              title="Random Piece"
              className="flex size-9 items-center justify-center rounded-md border border-border bg-paper-raised text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <IconDice5 size={18} />
            </button>
            <ActionButton
              icon={<IconEditFilled size={16} />}
              label="Edit Piece"
              onClick={() => setEditOpen(true)}
            />
          </div>
        )}
      </div>

      {isLoading && <p className="text-ink-soft">Loading…</p>}

      {isError && notFound && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <h1 className="font-display text-3xl font-medium text-ink">Piece not found</h1>
          <p className="text-ink-soft">It may have been deleted or moved.</p>
        </div>
      )}

      {isError && !notFound && (
        <p className="text-ink-soft">
          {error instanceof ApiError ? error.message : 'Could not load this piece.'}
        </p>
      )}

      {piece && (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {/* ---- Preview column (§7/§14: dominates ~half the view) ---- */}
          <div className="flex flex-col gap-3">
            {/* No forced aspect ratio here on purpose — a fixed portrait
                box (the old aspect-[200/260]) made landscape pieces render
                small and letterboxed inside a tall frame that didn't match
                their actual shape. The frame always fills the column's
                full width (w-full on both the wrapper and the image);
                height is purely derived from the image's own aspect ratio
                at that width (h-auto), so every piece — portrait or
                landscape — renders at a consistent, predictable width
                instead of shrinking to whatever size the image happens to
                render at. */}
            <div className="relative mx-auto flex w-full max-w-md items-center justify-center overflow-hidden rounded-lg border border-border bg-paper-raised shadow-sm">
              {/* Lightbox trigger — see PageLightbox.tsx's own comment for
                  why it's a standalone component rather than reusing
                  Modal. The whole thumbnail is clickable, not just the
                  corner badge — the badge is a discoverability hint, not
                  the only hit target. */}
              <button
                type="button"
                onClick={() => setLightboxOpen(true)}
                aria-label={`View page ${page} larger`}
                className="block w-full cursor-zoom-in"
              >
                <img
                  src={getPieceThumbnailUrl(piece.id, page)}
                  alt={`Page ${page} of ${piece.title}`}
                  className="h-auto w-full"
                />
              </button>

              {/* Always-visible "view larger" hint, not a hover reveal —
                  same device-aware reasoning as the lightbox's own zoom
                  hint: this has to be discoverable by tap alone.
                  Top-right since the page-cycle capsule already owns the
                  bottom edge. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-2.5 right-2.5 flex items-center justify-center rounded-full bg-ink/80 p-1.5 text-white shadow-md backdrop-blur-sm"
              >
                <IconArrowsDiagonal size={14} />
              </div>

              {/* Page cycle control, floating over the bottom edge of the
                  preview itself rather than as a separate row underneath —
                  keeps the preview column shorter and reads as one piece of
                  chrome instead of two. Stops and greys out at the
                  first/last page rather than wrapping around, per §12.
                  Hidden entirely for a single-page piece, same convention
                  as the shared PageCycleControl on library cards. */}
              {piece.pageCount > 1 && (
                <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-ink/80 px-2 py-1 shadow-md backdrop-blur-sm">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    aria-label="Previous page"
                    className="flex size-6 items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-accent-on-dark disabled:pointer-events-none disabled:opacity-35"
                  >
                    <IconChevronLeft size={14} />
                  </button>
                  <span className="text-xs tabular-nums text-white/90">
                    {page} / {piece.pageCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(piece.pageCount, p + 1))}
                    disabled={page === piece.pageCount}
                    aria-label="Next page"
                    className="flex size-6 items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-accent-on-dark disabled:pointer-events-none disabled:opacity-35"
                  >
                    <IconChevronRightFilled size={14} />
                  </button>
                </div>
              )}
            </div>

            {lightboxOpen && (
              <PageLightbox
                key={page}
                imageUrl={getPieceThumbnailUrl(piece.id, page)}
                alt={`Page ${page} of ${piece.title}`}
                page={page}
                pageCount={piece.pageCount}
                onClose={() => setLightboxOpen(false)}
                onPrev={() => setPage((p) => Math.max(1, p - 1))}
                onNext={() => setPage((p) => Math.min(piece.pageCount, p + 1))}
              />
            )}

            {/* Download / Replace File — act on the file the preview above
                shows, so both sit with the preview rather than in the info
                column's field list. */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <div className="relative flex overflow-hidden rounded-md">
                <a
                  href={getPieceFileUrl(piece.id)}
                  download
                  className="flex items-center gap-2 bg-accent px-4 py-2 font-display text-sm text-white hover:bg-accent/90"
                >
                  <IconDownload size={16} />
                  Download PDF
                </a>
                <button
                  type="button"
                  onClick={() => setDownloadOpen((o) => !o)}
                  aria-label="More download options"
                  className="flex items-center justify-center border-l border-white/25 bg-accent px-2 text-white hover:bg-accent/90"
                >
                  <IconChevronDownFilled size={16} />
                </button>
                {downloadOpen && (
                  <div className="absolute top-full left-0 z-10 mt-1 w-64 overflow-hidden rounded-md border border-border bg-paper-raised py-1 text-left shadow-lg">
                    <a
                      href={getPieceFileUrl(piece.id)}
                      download
                      className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-accent-soft"
                    >
                      Download PDF
                    </a>
                    <button
                      type="button"
                      disabled
                      className="block w-full cursor-not-allowed px-3 py-2 text-left text-sm text-ink-soft/50"
                    >
                      Download original + annotations
                      <span className="block text-xs italic">Coming with annotations (§13)</span>
                    </button>
                  </div>
                )}
              </div>

              <ActionButton
                icon={<IconRefresh size={16} />}
                label="Replace File"
                onClick={() => setReplaceConfirming(true)}
              />
              <ActionButton
                icon={<IconImageInPicture size={16} />}
                label="Use Page as Thumbnail"
                onClick={() => setThumbnailMutation.mutate(page)}
                disabled={page === piece.thumbnailPage || setThumbnailMutation.isPending}
              />
              <input
                ref={replaceFileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) handleReplaceFileChosen(file)
                  event.target.value = ''
                }}
              />
            </div>

            {replaceConfirming && !replaceMutation.isPending && (
              <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-accent-soft/40 px-4 py-2.5 text-center text-sm">
                <span className="text-ink">
                  Replace this piece's file? The old file is deleted permanently.
                </span>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => setReplaceConfirming(false)}
                    className="rounded-md border border-border bg-paper-raised px-3 py-1 text-ink hover:border-accent"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => replaceFileInputRef.current?.click()}
                    className="rounded-md bg-accent px-3 py-1 text-white hover:bg-accent/90"
                  >
                    Choose File…
                  </button>
                </div>
              </div>
            )}
            {replaceMutation.isPending && (
              <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-accent-soft/40 px-4 py-2.5">
                <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-accent transition-[width]"
                    style={{ width: `${Math.round(replaceProgress)}%` }}
                  />
                </div>
                <span className="text-sm text-ink-soft">
                  Replacing… {Math.round(replaceProgress)}%
                </span>
              </div>
            )}
            {replaceMutation.isError && (
              <p className="text-center text-sm text-red-700">
                {replaceMutation.error instanceof ApiError
                  ? replaceMutation.error.message
                  : 'Could not replace this file. Please try again.'}
              </p>
            )}

            {/* Your notes — private, free text, never book-inheritable. */}
            {piece.userNotes && (
              <div className="flex flex-col gap-1">
                <span className="text-sm text-ink-soft">Your notes</span>
                <p className="rounded-md bg-accent-soft/40 px-3 py-2 text-sm text-ink">
                  {piece.userNotes}
                </p>
              </div>
            )}
          </div>

          {/* ---- Info column ---- */}
          {/* Mobile-only top rule: on desktop this column sits beside the
              preview column, so nothing needs separating; on mobile the two
              columns stack (grid-cols-1) and this ends up directly under
              Your Notes, which reads as a run-on without a visual break. */}
          <div className="flex flex-col gap-6 border-t border-border pt-6 lg:border-t-0 lg:pt-0">
            {/* Header: title, edit + favorite, composer, status pills */}
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-4">
                <h1 className="font-display text-3xl font-medium text-ink">{piece.title}</h1>
                <div className="mt-1 flex shrink-0 items-center gap-3">
                  {/* Edit moved to the top toolbar (a proper labeled
                      button, not an icon-only one) — see this file's
                      top-of-page comment. Favorite stays here; it's a
                      one-tap toggle, not an editing action, so it doesn't
                      belong in that toolbar. */}
                  <button
                    type="button"
                    onClick={() => favoriteMutation.mutate()}
                    disabled={favoriteMutation.isPending}
                    aria-label={piece.favorite ? 'Remove from favorites' : 'Add to favorites'}
                    aria-pressed={piece.favorite}
                    className="text-ink-soft hover:text-accent disabled:opacity-60"
                  >
                    {piece.favorite ? (
                      <IconHeartFilled size={24} className="text-accent" />
                    ) : (
                      <IconHeart size={24} />
                    )}
                  </button>
                </div>
              </div>

              {/* Arranger folded into the composer line ("X • arr. Y")
                  instead of its own details-list row — omitted entirely,
                  same as every other row, when not set. Dot separator
                  matches the Publisher row's publisher/publisherId pairing
                  below — but only when composer is actually present:
                  composer-or-arranger means a piece can have an arranger
                  with no composer at all, and the dot
                  must not render with nothing on its left to separate. */}
              <p className="flex flex-wrap items-center gap-1.5 text-ink-soft">
                {piece.composer.value ? (
                  <>
                    <EffectiveValue value={piece.composer.value} inherited={piece.composer.inherited} />
                    {piece.arranger.value && <span>• arr. {piece.arranger.value}</span>}
                  </>
                ) : piece.arranger.value ? (
                  <span className="inline-flex items-center gap-1.5">
                    arr. {piece.arranger.value}
                    {piece.arranger.inherited && <InheritedNote />}
                  </span>
                ) : (
                  <span className="text-ink-soft/50">—</span>
                )}
              </p>

              {/* Practice status + remaining metadata pills (key, sheet
                  type — instruments moved into the details list below,
                  public domain moved onto the Year written row), with user
                  tags right after practice status. Practice status and
                  user tags stay green (genuinely user data); key/sheetType
                  are neutral hollow pills like everywhere else. */}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {piece.practiceStatus && (
                  <span className="flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                    <PracticeStatusIcon status={piece.practiceStatus} size={13} />
                    {piece.practiceStatus}
                  </span>
                )}
                {piece.userTags.map((tag) => (
                  <span
                    key={tag.id}
                    className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent"
                  >
                    {tag.name}
                  </span>
                ))}
                {/* A piece's keys are a sequence, not an unordered set of
                    tags — a piece that modulates (e.g. A Minor → C Major)
                    needs that order to survive the display. One merged
                    pill, keys joined by a small de-emphasized chevron
                    separator, rather than one separate pill per key with
                    no indication of order at all. */}
                {piece.keys.length > 0 && (
                  <span className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-ink-soft">
                    <IconMusic size={12} className="shrink-0" />
                    <span className="flex items-center gap-1">
                      {piece.keys.map((key, i) => (
                        // Composite key (id + position), not just key.id —
                        // a modulating piece can use the same key twice in
                        // its sequence (migration 00012).
                        <span key={`${key.id}-${i}`} className="flex items-center gap-1">
                          {i > 0 && (
                            <span className="font-normal opacity-[0.55]" aria-hidden="true">
                              ›
                            </span>
                          )}
                          {/* text-center: at narrow widths a key name can
                              wrap onto two lines ("E" / "Major") — without
                              this the wrapped lines default to left-align,
                              so a short top word like "E" doesn't sit
                              centered over the wider word below it. */}
                          <span className="text-center">{key.name}</span>
                        </span>
                      ))}
                    </span>
                  </span>
                )}
                {piece.sheetType.value && (
                  <span className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-ink-soft">
                    {piece.sheetType.value.name}
                    {piece.sheetType.inherited && <InheritedNote compact />}
                  </span>
                )}
              </div>
            </div>

            {/* Details — unboxed on purpose: reads as part of the page's
                normal flow, with just a rule above to separate it from
                the pills above. Every row is conditional on having
                something to show — missing/unset metadata just omits the
                line entirely rather than rendering a "—" placeholder. The
                Advanced/Get Info box below is the one exception: its
                fields always render, dash or not. */}
            <div className="divide-y divide-border border-t border-border">
              {piece.instruments.values.length > 0 && (
                <DetailRow label="Instruments">
                  <span className="inline-flex items-center gap-1.5">
                    {piece.instruments.values.map((tag) => tag.name).join(', ')}
                    {piece.instruments.inherited && <InheritedNote />}
                  </span>
                </DetailRow>
              )}
              {piece.yearWritten.value && (
                <DetailRow label="Year written">
                  <span className="inline-flex items-center gap-2">
                    <EffectiveValue value={piece.yearWritten.value} inherited={piece.yearWritten.inherited} />
                    {/* Public domain badge — circular icon-only badge
                        sharing this row. Inert/deferred (§13); the real
                        copy (three states: copyleft / likely PD / PD)
                        lands with the feature — for now the coming-soon
                        placeholder text. */}
                    <InfoTooltip
                      message="Public domain status — coming soon"
                      ariaLabel="Public domain status info"
                      // Solid pre-blend, not opacity — overlapping icon strokes would re-blend unevenly under real translucency.
                      triggerClassName="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-[#aca7a1] hover:text-ink-soft"
                    >
                      <IconShieldCheck size={11} />
                    </InfoTooltip>
                  </span>
                </DetailRow>
              )}
              {piece.workOpusNumber.value && (
                <DetailRow label="Opus / catalog no.">
                  <EffectiveValue
                    value={piece.workOpusNumber.value}
                    inherited={piece.workOpusNumber.inherited}
                  />
                </DetailRow>
              )}
              {piece.imslpNumber.value && (
                <DetailRow label="IMSLP no.">
                  <span className="inline-flex items-center gap-1.5">
                    <EffectiveValue
                      value={piece.imslpNumber.value}
                      inherited={piece.imslpNumber.inherited}
                    />
                    {/* Comes after the "inherited" pill (inside
                        EffectiveValue) rather than before it — the pill
                        explains where the number came from, this link
                        acts on the number itself, so it reads left-to-
                        right as value → provenance → action. */}
                    <a
                      href={imslpReverseLookupUrl(piece.imslpNumber.value)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="View on IMSLP"
                      // Solid pre-blend, not opacity — overlapping icon strokes would re-blend unevenly under real translucency.
                      className="text-[#9c968f] hover:text-ink-soft"
                    >
                      <IconExternalLink size={13} />
                    </a>
                  </span>
                </DetailRow>
              )}
              {(piece.publisher.value || piece.publisherId.value) && (
                <DetailRow label="Publisher">
                  <span className="inline-flex items-center gap-1.5">
                    <EffectiveValue value={piece.publisher.value} inherited={piece.publisher.inherited} />
                    {piece.publisherId.value && (
                      <span className="text-xs text-ink-soft">• {piece.publisherId.value}</span>
                    )}
                  </span>
                </DetailRow>
              )}
              {piece.sourcePageStart != null && (
                <DetailRow label="Source pages">
                  {/* sourcePageEnd is independently nullable (EditPieceModal's
                      two fields aren't linked) — falling back to
                      sourcePageStart here, not comparing the raw fields
                      directly, avoids rendering "pp. 5–null" for a piece
                      whose end page was never set. */}
                  {(piece.sourcePageEnd ?? piece.sourcePageStart) === piece.sourcePageStart
                    ? `p. ${piece.sourcePageStart}`
                    : `pp. ${piece.sourcePageStart}–${piece.sourcePageEnd}`}
                </DetailRow>
              )}
              {formatDuration(piece.duration) && (
                <DetailRow label="Duration">{formatDuration(piece.duration)}</DetailRow>
              )}

              {/* bpm/measureCount/beatsPerMeasure — tucked behind a
                  disclosure, same convention as the edit menu (§15):
                  duration is what matters day-to-day, these are
                  supporting inputs. Same hide-if-missing rule as the rest
                  of this list — no point in a disclosure with nothing
                  behind it. */}
              {(piece.bpm != null || piece.measureCount != null || piece.beatsPerMeasure != null) && (
                <div className="py-1.5">
                  <button
                    type="button"
                    onClick={() => setTempoOpen((o) => !o)}
                    // Solid pre-blend (icon + label share one color).
                    className="flex items-center gap-1 text-xs text-[#847d75] hover:text-ink-soft"
                  >
                    <IconChevronRight
                      size={12}
                      className={`transition-transform ${tempoOpen ? 'rotate-90' : ''}`}
                    />
                    Tempo details
                  </button>
                  {tempoOpen && (
                    <div className="mt-1 flex flex-col pl-5">
                      <DetailRow tight label="BPM">
                        {piece.bpm ?? '—'}
                      </DetailRow>
                      <DetailRow tight label="Measures">
                        {piece.measureCount ?? '—'}
                      </DetailRow>
                      <DetailRow tight label="Beats / measure">
                        {piece.beatsPerMeasure ?? '—'}
                      </DetailRow>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Description (book-inheritable) */}
            {piece.description.value && (
              <div className="flex flex-col gap-1">
                <span className="text-sm text-ink-soft">Description</span>
                <p className="text-sm text-ink">
                  <EffectiveValue
                    value={piece.description.value}
                    inherited={piece.description.inherited}
                  />
                </p>
              </div>
            )}

            {/* Book Details section — shown only when sourceBookId is
                set. Editing writes to the Book record only (§14/§16). */}
            {piece.sourceBookId && book && (
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-paper-raised px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                    <IconBook2 size={16} />
                    Source Book
                  </span>
                  <button
                    type="button"
                    onClick={() => setBookEditOpen(true)}
                    aria-label="Edit book details"
                    // Solid pre-blend, not opacity — overlapping icon strokes would re-blend unevenly under real translucency.
                    className="text-[#9d9892] hover:text-ink"
                  >
                    <IconEditFilled size={16} />
                  </button>
                </div>
                <Link
                  to={`/books/${book.id}`}
                  className="font-display text-ink italic hover:text-accent hover:underline"
                >
                  {book.bookTitle}
                </Link>
                {/* ISBN: right-aligned opposite composer/year on the same
                    line, quiet and catalog-number-styled rather than competing
                    with composer for reading order. Shows "IMSLP
                    #{number}" in this exact slot instead whenever IMSLP is
                    set — see bookIdentifierLabel's own comment. */}
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm text-ink-soft">
                    {formatBookMeta(book) || (
                      <span className="text-ink-soft/60 italic">No composer or publisher on file</span>
                    )}
                  </p>
                  {bookIdentifierLabel(book) && (
                    <span className="shrink-0 font-mono text-xs whitespace-nowrap text-ink-soft/75 tabular-nums">
                      {bookIdentifierLabel(book)}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Advanced/Get Info panel (deferred, §14) */}
            <div className="flex flex-col gap-2 text-xs text-ink-soft">
              <button
                type="button"
                onClick={() => setAdvancedOpen((o) => !o)}
                // Solid pre-blend (icon + label share one color).
                className="flex w-fit items-center gap-1 text-[#847d75] hover:text-ink-soft"
              >
                <IconChevronRight
                  size={13}
                  className={`transition-transform ${advancedOpen ? 'rotate-90' : ''}`}
                />
                Advanced / Get Info (coming soon)
              </button>
              {advancedOpen && (
                <div className="flex flex-col rounded-md border border-dashed border-border px-3 py-2">
                  {/* The one exception to "hide missing metadata" above —
                      this box always shows every field, dash or not,
                      since it's meant as a literal dump of everything on
                      the record. Contents sized down further (small)
                      since this whole box already reads as
                      secondary/deferred, and tightened (tight) same as
                      Tempo details' rows. */}
                  <DetailRow small tight label="File hash">
                    {/* Abbreviated display stays as-is (a full 64-char
                        SHA-256 would wrap raggedly in this tight
                        label/value row, worse on mobile) — the copy
                        button gives access to the full value for anyone
                        who actually needs to verify it against e.g.
                        `sha256sum`, without changing the row's layout. */}
                    <span className="inline-flex items-center gap-1">
                      <span className="font-mono">{piece.fileHash.slice(0, 16)}…</span>
                      <button
                        type="button"
                        onClick={(event) => handleCopy(piece.fileHash, event)}
                        aria-label="Copy full file hash"
                        // Solid pre-blend, not opacity — overlapping icon strokes would re-blend unevenly under real translucency.
                        className="text-[#aca7a1] hover:text-ink-soft"
                      >
                        <IconCopy size={12} />
                      </button>
                    </span>
                  </DetailRow>
                  <DetailRow small tight label="Page count">
                    {piece.pageCount}
                  </DetailRow>
                  <DetailRow small tight label="Created">
                    {formatDate(piece.createdAt)}
                  </DetailRow>
                  <DetailRow small tight label="Last updated">
                    {formatDate(piece.updatedAt)}
                  </DetailRow>
                  <DetailRow small tight label="Copyright year">
                    {piece.copyrightYear ?? '—'}
                  </DetailRow>
                </div>
              )}
            </div>

            {/* Citation — click-to-copy (§6), no separate button; faint by
                design since it's a reference-lookup detail, not primary
                content on the page. Uses the backend's own citation string
                verbatim (not reconstructed client-side) so this can never
                drift from the real §6 format — the trade-off is the book
                title isn't italicized here, since the backend returns
                plain text with no structure to style. */}
            {citationData && (
              <div className="flex flex-col gap-1 border-t border-border pt-4">
                <span className="text-[0.65rem] tracking-wide text-ink-soft/40 uppercase">
                  Citation
                </span>
                <button
                  type="button"
                  onClick={handleCopyCitation}
                  className="w-fit text-left font-display text-sm text-ink-soft/75 italic hover:text-ink-soft"
                >
                  {citationData.citation}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {piece && <EditPieceModal piece={piece} open={editOpen} onClose={() => setEditOpen(false)} />}

      {book && (
        <EditBookModal book={book} open={bookEditOpen} onClose={() => setBookEditOpen(false)} />
      )}

      {copyToast && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[140%] rounded-md bg-ink px-2 py-1 text-xs text-paper shadow-md"
          style={{ left: copyToast.x, top: copyToast.y }}
        >
          Copied!
        </div>
      )}
    </div>
  )
}
