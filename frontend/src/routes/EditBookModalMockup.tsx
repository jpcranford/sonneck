import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { IconCheck, IconXFilled } from '@tabler/icons-react'
import type { Tag } from '../api/types'
import { Modal } from '../components/Modal'
import { TagComboBox } from '../components/TagComboBox'
import { SingleSelect } from '../components/SingleSelect'
import { useMockupTitle } from '../lib/useMockupTitle'

// ---------------------------------------------------------------------
// DESIGN MOCKUP — Book Properties Edit Menu (design doc §16). Not wired
// to the API (Save just runs the animation below against fixed mock
// data). Body layout: two columns, Book Title full-width above. Footer:
// the Save button itself carries the moving-stripe progress state rather
// than a separate progress indicator. Publisher/Publisher ID share one
// row, and every multi-field row collapses to single-column below `sm`
// with nothing clipping.
// Reuses the real Modal/TagComboBox/SingleSelect components (unlike the
// older EditPieceModalMockup.tsx, which predates those being extracted as
// standalone components and so reimplements its own local versions) —
// these are now stable, real UI primitives, not page-specific logic, so
// there's nothing left to gain by duplicating them again here.
// ---------------------------------------------------------------------

const SHEET_TYPE_OPTIONS: Tag[] = [
  { id: 1, name: 'Lead Sheet' },
  { id: 2, name: 'Solo Piece' },
  { id: 3, name: 'Ensemble Piece – Full Score' },
  { id: 5, name: 'Ensemble Piece – Part' },
  { id: 4, name: 'PVG Score' },
]
const SHEET_TYPE_SELECT_OPTIONS = [
  { value: '', label: '—' },
  ...SHEET_TYPE_OPTIONS.map((o) => ({ value: o.name, label: o.name })),
]
const INSTRUMENT_OPTIONS: Tag[] = [
  { id: 1, name: 'Piano' },
  { id: 2, name: 'Organ' },
  { id: 3, name: 'Guitar' },
  { id: 4, name: 'Voice' },
]

const MOCK_BOOK_TITLE = 'Album for the Young'
const MOCK_PIECE_COUNT = 6

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

const defaultValues: FormValues = {
  bookTitle: MOCK_BOOK_TITLE,
  composer: 'Robert Schumann',
  // Blank by default — Composer alone already satisfies the composer-or-
  // arranger requirement (ValidateBook) for this fixture, same as it does
  // for most pieces throughout the other mockups' own fixtures.
  arranger: '',
  yearWritten: '1848',
  workOpusNumber: 'Op. 68',
  instruments: [{ id: 1, name: 'Piano' }],
  sheetType: 'Solo Piece',
  publisher: 'G. Schirmer',
  publisherId: 'HL50253670',
  // Digits only, no hyphens — matches how it's actually stored
  // (models.Book.ISBN), same convention imslpNumber already follows.
  isbn: '9780132350884',
  imslpNumber: 'IMSLP04154',
  description: "Schumann's collection of 43 short pieces for young pianists, composed for his own children.",
}

type SaveState = 'idle' | 'saving' | 'saved'
// Timings match the approved "Book Save Animation" artifact exactly —
// long enough that the stripe motion and the "Saved" checkmark are both
// clearly visible, not just a flash.
const SAVING_MS = 1400
const SAVED_MS = 1100

export function EditBookModalMockup() {
  useMockupTitle('Edit Book Modal')

  const [open, setOpen] = useState(true)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const { register, control, handleSubmit, formState: { errors } } = useForm<FormValues>({ defaultValues })

  // No real PATCH here (mockup) — just runs the same perceived-progress
  // sequence the real Save button will: idle -> saving -> saved -> idle.
  // The backend call this stands in for is a single fast synchronous
  // transaction (PATCH /api/books/{id} already resyncs pieces_fts inside
  // it), so there's no real percentage to report — this is deliberately
  // indeterminate, not a fake 0-100% fill.
  function onSubmit() {
    if (saveState !== 'idle') return
    setSaveState('saving')
    setTimeout(() => setSaveState('saved'), SAVING_MS)
    setTimeout(() => setSaveState('idle'), SAVING_MS + SAVED_MS)
  }

  // Shift+Enter saves from anywhere in the form — kept in sync with the
  // real EditBookModal.tsx; see that file's own comment.
  function handleFormKeyDown(event: ReactKeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault()
      handleSubmit(onSubmit)()
    }
  }

  const saving = saveState !== 'idle'

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6 md:p-8">
      <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
        Design mockup — <span className="font-medium text-ink">Book Properties Edit Menu</span> (design doc
        §16). Not wired to real data — Save just replays the approved progress animation.
      </div>

      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-fit rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
        >
          Reopen mockup
        </button>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        labelledBy="edit-book-mockup-title"
        size="xl"
        header={
          // -mx-6/px-6 bleeds the line to the dialog's true edges rather
          // than stopping at the header's own content width — same
          // full-bleed convention as EditPieceModal's own pinned-header
          // divider (its page-preview toggle section), plain 1px, no
          // scrim: this app already draws the fixed/scrolling boundary
          // with a simple border in two places (that divider, and every
          // Modal's own footer border-t), so a line here matches existing
          // language instead of introducing a second pattern.
          <div className="-mx-6 flex items-start justify-between gap-4 border-b border-border px-6 pb-4">
            <div>
              <h2 id="edit-book-mockup-title" className="font-display text-2xl font-medium text-ink">
                Edit book
              </h2>
              <p className="text-sm text-ink-soft">{MOCK_BOOK_TITLE}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="mt-1 shrink-0 text-ink-soft hover:text-accent"
            >
              <IconXFilled size={22} />
            </button>
          </div>
        }
        footer={
          <div className="flex flex-col gap-2">
            <p
              className={`text-right text-xs text-ink-soft transition-opacity ${saving ? 'opacity-0' : 'opacity-100'}`}
            >
              Saving will update {MOCK_PIECE_COUNT} pieces
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={saving}
                className="rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent disabled:cursor-default disabled:opacity-45"
              >
                Cancel
              </button>
              {/* Save carries the progress state itself (locked "A" footer).
                  min-w, not a fixed width — "Updating N pieces…" is longer
                  than "Save"/"Saved", and should push the button wider to
                  stay on one line rather than wrap and grow taller instead
                  (whitespace-nowrap is what actually prevents the wrap;
                  min-w just keeps the idle state from looking undersized)
                  — same pattern as UploadBookConfirmMockup.tsx's own
                  stripe-animated Import button, ported here since this
                  button had the same bug. */}
              <button
                type="submit"
                form="edit-book-form"
                disabled={saving}
                className="relative flex min-w-[190px] shrink-0 items-center justify-center overflow-hidden rounded-md bg-accent px-4 py-2 font-display whitespace-nowrap text-white disabled:cursor-default"
              >
                {saveState === 'saving' && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 animate-stripe-move bg-[length:56px_56px] [background-image:repeating-linear-gradient(45deg,rgba(255,255,255,0.3)_0,rgba(255,255,255,0.3)_10px,transparent_10px,transparent_20px)] motion-reduce:animate-none motion-reduce:opacity-60"
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  {saveState === 'idle' && 'Save'}
                  {saveState === 'saving' && `Updating ${MOCK_PIECE_COUNT} pieces…`}
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
        <form
          id="edit-book-form"
          onSubmit={handleSubmit(onSubmit)}
          onKeyDown={handleFormKeyDown}
          className="flex flex-col gap-4"
        >
          {/* Book title stands alone, full width — not paired with
              Composer. Field order: Title / Composer-Arranger / Year-Opus /
              Publisher-PublisherID / ISBN-IMSLP /
              Sheet+Instruments-Description. Every paired row below
              collapses to stacked single fields below ~525px. */}
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
              {/* No persistent "one of these three required" hint here —
                  see EditBookModal.tsx's own comment: this is a
                  backend-enforced cross-field rule, surfaced via the
                  footer's error banner on a failed save rather than an
                  always-on label hint. */}
              <label htmlFor="f-composer" className="text-sm text-ink-soft">
                Composer
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
            {/* flex-1, same as every other paired-row's second field —
                not the Piece edit menu's narrower fixed-width treatment.
                With four double-field rows stacked in a column, their
                split points need to line up with each other; a
                one-off-narrower Publisher ID would put its divider in a
                different place than every other row's. */}
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

          {/* ISBN/IMSLP number — paired together, same split-row treatment
              as every row above it. */}
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
              left, Description spanning the same height on the right —
              the one genuinely tall field gets the one genuinely tall
              column. gap-3 here too (was gap-5) — with flex-1 on both
              sides the right edge always reaches the dialog's padding
              regardless of gap size, so the visible bug wasn't
              misalignment at the edge, it was the *gutter itself*: 20px
              between these two columns vs. 12px in every double-field row
              above, measured directly (Description's left edge sat 4px
              further right, its column 4px narrower, than Composer/Opus/
              Publisher ID's). Same fix category as the earlier Publisher
              ID split-point request — one consistent gutter width for
              every multi-column row, not just the split *position*. */}
          <div className="flex flex-col gap-3 min-[525px]:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <Controller
                name="sheetType"
                control={control}
                render={({ field }) => (
                  <SingleSelect
                    label="Sheet type"
                    options={SHEET_TYPE_SELECT_OPTIONS}
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
                    options={INSTRUMENT_OPTIONS}
                    selected={field.value}
                    multiple
                    onChange={field.onChange}
                  />
                )}
              />
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
              <label htmlFor="f-description" className="text-sm text-ink-soft">
                Description <span className="text-ink-soft/60 italic">(Markdown supported)</span>
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
    </div>
  )
}
