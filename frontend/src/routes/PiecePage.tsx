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
  IconInfoCircle,
  IconMusic,
  IconProgress,
  IconRefresh,
  IconShieldCheck,
} from '@tabler/icons-react'
import { getBook } from '../api/books'
import { getCitation, getPiece, getPieceFileUrl, getPieceThumbnailUrl, replacePieceFile, updatePiece } from '../api/pieces'
import { ApiError } from '../api/client'
import { pieceToWriteRequest } from '../lib/pieceToWriteRequest'
import { EditPieceModal } from '../components/EditPieceModal'

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
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// Same hover-or-tap pattern used for the public domain badge below: hover
// works on desktop, click/tap toggles it open on touch (§12's "no
// hover-dependent interactions"). Each instance owns its own open state,
// so several can appear on the page independently.
function InheritedNote({ compact }: { compact?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Why this value is shown"
        className={
          compact
            ? 'text-[0.65rem] text-ink-soft/50 hover:text-ink-soft'
            : 'rounded-full border border-border px-1.5 py-px text-[0.65rem] font-medium text-ink-soft hover:text-ink'
        }
      >
        {compact ? '• inherited' : 'inherited'}
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-max max-w-[190px] -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-center text-xs text-paper shadow-md transition-opacity ${
          open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        Inherited from book
      </span>
    </span>
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
  className = '',
}: {
  icon: ReactNode
  label: string
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-sm text-ink hover:border-accent ${className}`}
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

  // Reset the preview to page 1 when navigating between pieces, without an
  // effect — React Router reuses this component instance across sibling
  // route matches, so pieceId can change without a remount. This is the
  // render-time "adjusting state when a prop changes" pattern rather than
  // an effect, since an effect here would cause an extra cascading render.
  const [page, setPage] = useState(1)
  const [pageResetFor, setPageResetFor] = useState(pieceId)
  if (pieceId !== pageResetFor) {
    setPageResetFor(pieceId)
    setPage(1)
  }

  const [downloadOpen, setDownloadOpen] = useState(false)
  const [replaceConfirming, setReplaceConfirming] = useState(false)
  const [replaceProgress, setReplaceProgress] = useState(0)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [tempoOpen, setTempoOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [copyToast, setCopyToast] = useState<{ x: number; y: number } | null>(null)
  const [publicDomainInfoOpen, setPublicDomainInfoOpen] = useState(false)
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
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-6 md:p-8">
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
            <div className="mx-auto flex aspect-[200/260] w-full max-w-md items-center justify-center overflow-hidden rounded-lg border border-border bg-paper-raised shadow-sm">
              <img
                src={getPieceThumbnailUrl(piece.id, page)}
                alt={`Page ${page} of ${piece.title}`}
                className="h-full w-full object-contain"
              />
            </div>

            {/* Clickable cycle buttons, not swipe/drag-only, per §12. Stop
                and grey out at the first/last page rather than wrapping
                around. Hidden entirely for a single-page piece, same
                convention as the shared PageCycleControl on library
                cards. */}
            {piece.pageCount > 1 && (
              <div className="flex items-center justify-center gap-3 text-ink-soft">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  aria-label="Previous page"
                  className="flex size-9 items-center justify-center rounded-md border border-border hover:border-accent hover:bg-accent-soft hover:text-accent disabled:pointer-events-none disabled:opacity-30"
                >
                  <IconChevronLeft size={18} />
                </button>
                <span className="text-sm tabular-nums">
                  Page {page} of {piece.pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(piece.pageCount, p + 1))}
                  disabled={page === piece.pageCount}
                  aria-label="Next page"
                  className="flex size-9 items-center justify-center rounded-md border border-border hover:border-accent hover:bg-accent-soft hover:text-accent disabled:pointer-events-none disabled:opacity-30"
                >
                  <IconChevronRightFilled size={18} />
                </button>
              </div>
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
                <span className="flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                  <IconProgress size={13} />
                  {piece.practiceStatus ?? 'No status set'}
                </span>
                {piece.userTags.map((tag) => (
                  <span key={tag.id} className="rounded-full bg-accent-soft px-2.5 py-1 text-xs text-accent">
                    {tag.name}
                  </span>
                ))}
                {piece.key && (
                  <span className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-ink-soft">
                    <IconMusic size={12} />
                    {piece.key.name}
                  </span>
                )}
                {piece.sheetType.value && (
                  <span className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-ink-soft">
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
                        sharing this row. Inert/deferred (§13). Both hover
                        (desktop) and tap/click (touch, per §12's "no
                        hover-dependent interactions") reveal the real copy
                        once the feature lands (three states: copyleft /
                        likely PD / PD) — for now the coming-soon
                        placeholder text. */}
                    <span className="group relative inline-flex">
                      <button
                        type="button"
                        onClick={() => setPublicDomainInfoOpen((o) => !o)}
                        aria-expanded={publicDomainInfoOpen}
                        aria-label="Public domain status info"
                        className="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-ink-soft/50 hover:text-ink-soft"
                      >
                        <IconShieldCheck size={11} />
                      </button>
                      <span
                        role="tooltip"
                        className={`pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-max max-w-[220px] -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-center text-xs text-paper shadow-md transition-opacity ${
                          publicDomainInfoOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}
                      >
                        Public domain status — coming soon
                      </span>
                    </span>
                  </span>
                </DetailRow>
              )}
              {piece.workOpusNumber.value && (
                <DetailRow
                  label={
                    <span className="flex items-center gap-1">
                      Opus / catalog no.
                      <IconInfoCircle
                        size={13}
                        className="cursor-pointer text-ink-soft/60"
                        aria-label="If this piece is part of a larger work which has a number assigned, enter that number."
                      />
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
                  supporting inputs. */}
              <div className="py-1.5">
                <button
                  type="button"
                  onClick={() => setTempoOpen((o) => !o)}
                  className="flex items-center gap-1 text-xs text-ink-soft/60 hover:text-ink-soft"
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
                className="flex w-fit items-center gap-1 hover:text-ink"
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
                  className="w-fit text-left font-display text-sm text-ink-soft/50 italic hover:text-ink-soft"
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
