import { useEffect, useState, type FocusEvent } from 'react'
import { useForm } from 'react-hook-form'
import { IconAlertTriangle, IconArrowLeft, IconArrowRight, IconX } from '@tabler/icons-react'
import { getBookPageThumbnailUrl } from '../api/books'
import { PageLightbox } from '../components/PageLightbox'
import type { Piece } from '../lib/pieceSplitLogic'
import { TOTAL_WIZARD_STEPS } from './BookUploadWizard'

// Book Upload Wizard, Screen 5 of 6: "Name each piece" (design doc §5's
// "fill fields" step). Real build of UploadBookTitlesMockup.tsx
// (/mockup/upload-book-titles, kept as a standing design reference) —
// same layout/validation/preview behavior, operating on the real pieces
// computed by the Split step instead of a fixed fixture.
//
// Composer always shows; Arranger shows only when the book itself doesn't
// already have one of its own (book-level soft inheritance otherwise
// covers it). Neither is actually required unless the book supplies
// neither composer nor arranger — see requireComposerOrArranger below.
// Uses the shared PageLightbox (components/PageLightbox.tsx) for the tap-
// to-preview overlay, cycling between pieces rather than pages within one
// piece — this screen only ever shows a piece's own start page.

const CURRENT_STEP = 5
const DESKTOP_BREAKPOINT_PX = 768

function formatPieceLabel(piece: Piece) {
  return `pp ${piece.start}${piece.end !== piece.start ? `–${piece.end}` : ''}`
}

interface FormValues {
  pieces: { title: string; composer: string; arranger: string }[]
}

// Same real-conditional-render fix as the mockup — see that file's own
// comment for the react-hook-form duplicate-registration bug this avoids
// (both layouts staying mounted under CSS `hidden` share input names, so
// RHF only tracks one of the two identically-named refs per field).
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= DESKTOP_BREAKPOINT_PX,
  )
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT_PX}px)`)
    const onChange = () => setIsDesktop(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return isDesktop
}

interface BookUploadTitlesStepProps {
  bookId: number
  bookComposer: string | null
  bookArranger: string | null
  pieces: Piece[]
  pieceFields: { title: string; composer: string; arranger: string }[]
  onChange: (fields: { title: string; composer: string; arranger: string }[]) => void
  onBack: () => void
  onNext: () => void
  onCancel: () => void
  cancelPending: boolean
}

export function BookUploadTitlesStep({
  bookId,
  bookComposer,
  bookArranger,
  pieces,
  pieceFields,
  onChange,
  onBack,
  onNext,
  onCancel,
  cancelPending,
}: BookUploadTitlesStepProps) {
  const isDesktop = useIsDesktop()
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const {
    register,
    handleSubmit,
    getValues,
    trigger,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: { pieces: pieceFields } })

  const bookHasArranger = !!bookArranger
  const showArrangerField = !bookHasArranger
  // Neither field is actually required unless the book supplies neither
  // composer nor arranger of its own — whichever one it does have already
  // satisfies the backend's composer-or-arranger rule via inheritance
  // regardless of what (if anything) gets typed on this screen.
  const requireComposerOrArranger = !bookComposer && !bookArranger
  const desktopGridCols = showArrangerField
    ? 'grid-cols-[128px_88px_1fr_1fr_1fr]'
    : 'grid-cols-[128px_88px_1fr_1fr]'

  function onSubmit(data: FormValues) {
    onChange(data.pieces)
    onNext()
  }

  // Composer and Arranger validate each other: either one being non-blank
  // satisfies both — but only when requireComposerOrArranger is true in
  // the first place. When Arranger is hidden (showArrangerField false),
  // requireComposerOrArranger is always false too — the book's own
  // arranger already satisfies the requirement via inheritance — so this
  // never blocks submission on a field the user can no longer even see.
  // Wraps register's own onBlur to also re-trigger the sibling field's
  // validation, so blurring Arranger after typing into it clears a
  // Composer error that was showing (not just the reverse) — RHF's own
  // validate function reads the sibling's current value fine on its own,
  // but doesn't know to *re-run* the sibling's validation when a
  // different field changes without this nudge.
  function composerOrArrangerField(field: 'composer' | 'arranger', index: number) {
    const other = field === 'composer' ? 'arranger' : 'composer'
    const registered = register(`pieces.${index}.${field}`, {
      maxLength: 255,
      validate: (value) =>
        !requireComposerOrArranger ||
        !!value.trim() ||
        !!getValues(`pieces.${index}.${other}`).trim() ||
        'Composer or arranger required',
    })
    return {
      ...registered,
      onBlur: (event: FocusEvent<HTMLInputElement>) => {
        registered.onBlur(event)
        void trigger(`pieces.${index}.${other}`)
      },
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6 md:p-8">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-base text-ink-soft hover:text-ink"
        >
          <IconArrowLeft size={24} />
          Back
        </button>
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-xs text-ink-soft">
            Step {CURRENT_STEP} of {TOTAL_WIZARD_STEPS}
          </span>
          <div className="flex gap-1.5">
            {Array.from({ length: TOTAL_WIZARD_STEPS }, (_, i) => i + 1).map((step) => (
              <span
                key={step}
                className={`h-1 w-5 rounded-full ${
                  step < CURRENT_STEP
                    ? 'bg-accent-on-dark'
                    : step === CURRENT_STEP
                      ? 'bg-accent'
                      : 'bg-border'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      <div>
        <h1 className="font-display text-2xl font-medium text-ink">Name each piece</h1>
        <p className="text-sm text-ink-soft">
          Tap a thumbnail to see the page larger.{' '}
          {bookHasArranger &&
            `This book already credits arranger ${bookArranger}, so there's no per-piece Arranger field below — set a Composer per piece if you'd like one on record.`}
          {requireComposerOrArranger &&
            ' This book has no composer or arranger set, so enter at least one of the two for each piece below.'}
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)}>
        {isDesktop && (
          <div>
            <div className={`grid ${desktopGridCols} gap-2.5 px-3 pb-1.5`}>
              <span />
              <span />
              <span className="text-xs font-semibold text-ink-soft">Title *</span>
              <span className="text-xs font-semibold text-ink-soft">Composer</span>
              {showArrangerField && (
                <span className="text-xs font-semibold text-ink-soft">Arranger</span>
              )}
            </div>
            <div className="flex flex-col border-t border-border">
              {pieces.map((piece, index) => {
                const titleError = errors.pieces?.[index]?.title
                const composerError = errors.pieces?.[index]?.composer
                const arrangerError = errors.pieces?.[index]?.arranger
                return (
                  <div
                    key={index}
                    className={`grid ${desktopGridCols} items-center gap-2.5 px-3 py-1.5 ${
                      index % 2 === 0 ? 'bg-paper-sunken' : ''
                    }`}
                  >
                    <span className="text-sm text-ink-soft">
                      Piece {index + 1} • {formatPieceLabel(piece)}
                    </span>
                    {/* Desktop-only hover popover, on top of the existing
                        tap-to-open overlay rather than replacing it — a
                        mouse is
                        guaranteed on desktop, so a hover preview doesn't
                        run into the "no hover-dependent interactions"
                        device-aware rule (CLAUDE.md): that rule exists for
                        touch parity, and touch users already have the
                        tap-to-open overlay below as their equivalent path.
                        CSS-only via group/group-hover — no state needed
                        for a purely transient, no-persistence preview. */}
                    <div className="group relative">
                      {/* Masked to the same aspect-[180/132] top-of-page
                          crop the Piece Library grid cards use
                          (PieceGridCard.tsx) — same treatment as the
                          mobile thumb below, just a different fixed width
                          (88px column here vs. mobile's own 115px). The
                          per-piece color border stays: it's this wizard's
                          own continuity cue tying a piece back to its
                          Split-step color, not decorative chrome to drop
                          for the sake of matching. */}
                      <button
                        type="button"
                        onClick={() => setPreviewIndex(index)}
                        title="Tap to preview page"
                        className="relative block aspect-[180/132] w-full overflow-hidden rounded-lg"
                        style={{ border: `1.5px solid ${piece.color}` }}
                      >
                        <img
                          src={getBookPageThumbnailUrl(bookId, piece.start)}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover object-top"
                        />
                      </button>
                      <div
                        className="pointer-events-none invisible absolute top-1/2 left-full z-20 ml-2 w-[420px] -translate-y-1/2 overflow-hidden rounded-md opacity-0 shadow-xl transition-opacity duration-150 group-hover:visible group-hover:opacity-100"
                        style={{ border: `2px solid ${piece.color}` }}
                      >
                        <img
                          src={getBookPageThumbnailUrl(bookId, piece.start)}
                          alt=""
                          className="block h-auto w-full"
                        />
                      </div>
                    </div>
                    <div>
                      <input
                        className={`w-full rounded-md border bg-paper-raised px-2.5 py-1.5 text-sm text-ink ${
                          titleError ? 'border-red-700' : 'border-border'
                        }`}
                        placeholder="Title"
                        {...register(`pieces.${index}.title`, { required: true, maxLength: 255 })}
                      />
                      {titleError && (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-red-700">
                          <IconAlertTriangle size={10} />
                          Required
                        </span>
                      )}
                    </div>
                    <div>
                      <input
                        className={`w-full rounded-md border bg-paper-raised px-2.5 py-1.5 text-sm text-ink ${
                          composerError ? 'border-red-700' : 'border-border'
                        }`}
                        placeholder="Composer"
                        {...composerOrArrangerField('composer', index)}
                      />
                      {composerError && (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-red-700">
                          <IconAlertTriangle size={10} />
                          {composerError.message}
                        </span>
                      )}
                    </div>
                    {showArrangerField && (
                      <div>
                        <input
                          className={`w-full rounded-md border bg-paper-raised px-2.5 py-1.5 text-sm text-ink ${
                            arrangerError ? 'border-red-700' : 'border-border'
                          }`}
                          placeholder="Arranger"
                          {...composerOrArrangerField('arranger', index)}
                        />
                        {arrangerError && (
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-red-700">
                            <IconAlertTriangle size={10} />
                            {arrangerError.message}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {!isDesktop && (
          <div className="flex flex-col border-t border-border">
            {pieces.map((piece, index) => {
              const titleError = errors.pieces?.[index]?.title
              const composerError = errors.pieces?.[index]?.composer
              const arrangerError = errors.pieces?.[index]?.arranger
              return (
                <div
                  key={index}
                  className={`flex items-start gap-3.5 px-4 py-3.5 ${index % 2 === 0 ? 'bg-paper-sunken' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => setPreviewIndex(index)}
                    title="Tap to preview page"
                    className="relative aspect-[180/132] w-[115px] shrink-0 overflow-hidden rounded-lg"
                    style={{ border: `1.5px solid ${piece.color}` }}
                  >
                    <img
                      src={getBookPageThumbnailUrl(bookId, piece.start)}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover object-top"
                    />
                  </button>
                  <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                    <span className="text-sm text-ink-soft">
                      Piece {index + 1} • {formatPieceLabel(piece)}
                    </span>
                    <div>
                      <label className="mb-1 block text-sm text-ink-soft">
                        Title <span className="text-red-700">*</span>
                      </label>
                      <input
                        className={`w-full rounded-md border bg-paper-raised px-3 py-2 text-base text-ink ${
                          titleError ? 'border-red-700' : 'border-border'
                        }`}
                        placeholder="Title"
                        {...register(`pieces.${index}.title`, { required: true, maxLength: 255 })}
                      />
                      {titleError && (
                        <span className="mt-1 flex items-center gap-1 text-xs text-red-700">
                          <IconAlertTriangle size={10} />
                          Required
                        </span>
                      )}
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-ink-soft">Composer</label>
                      <input
                        className={`w-full rounded-md border bg-paper-raised px-3 py-2 text-base text-ink ${
                          composerError ? 'border-red-700' : 'border-border'
                        }`}
                        placeholder="Composer"
                        {...composerOrArrangerField('composer', index)}
                      />
                      {composerError && (
                        <span className="mt-1 flex items-center gap-1 text-xs text-red-700">
                          <IconAlertTriangle size={10} />
                          {composerError.message}
                        </span>
                      )}
                    </div>
                    {showArrangerField && (
                      <div>
                        <label className="mb-1 block text-sm text-ink-soft">Arranger</label>
                        <input
                          className={`w-full rounded-md border bg-paper-raised px-3 py-2 text-base text-ink ${
                            arrangerError ? 'border-red-700' : 'border-border'
                          }`}
                          placeholder="Arranger"
                          {...composerOrArrangerField('arranger', index)}
                        />
                        {arrangerError && (
                          <span className="mt-1 flex items-center gap-1 text-xs text-red-700">
                            <IconAlertTriangle size={10} />
                            {arrangerError.message}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Cancel upload shares this row with Next — see
            BookUploadAboutStep.tsx's own comment on this same row for the
            full placement/styling reasoning. */}
        <div className="flex items-center justify-between border-t border-border pt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelPending}
            className="flex items-center gap-1.5 text-base text-red-700 hover:text-red-800 disabled:cursor-default disabled:opacity-45"
          >
            <IconX size={24} />
            Cancel upload
          </button>
          <button
            type="submit"
            className="flex items-center gap-1.5 rounded-md bg-accent px-5 py-2.5 font-display font-medium text-white hover:bg-accent/90"
          >
            Next
            <IconArrowRight size={16} />
          </button>
        </div>
      </form>

      {previewIndex !== null && (
        <PageLightbox
          key={previewIndex}
          imageUrl={getBookPageThumbnailUrl(bookId, pieces[previewIndex].start)}
          alt={`Page ${pieces[previewIndex].start} of ${pieceFields[previewIndex]?.title || `piece ${previewIndex + 1}`}`}
          page={previewIndex + 1}
          pageCount={pieces.length}
          onClose={() => setPreviewIndex(null)}
          onPrev={() => setPreviewIndex((i) => Math.max(0, (i ?? 0) - 1))}
          onNext={() => setPreviewIndex((i) => Math.min(pieces.length - 1, (i ?? 0) + 1))}
        />
      )}
    </div>
  )
}
