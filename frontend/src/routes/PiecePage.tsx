import { useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  IconArrowLeft,
  IconBook2,
  IconChevronDownFilled,
  IconChevronLeft,
  IconChevronRight,
  IconChevronRightFilled,
  IconEditFilled,
  IconDownload,
  IconHeart,
  IconHeartFilled,
  IconImageInPicture,
  IconInfoCircle,
  IconMusic,
  IconProgress,
  IconRefresh,
  IconShieldCheck,
} from '@tabler/icons-react'
import { getBook } from '../api/books'
import {
  getCitation,
  getPiece,
  getPieceFileUrl,
  getPieceThumbnailUrl,
  replacePieceFile,
  setPieceThumbnailPage,
  updatePiece,
} from '../api/pieces'
import { ApiError } from '../api/client'
import { pieceToWriteRequest } from '../lib/pieceToWriteRequest'
import { secondsToMMSS } from '../lib/duration'
import { EditPieceModal } from '../components/EditPieceModal'
import { InfoTooltip } from '../components/InfoTooltip'

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
      className={`flex items-center gap-2 rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-sm text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border ${className}`}
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

  const [downloadOpen, setDownloadOpen] = useState(false)
  const [replaceConfirming, setReplaceConfirming] = useState(false)
  const [replaceProgress, setReplaceProgress] = useState(0)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [tempoOpen, setTempoOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
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

  function handleReplaceFileChosen(file: File) {
    const validationError = validateReplacementFile(file)
    if (validationError) {
      window.alert(validationError)
      return
    }
    replaceMutation.mutate(file)
  }

  function handleCopyCitation(event: MouseEvent) {
    if (!citationData) return
    navigator.clipboard?.writeText(citationData.citation).catch(() => {})
    setCopyToast({ x: event.clientX, y: event.clientY })
    window.setTimeout(() => setCopyToast(null), 1200)
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 pt-6 md:px-8 md:pt-8">
      <Link
        to="/"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-ink-soft hover:text-ink"
      >
        <IconArrowLeft size={16} />
        Back to Library
      </Link>

      {isLoading && <p className="text-ink-soft">Loading…</p>}

      {isError && notFound && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <h1 className="font-display text-3xl text-ink">Piece not found</h1>
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
              <img
                src={getPieceThumbnailUrl(piece.id, page)}
                alt={`Page ${page} of ${piece.title}`}
                className="h-auto w-full"
              />

              {/* Page cycle control, floating over the bottom edge of the
                  preview itself rather than as a separate row underneath
                  (design review 2026-08-16, "integrated capsule" option) —
                  keeps the preview column shorter and reads as one piece of
                  chrome instead of two. Stops and greys out at the
                  first/last page rather than wrapping around, per §12.
                  Hidden entirely for a single-page piece, same convention
                  as the shared PageCycleControl on library cards. */}
              {piece.pageCount > 1 && (
                <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-ink/80 py-1 pr-1 pl-3 shadow-md backdrop-blur-sm">
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
                  <button
                    type="button"
                    onClick={() => setEditOpen(true)}
                    aria-label="Edit piece"
                    className="text-ink-soft hover:text-accent"
                  >
                    <IconEditFilled size={21} />
                  </button>
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
                  matches the Publisher row's publisher/publisherId
                  pairing below. */}
              <p className="flex flex-wrap items-center gap-1.5 text-ink-soft">
                <EffectiveValue value={piece.composer.value} inherited={piece.composer.inherited} />
                {piece.arranger && <span>• arr. {piece.arranger}</span>}
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
                    <IconProgress size={13} />
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
                    (design review: "option A, with the small arrows from
                    option E" — A's neutral bordered pill styling, E's
                    subtler opacity-based separator instead of A's own
                    "→"), rather than one separate pill per key with no
                    indication of order at all. */}
                {piece.keys.length > 0 && (
                  <span className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-ink-soft">
                    <IconMusic size={12} className="shrink-0" />
                    <span className="flex items-center gap-1">
                      {piece.keys.map((key, i) => (
                        <span key={key.id} className="flex items-center gap-1">
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
                      triggerClassName="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-ink-soft/50 hover:text-ink-soft"
                    >
                      <IconShieldCheck size={11} />
                    </InfoTooltip>
                  </span>
                </DetailRow>
              )}
              {piece.workOpusNumber.value && (
                <DetailRow
                  label={
                    <span className="flex items-center gap-1">
                      Opus / catalog no.
                      <InfoTooltip
                        message="If this piece is part of a larger work which has a number assigned, enter that number."
                        ariaLabel="What Opus / catalog no. means"
                        triggerClassName="text-ink-soft/60 hover:text-ink-soft"
                      >
                        <IconInfoCircle size={13} />
                      </InfoTooltip>
                    </span>
                  }
                >
                  <EffectiveValue
                    value={piece.workOpusNumber.value}
                    inherited={piece.workOpusNumber.inherited}
                  />
                </DetailRow>
              )}
              {piece.imslpNumber.value && (
                <DetailRow label="IMSLP no.">
                  <EffectiveValue value={piece.imslpNumber.value} inherited={piece.imslpNumber.inherited} />
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
                  {piece.sourcePageStart === piece.sourcePageEnd
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
                    className="flex items-center gap-1 text-xs text-ink-soft/75 hover:text-ink-soft"
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

            {/* Last updated — directly below Description; the
                Advanced/Get Info disclosure below stays in its own spot
                after Source Book, this line isn't part of it. */}
            <p className="text-xs text-ink-soft">Last updated {formatDate(piece.updatedAt)}</p>

            {/* Book Details section — shown only when sourceBookId is
                set. Editing writes to the Book record only (§14/§16); the
                edit affordance is inert for now — the Book Properties
                Edit Menu (§16) is a separate, later phase. */}
            {piece.sourceBookId && book && (
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-paper-raised px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                    <IconBook2 size={16} />
                    Source Book
                  </span>
                  <button
                    type="button"
                    disabled
                    aria-label="Edit book details (coming soon)"
                    className="cursor-not-allowed text-ink-soft/40"
                  >
                    <IconEditFilled size={16} />
                  </button>
                </div>
                <p className="font-display text-ink italic">{book.bookTitle}</p>
                <p className="text-sm text-ink-soft">
                  {[book.composer, book.yearWritten].filter(Boolean).join(' • ')}
                </p>
              </div>
            )}

            {/* Advanced/Get Info panel (deferred, §14) */}
            <div className="flex flex-col gap-2 text-xs text-ink-soft">
              <button
                type="button"
                onClick={() => setAdvancedOpen((o) => !o)}
                className="flex w-fit items-center gap-1 text-ink-soft/75 hover:text-ink-soft"
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
                    <span className="font-mono">{piece.fileHash.slice(0, 16)}…</span>
                  </DetailRow>
                  <DetailRow small tight label="Page count">
                    {piece.pageCount}
                  </DetailRow>
                  <DetailRow small tight label="Created">
                    {formatDate(piece.createdAt)}
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
