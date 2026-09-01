import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  IconArrowsSplit2,
  IconArrowLeft,
  IconCameraFilled,
  IconEditFilled,
  IconHeartFilled,
  IconLayoutGridFilled,
  IconLayoutListFilled,
  IconMusic,
  IconTrash,
} from '@tabler/icons-react'
import { listBooks } from '../api/books'
import {
  deletePerson,
  getPerson,
  getPersonPortraitUrl,
  listPeople,
  removePersonPortrait,
  splitPerson,
} from '../api/people'
import { getPieceThumbnailUrl, searchPieces } from '../api/pieces'
import { ApiError } from '../api/client'
import type { Person, Piece, Tag } from '../api/types'
import { EditPersonModal } from '../components/EditPersonModal'
import { UploadPortraitModal } from '../components/UploadPortraitModal'
import { ContextMenu } from '../components/ContextMenu'
import { ClickableCard } from '../components/ClickableCard'
import { PieceContextMenu } from '../components/PieceContextMenu'
import { MarkdownText } from '../components/MarkdownText'
import { Modal } from '../components/Modal'
import { TagComboBox } from '../components/TagComboBox'
import { TagPills } from '../components/TagPills'
import { joinNames, personCreditPart } from '../lib/joinNames'
import { PALETTE } from '../lib/pieceSplitLogic'

// The real Person Details page (/people/:id) — composer/arranger overhaul,
// Stage B. Real build of PersonDetailsSample.tsx (/mockup/person-details,
// kept as a standing design reference) — same header card (oval portrait,
// bio, direct book-credit chips) and works grid/list mirroring Book
// Details' own PieceList, wired to the real API instead of one fixture
// person (Chopin).
//
// Upload Portrait is simplified from the mockup's own three-screen flow
// (device/Wikipedia search, then a drag-to-pan/zoom-slider adjust step) to
// a plain file picker — same "no redundant triggers, straight upload, no
// server-side crop" treatment Book Details' own cover image already uses
// (BookDetailsPage.tsx's coverFileInputRef). Neither a cropping endpoint
// nor a Wikipedia image-search endpoint exists on the backend yet (Stage
// A only built Person CRUD/portrait-upload/split) — building either is
// real backend work beyond porting an approved mockup, left for later.

function formatLifespan(person: Person): string | null {
  if (person.birthYear && person.deathYear) return `${person.birthYear}–${person.deathYear}`
  if (person.deathYear) return `d. ${person.deathYear}`
  if (person.birthYear) return `b. ${person.birthYear}`
  return null
}

function workTitle(piece: Piece): string {
  return piece.workOpusNumber.value ? `${piece.title} (${piece.workOpusNumber.value})` : piece.title
}
function pagesLabel(piece: Piece): string {
  return `${piece.pageCount} ${piece.pageCount === 1 ? 'page' : 'pages'}`
}
// The work's own full composer/arranger credit (not just this person's
// role), fused with page count and its source book — mirrors
// BookDetailsPage.tsx's own pieceMetaLine, plus the book credit appended
// at the end (this page's own addition, since a work's book isn't shown
// anywhere else on this screen the way it is on Book Details itself).
function workMetaLine(piece: Piece): string {
  const composerPart = personCreditPart(
    piece.composer.values.map((p) => p.name),
    piece.arranger.values.map((p) => p.name),
  )
  return [composerPart, pagesLabel(piece), piece.sourceBookTitle]
    .filter((part): part is string => !!part)
    .join(' • ')
}
// Which role this specific person plays on this specific work — a piece
// can credit the same person as neither, one, or (in principle) both; this
// checks composer first, same "Composer is the expected/default credit"
// reasoning the mockup's own RoleBadge established.
function roleFor(piece: Piece, personId: number): 'Composer' | 'Arranger' {
  return piece.composer.values.some((p) => p.id === personId) ? 'Composer' : 'Arranger'
}
// yearWritten can be a range ("1830–1832") — sorts on the first number
// found; a work with no year sorts last (this app's usual
// direction-invariant blank-field-last convention).
function workYearSortKey(piece: Piece): number {
  const match = piece.yearWritten.value.match(/\d+/)
  return match ? Number(match[0]) : Number.POSITIVE_INFINITY
}
function sortWorksByYear(pieces: Piece[]): Piece[] {
  return [...pieces].sort((a, b) => workYearSortKey(a) - workYearSortKey(b))
}

// Only the Arranger role is called out — Composer is the expected/default
// credit on a composer's own Details page, so "as Composer" on every row
// would just be noise; only the exception is worth a badge.
function RoleBadge({ role }: { role: 'Composer' | 'Arranger' }) {
  if (role !== 'Arranger') return null
  return (
    <span className="shrink-0 rounded-full bg-paper-sunken px-2 py-0.5 font-sans text-[0.65rem] font-medium text-ink-soft">
      as Arranger
    </span>
  )
}

function PersonAvatar({ person, className }: { person: Person; className: string }) {
  const color = PALETTE[person.id % PALETTE.length]
  const initials = person.name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .filter(Boolean)
  const initialsText =
    initials.length === 0 ? '?' : (initials[0] + (initials[initials.length - 1] ?? '')).toUpperCase()
  return (
    <div
      className={`relative aspect-[3/4] overflow-hidden rounded-[50%] border border-border [container-type:inline-size] ${className}`}
      style={{ backgroundColor: color }}
    >
      {person.hasCustomPortrait ? (
        <img
          src={getPersonPortraitUrl(person.id, person.portraitImageHash)}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center font-display font-medium text-white text-[26cqw]">
          {initialsText}
        </div>
      )}
    </div>
  )
}

const THUMB_HIDE_CLASS = 'max-[501px]:hidden'
const ROW_COLLAPSE_CLASS = 'max-[501px]:grid-cols-[72px_1fr]'

function WorkThumbnail({ piece, className }: { piece: Piece; className: string }) {
  return (
    <div className={`relative overflow-hidden border border-border ${className}`}>
      <img
        src={getPieceThumbnailUrl(piece.id, piece.thumbnailPage)}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover object-top"
      />
    </div>
  )
}

// Right-click/long-press menu: shares PieceContextMenu with the Piece
// Library's own cards and Book Details' own PieceGrid/PieceList (see that
// file's own comment on the same pattern) rather than a separate copy —
// same favorite/edit/delete items, same hideTriggerButton convention (no
// visible "⋯" trigger; touch users get ContextMenu's built-in long-press
// instead, same as every other card using this component).
function WorkGrid({ pieces, personId }: { pieces: Piece[]; personId: number }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3">
      {pieces.map((piece) => (
        <PieceContextMenu key={piece.id} piece={piece} hideTriggerButton>
          <ClickableCard
            to={`/pieces/${piece.id}`}
            state={{ backLabel: 'Person' }}
            className="flex flex-col overflow-hidden rounded-lg border border-border bg-paper-raised text-left"
          >
            <WorkThumbnail piece={piece} className="aspect-[180/132] rounded-none border-0 border-b" />
            <div className="flex flex-col gap-0.5 px-2 py-1.5">
              <p className="flex min-w-0 items-center gap-1 font-display text-[0.8rem] font-medium text-ink">
                <span className="truncate">{workTitle(piece)}</span>
                {piece.favorite && (
                  <span className="shrink-0 text-accent" title="Favorite">
                    <IconHeartFilled size={13} />
                  </span>
                )}
              </p>
              <p className="text-[0.65rem] text-ink-soft/80">
                {piece.yearWritten.value || '—'}
                {roleFor(piece, personId) === 'Arranger' && ' • as Arranger'}
              </p>
            </div>
          </ClickableCard>
        </PieceContextMenu>
      ))}
    </div>
  )
}

function WorkList({ pieces, personId }: { pieces: Piece[]; personId: number }) {
  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-[96px_1fr_56px] gap-3 px-1.5 pb-2.5 text-[0.7rem] font-medium tracking-wide text-ink-soft uppercase">
        <div className="text-center">Year</div>
        <div>Title</div>
        <div className={THUMB_HIDE_CLASS} />
      </div>
      <div>
        {pieces.map((piece) => (
          <PieceContextMenu key={piece.id} piece={piece} hideTriggerButton>
            <ClickableCard
              to={`/pieces/${piece.id}`}
              state={{ backLabel: 'Person' }}
              className={`grid grid-cols-[96px_1fr_56px] items-center gap-3 border-t border-border px-1.5 py-2.5 text-left hover:rounded-md hover:bg-accent-soft ${ROW_COLLAPSE_CLASS}`}
            >
              <div className="text-center text-sm font-medium tabular-nums text-ink">
                {piece.yearWritten.value || '—'}
              </div>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 font-display text-[0.92rem] font-medium text-ink">
                  {workTitle(piece)}
                  {piece.favorite && (
                    <span className="text-accent" title="Favorite">
                      <IconHeartFilled size={13} />
                    </span>
                  )}
                  <RoleBadge role={roleFor(piece, personId)} />
                </p>
                <p className="mt-0.5 text-xs text-ink-soft">{workMetaLine(piece)}</p>
                <TagPills
                  keys={piece.keys}
                  sheetType={piece.sheetType.inherited ? null : piece.sheetType.value}
                  instruments={piece.instruments.inherited ? [] : piece.instruments.values}
                  userTags={piece.userTags}
                  className="mt-1.5"
                />
              </div>
              <WorkThumbnail piece={piece} className={`h-[42px] w-14 rounded-md ${THUMB_HIDE_CLASS}`} />
            </ClickableCard>
          </PieceContextMenu>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// Split People — reuses the real, shared TagComboBox (sequenceStyle,
// multiple) as its ordered replacement-picker, wired to POST
// /api/people/{id}/split.
// ---------------------------------------------------------------------

function SplitPeopleModal({
  open,
  onClose,
  person,
  otherPeople,
  workCount,
  onConfirm,
  isSubmitting,
}: {
  open: boolean
  onClose: () => void
  person: Person
  otherPeople: Tag[]
  workCount: number
  onConfirm: (names: string[]) => void
  isSubmitting: boolean
}) {
  const [replacements, setReplacements] = useState<Tag[]>([])

  function handleClose() {
    setReplacements([])
    onClose()
  }
  function handleConfirm() {
    onConfirm(replacements.map((r) => r.name))
  }

  const names = replacements.map((r) => r.name)
  const previewLine =
    names.length === 0
      ? null
      : names.length === 1
        ? `This will rename "${person.name}" to "${names[0]}" — every work and book credit stays exactly where it is.`
        : `This will split "${person.name}"'s ${workCount} credits among ${joinNames(names)}, in that order.`

  return (
    <Modal
      open={open}
      onClose={handleClose}
      labelledBy="split-people-title"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent disabled:cursor-default disabled:opacity-45"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={replacements.length === 0 || isSubmitting}
            className="cursor-pointer rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? 'Splitting…' : 'Split Person'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <h2 id="split-people-title" className="font-display text-2xl font-medium text-ink">
            Split "{person.name}"
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            Reassign every one of this person's current piece and book credits to one or more replacement
            people, in order. "{person.name}" isn't deleted — they're just left with zero credits
            afterward.
          </p>
        </div>

        <TagComboBox
          label="Replace with"
          options={otherPeople}
          selected={replacements}
          multiple
          sequenceStyle
          newOptionLabel="New person"
          onChange={setReplacements}
        />

        {previewLine && (
          <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-3 py-2 text-sm text-ink-soft">
            {previewLine}
          </div>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------

export function PersonDetailsPage() {
  const { id } = useParams<{ id: string }>()
  const personId = Number(id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [workViewMode, setWorkViewMode] = useState<'grid' | 'list'>('list')
  const [editOpen, setEditOpen] = useState(false)
  const [splitOpen, setSplitOpen] = useState(false)
  const [uploadPortraitOpen, setUploadPortraitOpen] = useState(false)

  const {
    data: person,
    isLoading: personLoading,
    isError: personIsError,
    error: personError,
  } = useQuery({
    queryKey: ['person', personId],
    queryFn: () => getPerson(personId),
  })

  const { data: works, isLoading: worksLoading } = useQuery({
    queryKey: ['pieces', { personId }],
    queryFn: () => searchPieces({ personId }),
    enabled: !!person,
  })

  const { data: bookCredits } = useQuery({
    queryKey: ['books', { personId }],
    queryFn: () => listBooks({ personId }),
    enabled: !!person,
  })

  // Split People's replacement picker — every other real person in the
  // catalog, same GET /api/people source EditPieceModal.tsx/
  // EditBookModal.tsx's own composer/arranger TagComboBox fields use
  // (Stage C), reused unpaginated.
  const { data: allPeople = [] } = useQuery({
    queryKey: ['people', {}],
    queryFn: () => listPeople(),
    enabled: splitOpen,
  })
  const otherPeople: Tag[] = allPeople
    .filter((p) => p.id !== personId)
    .map((p) => ({ id: p.id, name: p.name }))

  // Keyboard shortcut: E opens the edit menu — same convention as
  // PiecePage.tsx's own E/F shortcuts and BookDetailsPage.tsx's own E
  // shortcut (matches the header's "Edit Person" button, just a faster
  // path to it). No favorite-toggle equivalent here since Person has no
  // favorite field, same reasoning Book's own version has none either.
  // Skipped while the modal is already open (its own fields should own
  // keystrokes then) or while focus is in any text-entry element, so
  // typing "e" elsewhere on the page is never intercepted. `repeat` guards
  // against a held-down key re-opening the (already-open, so harmless, but
  // pointless) modal on every repeat tick.
  useEffect(() => {
    if (!person || editOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return
      }
      if (event.key.toLowerCase() === 'e') {
        event.preventDefault()
        setEditOpen(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [person, editOpen])

  const removePortraitMutation = useMutation({
    mutationFn: () => removePersonPortrait(personId),
    onSuccess: (updated) => {
      queryClient.setQueryData(['person', personId], updated)
      queryClient.invalidateQueries({ queryKey: ['people'] })
    },
    onError: (error) => {
      window.alert(error instanceof ApiError ? error.message : 'Could not remove this portrait.')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deletePerson(personId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['people'] })
      queryClient.invalidateQueries({ queryKey: ['pieces'] })
      queryClient.invalidateQueries({ queryKey: ['piece'] })
      queryClient.invalidateQueries({ queryKey: ['books'] })
      navigate('/people')
    },
    onError: (error) => {
      window.alert(error instanceof ApiError ? error.message : 'Could not delete this person.')
    },
  })

  const splitMutation = useMutation({
    mutationFn: (names: string[]) => splitPerson(personId, { replacementNames: names }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['people'] })
      queryClient.invalidateQueries({ queryKey: ['person', personId] })
      queryClient.invalidateQueries({ queryKey: ['pieces'] })
      queryClient.invalidateQueries({ queryKey: ['piece'] })
      queryClient.invalidateQueries({ queryKey: ['books'] })
      setSplitOpen(false)
    },
    onError: (error) => {
      window.alert(error instanceof ApiError ? error.message : 'Could not split this person.')
    },
  })

  function handleDelete() {
    if (person && window.confirm(`Delete "${person.name}"? This can't be undone.`)) {
      deleteMutation.mutate()
    }
  }

  const notFound = personError instanceof ApiError && personError.code === 'NOT_FOUND'
  const sortedWorks = works ? sortWorksByYear(works) : []

  const avatarContextMenuItems = person
    ? [
        { label: 'Change Portrait', onSelect: () => setUploadPortraitOpen(true) },
        ...(person.hasCustomPortrait
          ? [{ label: 'Remove Portrait', onSelect: () => removePortraitMutation.mutate(), destructive: true }]
          : []),
      ]
    : []

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          to="/people"
          className="inline-flex w-fit items-center gap-1.5 text-sm whitespace-nowrap text-ink-soft hover:text-ink"
        >
          <IconArrowLeft size={24} />
          Back to People
        </Link>
        {person && (
          <div className="flex shrink-0 items-stretch gap-2.5">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              aria-label="Delete Person"
              title="Delete Person"
              className="flex w-[38px] cursor-pointer items-center justify-center rounded-md border border-border bg-paper-raised text-red-700 hover:border-red-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border"
            >
              <IconTrash size={16} />
            </button>
            <span aria-hidden="true" className="h-6 w-px self-center bg-border" />
            <button
              type="button"
              onClick={() => setSplitOpen(true)}
              className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-sm whitespace-nowrap text-ink hover:border-accent"
            >
              <IconArrowsSplit2 size={16} />
              <span className="max-[420px]:hidden">Split People</span>
            </button>
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              aria-label="Edit Person"
              className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-sm whitespace-nowrap text-ink hover:border-accent max-[360px]:w-[38px] max-[360px]:px-0"
            >
              <IconEditFilled size={16} />
              <span className="max-[360px]:hidden">Edit Person</span>
            </button>
          </div>
        )}
      </div>

      {personLoading && <p className="text-ink-soft">Loading…</p>}

      {personIsError && notFound && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <h1 className="font-display text-3xl font-medium text-ink">Person not found</h1>
          <p className="text-ink-soft">They may have been deleted.</p>
        </div>
      )}

      {personIsError && !notFound && (
        <p className="text-ink-soft">
          {personError instanceof ApiError ? personError.message : 'Could not load this person.'}
        </p>
      )}

      {person && (
        <>
          <div className="overflow-hidden rounded-2xl border border-border bg-paper-raised shadow-sm">
            <div className="flex items-start gap-6 p-7">
              {/* Camera badge is the only visible edit trigger on the
                  portrait itself — no separate always-visible toolbar
                  button, mirroring Book Details' own "no redundant
                  triggers" cover treatment. Right-click/long-press still
                  works too, same ContextMenu component Book Details uses
                  for its own cover image. */}
              <ContextMenu items={avatarContextMenuItems} hideTriggerButton>
                <div className="relative w-[150px] shrink-0">
                  <PersonAvatar person={person} className="w-full shadow-sm" />
                  <button
                    type="button"
                    onClick={() => setUploadPortraitOpen(true)}
                    aria-label="Change portrait"
                    title="Change portrait"
                    className="absolute right-1.5 bottom-1.5 flex size-8 cursor-pointer items-center justify-center rounded-full border-2 border-paper-raised bg-ink text-paper shadow-md hover:bg-ink/85"
                  >
                    <IconCameraFilled size={14} />
                  </button>
                </div>
              </ContextMenu>

              <div className="min-w-0 flex-1">
                <div className="mb-2">
                  <h1 className="font-display text-[1.35rem] font-medium text-ink">{person.name}</h1>
                  {formatLifespan(person) && (
                    <p className="text-[0.92rem] text-ink-soft">{formatLifespan(person)}</p>
                  )}
                </div>

                {person.bio && (
                  <div className="max-w-[60ch] text-[0.88rem] text-ink-soft">
                    <MarkdownText>{person.bio}</MarkdownText>
                  </div>
                )}

                {bookCredits && bookCredits.length > 0 && (
                  <div className="mt-3.5">
                    <dt className="mb-1.5 text-[0.7rem] tracking-wide text-ink-soft uppercase">
                      Also credited directly on {bookCredits.length}{' '}
                      {bookCredits.length === 1 ? 'book' : 'books'}
                    </dt>
                    <dd className="flex flex-wrap gap-2">
                      {bookCredits.map((book, index) => (
                        <Link
                          key={book.id}
                          to={`/books/${book.id}`}
                          className="flex items-center gap-2 rounded-full border border-border bg-paper-sunken py-[7px] pr-4 pl-[9px] text-xs text-ink hover:border-accent"
                        >
                          <span
                            className="flex size-5 shrink-0 items-center justify-center rounded-full text-white"
                            style={{ backgroundColor: PALETTE[index % PALETTE.length] }}
                          >
                            <IconMusic size={10} />
                          </span>
                          <span className="font-medium">{book.bookTitle}</span>
                          <span className="text-ink-soft">
                            as {book.composer.some((p) => p.id === personId) ? 'Composer' : 'Arranger'}
                          </span>
                        </Link>
                      ))}
                    </dd>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-paper">
            <div className="flex flex-wrap items-center justify-between gap-4 px-6 pb-4">
              <h2 className="font-display text-[0.95rem] font-semibold text-ink-soft">
                {works ? `${works.length} ${works.length === 1 ? 'work' : 'works'}` : '…'}
              </h2>
              <div className="flex shrink-0 items-center gap-1 rounded-md border border-border p-0.5">
                <button
                  type="button"
                  onClick={() => setWorkViewMode('grid')}
                  aria-label="Grid view"
                  aria-pressed={workViewMode === 'grid'}
                  className={`flex size-8 cursor-pointer items-center justify-center rounded ${
                    workViewMode === 'grid' ? 'bg-accent-soft text-accent' : 'text-ink-soft'
                  }`}
                >
                  <IconLayoutGridFilled size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setWorkViewMode('list')}
                  aria-label="List view"
                  aria-pressed={workViewMode === 'list'}
                  className={`flex size-8 cursor-pointer items-center justify-center rounded ${
                    workViewMode === 'list' ? 'bg-accent-soft text-accent' : 'text-ink-soft'
                  }`}
                >
                  <IconLayoutListFilled size={16} />
                </button>
              </div>
            </div>
            <div className="px-6 pb-5">
              {worksLoading && <p className="text-ink-soft">Loading…</p>}
              {works && works.length === 0 && (
                <div className="py-6 text-center">
                  <p className="font-display text-ink">No works yet</p>
                  <p className="mt-1 text-sm text-ink-soft">
                    Pieces and books crediting this person will appear here.
                  </p>
                </div>
              )}
              {works &&
                works.length > 0 &&
                (workViewMode === 'grid' ? (
                  <WorkGrid pieces={sortedWorks} personId={personId} />
                ) : (
                  <WorkList pieces={sortedWorks} personId={personId} />
                ))}
            </div>
          </div>

          <EditPersonModal person={person} open={editOpen} onClose={() => setEditOpen(false)} />
          <UploadPortraitModal
            open={uploadPortraitOpen}
            onClose={() => setUploadPortraitOpen(false)}
            personId={person.id}
          />
          <SplitPeopleModal
            open={splitOpen}
            onClose={() => setSplitOpen(false)}
            person={person}
            otherPeople={otherPeople}
            workCount={(works?.length ?? 0) + (bookCredits?.length ?? 0)}
            onConfirm={(names) => splitMutation.mutate(names)}
            isSubmitting={splitMutation.isPending}
          />
        </>
      )}
    </div>
  )
}
