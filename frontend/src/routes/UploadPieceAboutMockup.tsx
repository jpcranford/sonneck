import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Controller, useForm } from 'react-hook-form'
import {
  IconArrowLeft,
  IconArrowsDiagonal,
  IconChevronLeft,
  IconChevronRight,
  IconChevronRightFilled,
  IconSearch,
  IconXFilled,
} from '@tabler/icons-react'
import type { Tag } from '../api/types'
import { TagComboBox } from '../components/TagComboBox'
import { SingleSelect } from '../components/SingleSelect'
import { useMockupTitle } from '../lib/useMockupTitle'

// ---------------------------------------------------------------------
// DESIGN MOCKUP — single-piece Upload's own "details" step (the real
// UploadPage.tsx's `stage === 'details'` block), Option B ("Essentials +
// More Details") of a 3-way comparison Artifact — picked over Option A
// (verbatim reuse of the Book Upload Wizard's "About this book" layout,
// every field always visible) and Option C (the Edit Piece modal's own
// full section structure ported wholesale) specifically for keeping the
// fast path to Save uncluttered: Title/Composer/Arranger/Key(s)/Sheet
// Type stay always visible, everything else collapses behind two
// disclosures using the exact chevron-trigger pattern EditPieceModal.tsx's
// own Copyright/Book Details sections already established (same text-xs
// uppercase tracking-wide SectionHeading-matched styling, same dashed-
// border panel). Not wired to the API — local mock state only, same
// convention as UploadBookAboutMockup.tsx/EditPieceModalMockup.tsx.
//
// Real behavior this mirrors: title comes pre-filled from the uploaded
// filename, everything else (composer included) starts genuinely blank —
// same "starts blank, user fills it in" choice UploadBookAboutMockup.tsx
// makes for its own composer/arranger, not a prettier-screenshot
// pre-filled pill.
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
const KEY_OPTIONS: Tag[] = [
  { id: 1, name: 'C major' },
  { id: 2, name: 'D♭ major' },
  { id: 3, name: 'A minor' },
]
// Real callers (EditPieceModal.tsx/EditBookModal.tsx/UploadPage.tsx itself)
// source this from the real, unpaginated GET /api/people — same hardcoded
// fixture stand-in every other mockup's own copy of this list already
// uses.
const PEOPLE_OPTIONS: Tag[] = [
  { id: 1, name: 'Claude Debussy' },
  { id: 2, name: 'Frédéric Chopin' },
  { id: 3, name: 'Robert Schumann' },
]

const MOCK_PAGE_COUNT = 3

interface FormValues {
  title: string
  composer: Tag[]
  arranger: Tag[]
  keys: Tag[]
  sheetType: string
  workOpusNumber: string
  yearWritten: string
  publisher: string
  imslpNumber: string
  instruments: Tag[]
  description: string
}

const defaultValues: FormValues = {
  title: 'Clair de Lune',
  composer: [],
  arranger: [],
  keys: [],
  sheetType: '',
  workOpusNumber: '',
  yearWritten: '',
  publisher: '',
  imslpNumber: '',
  instruments: [],
  description: '',
}

// Stand-in for a real piece page image (this mockup has no real pieceId to
// build a getPieceThumbnailUrl(...) call against) — same drawn-SVG-page
// convention PieceDetailsSample.tsx's own SheetPagePlaceholder and
// UploadBookAboutMockup.tsx's CoverPagePlaceholder already use.
function SheetPagePlaceholder({ page }: { page: number }) {
  return (
    <svg viewBox="0 0 200 260" className="h-auto w-full" role="img" aria-label={`Page ${page} preview`}>
      <rect x="0.5" y="0.5" width="199" height="259" fill="#fffdf9" stroke="#e4e0d8" />
      <text x="100" y="24" textAnchor="middle" fontFamily="Georgia, serif" fontSize="10" fontWeight="700" fill="#1c1815">
        Clair de Lune
      </text>
      <text x="100" y="35" textAnchor="middle" fontFamily="Georgia, serif" fontSize="6" letterSpacing="1" fill="#5c5349">
        CLAUDE DEBUSSY
      </text>
      {[55, 88, 121, 154, 187, 220].map((y) => (
        <g key={y} stroke="#c9c2b6" strokeWidth="0.5">
          {[0, 3.5, 7, 10.5, 14].map((offset) => (
            <line key={offset} x1="18" x2="182" y1={y + offset} y2={y + offset} />
          ))}
        </g>
      ))}
      <text x="184" y="248" textAnchor="end" fontFamily="Georgia, serif" fontSize="7" fill="#8f857a">
        {page}
      </text>
    </svg>
  )
}

// Local copy of PageLightbox.tsx, same "no shared component between a
// mockup and the real thing" convention as every other mockup in this
// codebase (see PieceDetailsSample.tsx/UploadBookAboutMockup.tsx's own
// copies for precedent).
function PageLightbox({
  page,
  pageCount,
  onClose,
  onPrev,
  onNext,
}: {
  page: number
  pageCount: number
  onClose: () => void
  onPrev: () => void
  onNext: () => void
}) {
  const [zoom, setZoom] = useState<'fit' | 'actual'>('fit')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft') onPrev()
      if (event.key === 'ArrowRight') onNext()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, onPrev, onNext])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-6 left-6 flex size-10 items-center justify-center rounded-full bg-ink/80 text-white shadow-md backdrop-blur-sm hover:bg-white/15 focus-visible:outline-accent-on-dark"
      >
        <IconXFilled size={20} />
      </button>
      <div className="pointer-events-none absolute top-6 right-6 rounded-full bg-ink/80 px-3 py-1.5 text-xs text-white/90 shadow-md backdrop-blur-sm">
        Click image to {zoom === 'fit' ? 'zoom in' : 'fit to screen'}
      </div>
      <button
        type="button"
        onClick={() => setZoom((z) => (z === 'fit' ? 'actual' : 'fit'))}
        aria-label={zoom === 'fit' ? 'Zoom in to actual size' : 'Zoom out to fit screen'}
        className={
          zoom === 'fit'
            ? 'flex max-h-[85vh] max-w-[90vw] cursor-zoom-in items-center justify-center'
            : 'max-h-[85vh] max-w-[90vw] cursor-zoom-out overflow-auto rounded-md'
        }
      >
        <div
          className={
            zoom === 'fit'
              ? 'w-[70vw] max-w-[440px] overflow-hidden rounded-md bg-paper-raised shadow-2xl sm:w-[420px]'
              : 'w-[820px] overflow-hidden rounded-md bg-paper-raised shadow-2xl'
          }
        >
          <SheetPagePlaceholder page={page} />
        </div>
      </button>
      {pageCount > 1 && (
        <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-ink/80 px-2 py-1 shadow-md backdrop-blur-sm">
          <button
            type="button"
            onClick={onPrev}
            disabled={page === 1}
            aria-label="Previous page"
            className="flex size-7 cursor-pointer items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-accent-on-dark disabled:pointer-events-none disabled:opacity-35"
          >
            <IconChevronLeft size={16} />
          </button>
          <span className="text-xs tabular-nums text-white/90">
            {page} / {pageCount}
          </span>
          <button
            type="button"
            onClick={onNext}
            disabled={page === pageCount}
            aria-label="Next page"
            className="flex size-7 cursor-pointer items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-accent-on-dark disabled:pointer-events-none disabled:opacity-35"
          >
            <IconChevronRightFilled size={16} />
          </button>
        </div>
      )}
    </div>
  )
}

// The two collapsible disclosures below share this exact trigger shape —
// factored out rather than repeated, since "More details" and "From a
// book?" are otherwise identical chrome around different panel content.
// Text styling matches SectionHeading (Frontmatter/Musical Details/etc. in
// EditPieceModal.tsx) exactly, same reasoning as that file's own Copyright/
// Book Details triggers: this is a section title that's also a clickable
// disclosure, so it needs the chevron + hover affordance a plain h3
// doesn't.
function CollapsibleSection({
  label,
  open,
  onToggle,
  children,
}: {
  label: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="border-t border-border pt-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex cursor-pointer items-center gap-1 text-xs font-medium tracking-wide text-ink-soft/70 uppercase hover:text-ink"
      >
        <IconChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        {label}
      </button>
      {open && <div className="mt-3 flex flex-col gap-4 rounded-md border border-dashed border-border p-4">{children}</div>}
    </div>
  )
}

export function UploadPieceAboutMockup() {
  useMockupTitle('Upload — About This Piece')

  const [previewPage, setPreviewPage] = useState(1)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [moreDetailsOpen, setMoreDetailsOpen] = useState(false)
  const [bookOpen, setBookOpen] = useState(false)

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues })

  return (
    // min-h-screen + justify-center (ported from the real build, direct
    // follow-up, 2026-09-04) — AppShell's <main> only gets whatever's left
    // over after its own sibling <footer> takes a share of the same
    // flex-col budget, which silently zeroes out justify-center's own
    // "extra space to distribute" once a stage's content gets tall enough
    // (confirmed live against the real UploadPage.tsx: <main> measured
    // ~93px shorter than the actual viewport). min-h-screen forces real
    // centering headroom against the full viewport regardless. This
    // mockup's own earlier top-aligned choice (no justify-center) predates
    // that fix — reversed here to match the real page's own final
    // behavior, not left to drift.
    <div className="flex min-h-screen flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="w-full max-w-3xl">
        {/* Back isn't real stage-nav (this mockup doesn't simulate the
            whole Upload flow, just this one step) — it routes to /mockup,
            same "never a dead end" convention every other mockup's own
            Back control uses (see UploadBookAboutMockup.tsx). In the real
            build this instead calls setStage('select'), returning to the
            drag-and-drop screen exactly the way the 'select' stage's own
            Back button already returns to 'landing'. */}
        <Link to="/mockup" className="flex w-fit items-center gap-1.5 text-base text-ink-soft hover:text-ink">
          <IconArrowLeft size={24} />
          Back
        </Link>
      </div>
      <form onSubmit={handleSubmit(() => {})} className="flex w-full max-w-3xl flex-col gap-4">
        <div>
          <h1 className="font-display text-2xl font-medium text-ink">About this piece</h1>
          {/* Same one-line instruction-under-heading treatment as the Book
              Upload Wizard's "About this book" (BookUploadAboutStep.tsx) —
              adapted for a single piece having nothing to inherit from/
              override, and for how little is actually required here. */}
          <p className="text-sm text-ink-soft">
            Fill in what you know now — Title is the only one that's required, and everything else is
            easy to add later from Piece Details.
          </p>
        </div>
        <div className="flex flex-col items-start gap-7 sm:flex-row">
          <div className="relative w-full max-w-[280px] shrink-0 overflow-hidden rounded-lg border border-border bg-paper-sunken shadow-sm sm:w-[280px]">
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              aria-label={`View page ${previewPage} larger`}
              className="block w-full cursor-zoom-in"
            >
              <SheetPagePlaceholder page={previewPage} />
            </button>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-2.5 right-2.5 flex items-center justify-center rounded-full bg-ink/80 p-1.5 text-white shadow-md backdrop-blur-sm"
            >
              <IconArrowsDiagonal size={14} />
            </div>
            {MOCK_PAGE_COUNT > 1 && (
              <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-ink/80 px-2 py-1 shadow-md backdrop-blur-sm">
                <button
                  type="button"
                  onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                  disabled={previewPage === 1}
                  aria-label="Previous page"
                  className="flex size-6 cursor-pointer items-center justify-center rounded-full text-white hover:bg-white/15 disabled:pointer-events-none disabled:opacity-35"
                >
                  <IconChevronLeft size={14} />
                </button>
                <span className="text-xs tabular-nums text-white/90">
                  {previewPage} / {MOCK_PAGE_COUNT}
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewPage((p) => Math.min(MOCK_PAGE_COUNT, p + 1))}
                  disabled={previewPage === MOCK_PAGE_COUNT}
                  aria-label="Next page"
                  className="flex size-6 cursor-pointer items-center justify-center rounded-full text-white hover:bg-white/15 disabled:pointer-events-none disabled:opacity-35"
                >
                  <IconChevronRightFilled size={14} />
                </button>
              </div>
            )}
          </div>
          {lightboxOpen && (
            <PageLightbox
              key={previewPage}
              page={previewPage}
              pageCount={MOCK_PAGE_COUNT}
              onClose={() => setLightboxOpen(false)}
              onPrev={() => setPreviewPage((p) => Math.max(1, p - 1))}
              onNext={() => setPreviewPage((p) => Math.min(MOCK_PAGE_COUNT, p + 1))}
            />
          )}

          <div className="flex w-full min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="f-title" className="text-sm text-ink-soft">
                Title <span className="text-ink-soft/60 italic">(Required)</span>
              </label>
              <input
                id="f-title"
                className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                {...register('title', { required: 'Title is required.', maxLength: 255 })}
              />
              {errors.title && <p className="text-sm text-red-700">{errors.title.message}</p>}
            </div>

            <div className="flex flex-col gap-3 min-[525px]:flex-row">
              <div className="min-w-0 flex-1">
                <Controller
                  name="composer"
                  control={control}
                  rules={{
                    validate: (value, values) =>
                      value.length > 0 || values.arranger.length > 0 || 'Composer or Arranger is required.',
                  }}
                  render={({ field }) => (
                    <TagComboBox
                      label="Composer"
                      options={PEOPLE_OPTIONS}
                      selected={field.value}
                      multiple
                      onChange={field.onChange}
                      pillStyle="paper"
                      newOptionLabel="New person"
                    />
                  )}
                />
                {errors.composer && <p className="text-sm text-red-700">{errors.composer.message}</p>}
              </div>
              <div className="min-w-0 flex-1">
                <Controller
                  name="arranger"
                  control={control}
                  render={({ field }) => (
                    <TagComboBox
                      label="Arranger"
                      options={PEOPLE_OPTIONS}
                      selected={field.value}
                      multiple
                      onChange={field.onChange}
                      pillStyle="paper"
                      newOptionLabel="New person"
                    />
                  )}
                />
              </div>
            </div>

            {/* Year Written/IMSLP No. swapped in for Key(s)/Sheet Type
                (direct follow-up) — both read as quick identifying facts
                worth a glance without opening "More details," where
                Key(s)/Sheet Type now live instead. */}
            <div className="flex flex-col gap-3 min-[525px]:flex-row">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor="f-year" className="text-sm text-ink-soft">
                  Year Written
                </label>
                <input
                  id="f-year"
                  placeholder="e.g. 1905"
                  className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-soft/40 placeholder:italic"
                  {...register('yearWritten', { maxLength: 255 })}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor="f-imslp" className="text-sm text-ink-soft">
                  IMSLP No.
                </label>
                <input
                  id="f-imslp"
                  className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 font-mono text-ink"
                  {...register('imslpNumber', { maxLength: 255 })}
                />
              </div>
            </div>

            <CollapsibleSection label="More details" open={moreDetailsOpen} onToggle={() => setMoreDetailsOpen((o) => !o)}>
              <div className="flex flex-col gap-3 min-[525px]:flex-row">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <label htmlFor="f-opus" className="text-sm text-ink-soft">
                    Work/Opus Number
                  </label>
                  <input
                    id="f-opus"
                    placeholder="e.g. Op. 68"
                    className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-soft/40 placeholder:italic"
                    {...register('workOpusNumber', { maxLength: 255 })}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <Controller
                    name="keys"
                    control={control}
                    render={({ field }) => (
                      <TagComboBox
                        label="Key(s)"
                        options={KEY_OPTIONS}
                        selected={field.value}
                        multiple
                        onChange={field.onChange}
                        allowDuplicates
                        sequenceStyle
                      />
                    )}
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
                    placeholder="e.g. G. Schirmer"
                    className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-soft/40 placeholder:italic"
                    {...register('publisher', { maxLength: 255 })}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <Controller
                    name="sheetType"
                    control={control}
                    render={({ field }) => (
                      <SingleSelect
                        label="Sheet Type"
                        options={SHEET_TYPE_SELECT_OPTIONS}
                        value={field.value}
                        onChange={field.onChange}
                      />
                    )}
                  />
                </div>
              </div>
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
              <div className="flex flex-col gap-1">
                <label htmlFor="f-description" className="text-sm text-ink-soft">
                  Description <span className="text-ink-soft/60 italic">(Markdown supported)</span>
                </label>
                <textarea
                  id="f-description"
                  rows={2}
                  placeholder="Optional notes about this piece…"
                  className="resize-none rounded-md border border-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-soft/40 placeholder:italic"
                  {...register('description')}
                />
              </div>
            </CollapsibleSection>

            {/* Reuses the real UploadPage.tsx's own prompt copy — "come back
                and link it later if you want" is the point being made, not
                just "here's a field." A real build wires this to
                SourceBookField exactly as UploadPage.tsx already does; this
                mockup fakes the same visual (search icon + italic
                placeholder) without real search-as-you-type behavior, same
                "no shared markup-bearing component between a mockup and the
                real thing" convention every other field placeholder-fake in
                this file follows. */}
            <CollapsibleSection label="From a book?" open={bookOpen} onToggle={() => setBookOpen((o) => !o)}>
              <p className="text-sm text-ink-soft">Is this piece from a book already in your library?</p>
              <div className="flex items-center gap-2 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink-soft/60">
                <IconSearch size={16} />
                <span className="text-sm italic">Search books…</span>
              </div>
            </CollapsibleSection>

            <button type="submit" className="mt-1 rounded-md bg-accent px-4 py-2 font-display text-white">
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
