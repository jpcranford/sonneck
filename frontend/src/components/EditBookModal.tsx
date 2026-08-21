import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IconAlertTriangle, IconCheck, IconXFilled } from '@tabler/icons-react'
import { updateBook } from '../api/books'
import { listInstruments, listSheetTypes } from '../api/lookups'
import { ApiError } from '../api/client'
import type { Book, BookWriteRequest, Tag } from '../api/types'
import { Modal } from './Modal'
import { TagComboBox } from './TagComboBox'
import { SingleSelect } from './SingleSelect'

// The real Book Properties Edit Menu (design doc §16). Every layout/
// behavior decision here mirrors the locked mockup (EditBookModalMockup.tsx,
// /mockup/edit-book-modal, left intact as a standing reference) deliberately
// — if the two ever look different, that's either a bug or a change that
// needs porting to both, not a sign this file is free to diverge. Reached
// from Book View's header pencil (BookDetailsPage.tsx) and Piece View's
// Source Book card pencil (PiecePage.tsx), both previously inert.
//
// No book-inheritance UI here, unlike EditPieceModal — Book is the
// inheritance *source* for pieces (CLAUDE.md > Book-level soft
// inheritance), not a consumer of it, so there's nothing to resolve/copy
// against here the way there is on the piece side.

interface EditBookModalProps {
  book: Book
  open: boolean
  onClose: () => void
}

interface FormValues {
  bookTitle: string
  composer: string
  arranger: string
  yearWritten: string
  workOpusNumber: string
  instruments: Tag[]
  sheetType: string
  publisher: string
  publisherId: string
  isbn: string
  imslpNumber: string
  description: string
}

function bookToFormValues(book: Book): FormValues {
  return {
    bookTitle: book.bookTitle,
    composer: book.composer ?? '',
    arranger: book.arranger ?? '',
    yearWritten: book.yearWritten ?? '',
    workOpusNumber: book.workOpusNumber ?? '',
    instruments: book.instruments,
    sheetType: book.sheetType?.name ?? '',
    publisher: book.publisher ?? '',
    publisherId: book.publisherId ?? '',
    isbn: book.isbn ?? '',
    imslpNumber: book.imslpNumber ?? '',
    description: book.description ?? '',
  }
}

// Strips a leading "IMSLP" label (with or without a following
// space/colon/hash/dash, any case) before the value is ever sent to the
// backend — same rule and same independently-implemented copy as
// EditPieceModal.tsx's own stripImslpPrefix (not shared code across the
// Go/TS boundary, per that file's own comment): the citation adds its own
// "IMSLP #" label (buildCitation, internal/handlers/citation.go), so a
// value typed in as "IMSLP04154" would otherwise render doubled ("IMSLP
// #IMSLP04154"). Only strips an actual prefix match; a value with no
// "IMSLP" text is returned as-is.
function stripImslpPrefix(value: string): string {
  return value.replace(/^\s*imslp[\s:#-]*/i, '')
}

// Book has no inheritance to preserve (unlike PieceWriteRequest, which
// blanks inherited fields so a full-replace write can't accidentally
// convert an inherited value into a permanent override) — every field here
// is the book's own, so this is a plain, direct mapping. isbn isn't
// stripped/normalized client-side the way imslpNumber is above — unlike
// imslpNumber, isbn is already normalized server-side on every write
// (handleUpdateBook's normalizeISBN), so there's nothing left for the
// client to do.
function formValuesToWriteRequest(data: FormValues): BookWriteRequest {
  return {
    bookTitle: data.bookTitle,
    composer: data.composer || null,
    arranger: data.arranger || null,
    yearWritten: data.yearWritten || null,
    workOpusNumber: data.workOpusNumber || null,
    sheetTypeName: data.sheetType || null,
    publisher: data.publisher || null,
    publisherId: data.publisherId || null,
    description: data.description || null,
    imslpNumber: stripImslpPrefix(data.imslpNumber) || null,
    isbn: data.isbn || null,
    instruments: data.instruments.map((i) => i.name),
  }
}

type SaveState = 'idle' | 'saving' | 'saved'
// How long the "Saved" checkmark stays up before the modal actually
// closes — the "saving" phase itself isn't on a timer (unlike the
// mockup's demo timings): it tracks the real PATCH request, which the
// design doc calls out as a single fast synchronous transaction (it
// already resyncs pieces_fts inside it), so this is the only fixed delay
// left — just enough that the confirmation is actually seen, not a flash.
const SAVED_DISPLAY_MS = 900

export function EditBookModal({ book, open, onClose }: EditBookModalProps) {
  const queryClient = useQueryClient()
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: bookToFormValues(book) })

  useEffect(() => {
    if (open) {
      reset(bookToFormValues(book))
      // Guards a narrow but real edge case: closing the modal (Cancel/
      // Escape/backdrop) while a save is genuinely in flight leaves
      // saveState at 'saving', and this component stays mounted across
      // that close (book && <EditBookModal .../> is always rendered once
      // book data loads, same as EditPieceModal's own usage) — without
      // this, reopening before that earlier request resolves would show a
      // stale "Updating…" animation for a session that hasn't submitted
      // anything yet.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: see comment above; same justification/precedent as Modal.tsx's own use of this disable.
      setSaveState('idle')
    }
  }, [open, book, reset])

  const { data: sheetTypeOptions = [] } = useQuery({
    queryKey: ['sheetTypes'],
    queryFn: listSheetTypes,
  })
  const { data: instrumentOptions = [] } = useQuery({
    queryKey: ['instruments'],
    queryFn: listInstruments,
  })
  const sheetTypeSelectOptions = [
    { value: '', label: '—' },
    ...sheetTypeOptions.map((o) => ({ value: o.name, label: o.name })),
  ]

  const saveMutation = useMutation({
    mutationFn: (data: FormValues) => updateBook(book.id, formValuesToWriteRequest(data)),
    onSuccess: () => {
      // Broad invalidation, not just this book's own query — every piece
      // with this sourceBookId (an unknown set from here) may have just
      // had its *effective* composer/publisher/etc. change (CLAUDE.md >
      // Book-level soft inheritance), and any currently-mounted individual
      // ['piece', id] query needs to pick that up too, not just piece
      // list/search views.
      queryClient.invalidateQueries({ queryKey: ['books'] })
      queryClient.invalidateQueries({ queryKey: ['book'] })
      queryClient.invalidateQueries({ queryKey: ['pieces'] })
      queryClient.invalidateQueries({ queryKey: ['piece'] })
      setSaveState('saved')
      setTimeout(() => {
        setSaveState('idle')
        onClose()
      }, SAVED_DISPLAY_MS)
    },
    onError: () => setSaveState('idle'),
  })

  function onSubmit(data: FormValues) {
    setSaveState('saving')
    saveMutation.mutate(data)
  }

  const saving = saveState !== 'idle'

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="edit-book-title"
      size="xl"
      header={
        // -mx-6/px-6 bleeds the line to the dialog's true edges — same
        // full-bleed convention as EditPieceModal's own pinned-header
        // divider (its page-preview toggle section), plain 1px, no scrim:
        // this app already draws the fixed/scrolling boundary with a
        // simple border in two places (that divider, and every Modal's
        // own footer border-t), so a line here matches existing language.
        <div className="-mx-6 flex items-start justify-between gap-4 border-b border-border px-6 pb-4">
          <div>
            <h2 id="edit-book-title" className="font-display text-2xl font-medium text-ink">
              Edit book
            </h2>
            <p className="text-sm text-ink-soft">{book.bookTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mt-1 shrink-0 text-ink-soft hover:text-accent"
          >
            <IconXFilled size={22} />
          </button>
        </div>
      }
      footer={
        <div className="flex flex-col gap-2">
          {saveMutation.isError && (
            <p className="flex items-center gap-2 text-sm text-red-700">
              <IconAlertTriangle size={16} />
              {saveMutation.error instanceof ApiError
                ? saveMutation.error.message
                : 'Could not save. Please try again.'}
            </p>
          )}
          {book.pieceCount > 0 && (
            <p
              className={`text-right text-xs text-ink-soft transition-opacity ${saving ? 'opacity-0' : 'opacity-100'}`}
            >
              Saving will update {book.pieceCount} {book.pieceCount === 1 ? 'piece' : 'pieces'}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent disabled:cursor-default disabled:opacity-45"
            >
              Cancel
            </button>
            {/* Save carries the progress state itself (locked "A" footer,
                approved via the "Book Save Animation" artifact) — fixed
                width so the button doesn't change size as its label goes
                Save -> "Updating N pieces…" -> Saved. */}
            <button
              type="submit"
              form="edit-book-form"
              disabled={saving}
              className="relative flex w-[190px] shrink-0 items-center justify-center overflow-hidden rounded-md bg-accent px-4 py-2 font-display text-white disabled:cursor-default"
            >
              {saveState === 'saving' && (
                <span
                  aria-hidden="true"
                  className="absolute inset-0 animate-stripe-move bg-[length:56px_56px] [background-image:repeating-linear-gradient(45deg,rgba(255,255,255,0.3)_0,rgba(255,255,255,0.3)_10px,transparent_10px,transparent_20px)] motion-reduce:animate-none motion-reduce:opacity-60"
                />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                {saveState === 'idle' && 'Save'}
                {saveState === 'saving' &&
                  (book.pieceCount > 0 ? `Updating ${book.pieceCount} pieces…` : 'Saving…')}
                {saveState === 'saved' && (
                  <>
                    <IconCheck size={15} />
                    Saved
                  </>
                )}
              </span>
            </button>
          </div>
        </div>
      }
    >
      <form id="edit-book-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        {/* Book title stands alone, full width — no longer paired with
            Composer (2026-08-20, direct instruction: reordered to Title /
            Composer-Arranger / Year-Opus / Publisher-PublisherID /
            ISBN-IMSLP / Sheet+Instruments-Description). Every paired row
            below still collapses to stacked single fields below ~525px.
            Locked design, see the mockup's own file comment for the
            design-review provenance. */}
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="f-book-title" className="text-sm text-ink-soft">
            Book title <span className="text-ink-soft/60 italic">(Required)</span>
          </label>
          <input
            id="f-book-title"
            className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
            {...register('bookTitle', { required: 'Book title is required.', maxLength: 255 })}
          />
          {errors.bookTitle && <p className="text-sm text-red-700">{errors.bookTitle.message}</p>}
        </div>

        <div className="flex flex-col gap-3 min-[525px]:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="f-composer" className="text-sm text-ink-soft">
              Composer <span className="text-ink-soft/60 italic">(Composer or Arranger required)</span>
            </label>
            <input
              id="f-composer"
              className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('composer', { maxLength: 255 })}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="f-arranger" className="text-sm text-ink-soft">
              Arranger
            </label>
            <input
              id="f-arranger"
              className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('arranger', { maxLength: 255 })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 min-[525px]:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="f-year" className="text-sm text-ink-soft">
              Year written
            </label>
            <input
              id="f-year"
              className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('yearWritten', { maxLength: 255 })}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="f-opus" className="text-sm text-ink-soft">
              Work/opus number
            </label>
            <input
              id="f-opus"
              className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('workOpusNumber', { maxLength: 255 })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 min-[525px]:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="f-publisher" className="text-sm text-ink-soft">
              Publisher
            </label>
            <input
              id="f-publisher"
              className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('publisher', { maxLength: 255 })}
            />
          </div>
          {/* flex-1, same as every other paired-row's second field — not
              the Piece edit menu's narrower fixed-width treatment. With
              four double-field rows stacked in a column, their split
              points need to line up with each other; a one-off-narrower
              Publisher ID would put its divider in a different place than
              every other row's. */}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="f-publisher-id" className="text-sm text-ink-soft">
              Publisher ID
            </label>
            <input
              id="f-publisher-id"
              className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('publisherId', { maxLength: 255 })}
            />
          </div>
        </div>

        {/* ISBN/IMSLP number — moved IMSLP out of the closing stacked
            column below (2026-08-20, direct instruction) and paired it
            with the new ISBN field instead, same split-row treatment as
            every row above it. */}
        <div className="flex flex-col gap-3 min-[525px]:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="f-isbn" className="text-sm text-ink-soft">
              ISBN number
            </label>
            <input
              id="f-isbn"
              className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('isbn', { maxLength: 255 })}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="f-imslp" className="text-sm text-ink-soft">
              IMSLP number
            </label>
            <input
              id="f-imslp"
              className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('imslpNumber', { maxLength: 255 })}
            />
          </div>
        </div>

        {/* Closing two-column row: Sheet Type/Instruments stacked on the
            left, Description spanning the same height on the right — the
            one genuinely tall field gets the one genuinely tall column.
            gap-3 here too (not gap-5) — every multi-column row in this
            form uses the same gutter width, a direct fix from design
            review (a 20px gutter here against 12px everywhere else
            visibly narrowed this column against its neighbors). */}
        <div className="flex flex-col gap-3 min-[525px]:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <Controller
              name="sheetType"
              control={control}
              render={({ field }) => (
                <SingleSelect
                  label="Sheet type"
                  options={sheetTypeSelectOptions}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            <Controller
              name="instruments"
              control={control}
              render={({ field }) => (
                <TagComboBox
                  label="Instruments"
                  options={instrumentOptions}
                  selected={field.value}
                  multiple
                  onChange={field.onChange}
                />
              )}
            />
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="f-description" className="text-sm text-ink-soft">
              Description
            </label>
            <textarea
              id="f-description"
              rows={4}
              // resize-none — the drag handle had no real effect anyway:
              // flex-1/min-h-0 on this column drive the textarea's actual
              // height, so a manual resize either got fought back to the
              // flex-derived height or fought the layout around it.
              className="min-h-[96px] flex-1 resize-none rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('description')}
            />
          </div>
        </div>
      </form>
    </Modal>
  )
}
