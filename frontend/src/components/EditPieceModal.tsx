import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
  IconInfoCircle,
  IconXFilled,
} from '@tabler/icons-react'
import { getPieceThumbnailUrl, updatePiece } from '../api/pieces'
import { listInstruments, listKeys, listSheetTypes, listUserTags } from '../api/lookups'
import { ApiError } from '../api/client'
import { secondsToMMSS, mmssToSeconds } from '../lib/duration'
import { matchesKeyQuery } from '../lib/keySearch'
import type { Piece, PieceWriteRequest, PracticeStatus, Tag } from '../api/types'
import { Modal } from './Modal'
import { InfoTooltip } from './InfoTooltip'
import { InheritedNote } from './InheritedNote'
import { TagComboBox } from './TagComboBox'
import { SingleSelect } from './SingleSelect'
import { PageCycleControl } from './PageCycleControl'

// The real Piece Properties Edit Menu (design doc §15) — built from the
// locked mockup design (EditPieceModalMockup.tsx, /mockup/edit-piece-modal,
// left intact as a standing reference). Every layout/behavior decision
// here mirrors that mockup deliberately; if the two ever look different,
// that's either a bug or a change that needs porting to both, not a sign
// this file is free to diverge.

interface EditPieceModalProps {
  piece: Piece
  open: boolean
  onClose: () => void
}

interface FormValues {
  title: string
  composer: string
  arranger: string
  keys: Tag[]
  sheetType: string
  instruments: Tag[]
  userTags: Tag[]
  workOpusNumber: string
  publisher: string
  publisherId: string
  yearWritten: string
  imslpNumber: string
  description: string
  userNotes: string
  practiceStatus: string
  sourcePageStart: string
  sourcePageEnd: string
  duration: string
  bpm: string
  measureCount: string
  beatsPerMeasure: string
}

const PRACTICE_STATUS_OPTIONS = [
  { value: '', label: 'No status set' },
  { value: 'Want to Learn', label: 'Want to Learn' },
  { value: 'Learning', label: 'Learning' },
  { value: 'Learned', label: 'Learned' },
  { value: 'Stalled', label: 'Stalled' },
  { value: 'Dropped', label: 'Dropped' },
]

// A book-inheritable field's "own value falling back to blank" for the
// form — mirrors pieceToWriteRequest.ts's inherited-blank convention
// exactly (own value if overridden, blank if inherited), since a blank
// input is what lets the field keep inheriting on save.
function ownValue(field: { value: string; inherited: boolean }): string {
  return field.inherited ? '' : field.value
}

function pieceToFormValues(piece: Piece): FormValues {
  return {
    title: piece.title,
    composer: ownValue(piece.composer),
    arranger: piece.arranger ?? '',
    keys: piece.keys,
    sheetType: piece.sheetType.inherited ? '' : (piece.sheetType.value?.name ?? ''),
    instruments: piece.instruments.inherited ? [] : piece.instruments.values,
    userTags: piece.userTags,
    workOpusNumber: ownValue(piece.workOpusNumber),
    publisher: ownValue(piece.publisher),
    publisherId: ownValue(piece.publisherId),
    yearWritten: ownValue(piece.yearWritten),
    imslpNumber: ownValue(piece.imslpNumber),
    description: ownValue(piece.description),
    userNotes: piece.userNotes ?? '',
    practiceStatus: piece.practiceStatus ?? '',
    sourcePageStart: piece.sourcePageStart != null ? String(piece.sourcePageStart) : '',
    sourcePageEnd: piece.sourcePageEnd != null ? String(piece.sourcePageEnd) : '',
    duration: piece.duration != null ? secondsToMMSS(piece.duration) : '',
    bpm: piece.bpm != null ? String(piece.bpm) : '',
    measureCount: piece.measureCount != null ? String(piece.measureCount) : '',
    beatsPerMeasure: piece.beatsPerMeasure != null ? String(piece.beatsPerMeasure) : '',
  }
}

function toIntOrNull(value: string): number | null {
  if (value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// Strips a leading "IMSLP" label (with or without a following
// space/colon/hash/dash, any case) before the value is ever sent to the
// backend — the citation now adds its own "IMSLP #" label (buildCitation,
// internal/handlers/citation.go), so a value typed in as "IMSLP04154"
// would otherwise render doubled ("IMSLP #IMSLP04154"). Only strips an
// actual prefix match; a value with no "IMSLP" text is returned as-is.
function stripImslpPrefix(value: string): string {
  return value.replace(/^\s*imslp[\s:#-]*/i, '')
}

function formValuesToWriteRequest(data: FormValues, piece: Piece): PieceWriteRequest {
  return {
    title: data.title,
    composer: data.composer,
    arranger: data.arranger || null,
    // Favorite lives on the Piece View's own header (a real toggle there
    // already) — editing it a second time from here would be redundant,
    // so this form doesn't surface it at all. Passed through unchanged so
    // this full-replace write doesn't clobber it.
    favorite: piece.favorite,
    workOpusNumber: data.workOpusNumber,
    keys: data.keys.map((k) => k.name),
    sheetTypeName: data.sheetType,
    publisher: data.publisher,
    publisherId: data.publisherId,
    yearWritten: data.yearWritten,
    description: data.description,
    userNotes: data.userNotes || null,
    instruments: data.instruments.map((i) => i.name),
    userTags: data.userTags.map((t) => t.name),
    practiceStatus: (data.practiceStatus || null) as PracticeStatus | null,
    imslpNumber: stripImslpPrefix(data.imslpNumber),
    sourcePageStart: toIntOrNull(data.sourcePageStart),
    sourcePageEnd: toIntOrNull(data.sourcePageEnd),
    duration: data.duration.trim() === '' ? null : mmssToSeconds(data.duration),
    bpm: toIntOrNull(data.bpm),
    measureCount: toIntOrNull(data.measureCount),
    beatsPerMeasure: toIntOrNull(data.beatsPerMeasure),
  }
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-medium tracking-wide text-ink-soft/70 uppercase">{children}</h3>
  )
}

export function EditPieceModal({ piece, open, onClose }: EditPieceModalProps) {
  const queryClient = useQueryClient()
  const [tempoOpen, setTempoOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewPage, setPreviewPage] = useState(piece.thumbnailPage)
  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: pieceToFormValues(piece) })

  useEffect(() => {
    if (open) {
      reset(pieceToFormValues(piece))
      // Reopening (possibly for a different piece) always starts the
      // preview closed on that piece's own thumbnail page — carrying over
      // an open/scrolled-to-page-4 state from whatever was last edited
      // would be confusing, not a convenience.
      setPreviewOpen(false)
      setPreviewPage(piece.thumbnailPage)
    }
  }, [open, piece, reset])

  // Small fixed lookup lists (design doc §5) — generous staleTime since
  // these change rarely (a user adding a brand-new tag/instrument mid-edit
  // is the only case that invalidates them, handled by TagComboBox's own
  // "New tag" affordance without needing this list to refetch).
  const { data: keyOptions = [] } = useQuery({ queryKey: ['keys'], queryFn: listKeys })
  const { data: sheetTypeOptions = [] } = useQuery({
    queryKey: ['sheetTypes'],
    queryFn: listSheetTypes,
  })
  const { data: instrumentOptions = [] } = useQuery({
    queryKey: ['instruments'],
    queryFn: listInstruments,
  })
  const { data: userTagOptions = [] } = useQuery({ queryKey: ['userTags'], queryFn: listUserTags })

  const sheetTypeSelectOptions = [
    { value: '', label: '—' },
    ...sheetTypeOptions.map((o) => ({ value: o.name, label: o.name })),
  ]

  const composer = watch('composer')
  const bpm = Number(watch('bpm'))
  const measureCount = Number(watch('measureCount'))
  const beatsPerMeasure = Number(watch('beatsPerMeasure'))
  const canCalculateDuration = bpm > 0 && measureCount > 0 && beatsPerMeasure > 0

  // One-shot convenience, not a live-bound computed field — Piece.duration
  // is a plain user-entered field now (CLAUDE.md > Frontend > Computed
  // fields, a deliberate deviation from design doc §3). Mirrors the
  // formula the backend used to apply automatically, purely so this
  // button's output matches what a user would expect from those three
  // tempo inputs.
  function handleCalculateDuration() {
    if (!canCalculateDuration) return
    const totalSeconds = Math.trunc(((measureCount * beatsPerMeasure) / bpm) * 60)
    setValue('duration', secondsToMMSS(totalSeconds))
  }

  const saveMutation = useMutation({
    mutationFn: (data: FormValues) => updatePiece(piece.id, formValuesToWriteRequest(data, piece)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pieces'] })
      queryClient.invalidateQueries({ queryKey: ['piece'] })
      onClose()
    },
  })

  function onSubmit(data: FormValues) {
    saveMutation.mutate(data)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="edit-piece-title"
      size="lg"
      header={
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="edit-piece-title" className="font-display text-2xl text-ink">
                Edit piece
              </h2>
              <p className="text-sm text-ink-soft">{piece.title}</p>
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

          {/* Page preview — pinned here (Modal's `header` slot) rather than
              inside the scrolling form, specifically so it can't scroll out
              of view while the fields below it do (design review,
              2026-08-17: "the preview should remain fixed while the fields
              freely scroll"). Starts closed, same footprint as before this
              feature existed; toggling it open only adds height here, never
              changes the modal's width. Full-width image in its own capped-
              height scroll box (a portrait page at full modal width is
              taller than any reasonable fixed strip) with the plain below-
              image PageCycleControl underneath — not the Piece View's
              floating-capsule cycler, which overlaps the bottom of the page
              itself and could cover exactly the content (final measures, a
              signature, page numbers) someone opened the preview to check. */}
          {/* Toggle + collapsible panel share one non-gapped wrapper, not
              two direct children of the outer `gap-3` flex column — a
              flex `gap` reserves its full space between every pair of
              siblings regardless of whether one of them is visually
              collapsed to zero height, so treating the panel as a sibling
              of the toggle button (rather than nested under it) left a
              stray extra gap-3 worth of whitespace even while folded. */}
          <div>
            <button
              type="button"
              onClick={() => setPreviewOpen((o) => !o)}
              className="flex w-fit items-center gap-1.5 rounded-full border border-border bg-paper px-3 py-1.5 text-xs text-ink-soft hover:text-ink"
            >
              {/* Points right (toward the label) while folded — the usual
                  "expands this way" affordance — and rotates to point down
                  once open, matching the panel expanding downward beneath
                  it. */}
              <IconChevronDown
                size={13}
                className={`transition-transform ${previewOpen ? '' : '-rotate-90'}`}
              />
              {previewOpen ? 'Hide page preview' : 'Show page preview'}
            </button>
            <div
              className={`overflow-hidden transition-[max-height] duration-200 ease-in-out ${
                previewOpen ? 'max-h-[420px] border-b border-border' : 'max-h-0'
              }`}
            >
              <div className="flex flex-col gap-2 pt-3 pb-4">
                <div className="max-h-[280px] overflow-y-auto rounded-md border border-border bg-paper-sunken">
                  <img
                    src={getPieceThumbnailUrl(piece.id, previewPage)}
                    alt={`Page ${previewPage} of ${piece.title}`}
                    className="block h-auto w-full"
                  />
                </div>
                <div className="flex justify-center">
                  <PageCycleControl
                    page={previewPage}
                    pageCount={piece.pageCount}
                    onChange={setPreviewPage}
                  />
                </div>
              </div>
            </div>
          </div>
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
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="edit-piece-form"
              disabled={saveMutation.isPending}
              className="rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90 disabled:opacity-60"
            >
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      }
    >
      <form id="edit-piece-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="f-title" className="text-sm text-ink-soft">
              Title
            </label>
            <input
              id="f-title"
              className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('title', { required: 'Title is required.', maxLength: 255 })}
            />
            {errors.title && <p className="text-sm text-red-700">{errors.title.message}</p>}
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="flex min-w-[250px] flex-1 flex-col gap-1">
              <label htmlFor="f-composer" className="text-sm text-ink-soft">
                Composer
              </label>
              <input
                id="f-composer"
                placeholder={!composer && piece.composer.inherited ? piece.composer.value : undefined}
                className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-soft/40 placeholder:italic"
                {...register('composer', { maxLength: 255 })}
              />
              {errors.composer && <p className="text-sm text-red-700">{errors.composer.message}</p>}
              {!composer && piece.composer.inherited && (
                <InheritedNote
                  bookValue={piece.composer.value}
                  onCopy={() => setValue('composer', piece.composer.value)}
                />
              )}
            </div>
            <div className="flex min-w-[250px] flex-1 flex-col gap-1">
              <label htmlFor="f-arranger" className="text-sm text-ink-soft">
                Arranger
              </label>
              <input
                id="f-arranger"
                className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                {...register('arranger', { maxLength: 255 })}
              />
            </div>
          </div>
        </div>

        {/* Piece Details */}
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <SectionHeading>Piece Details</SectionHeading>
          <div className="flex flex-wrap gap-3">
            <div className="flex min-w-[250px] flex-1 flex-col gap-1">
              <label htmlFor="f-opus" className="flex items-center gap-1 text-sm text-ink-soft">
                Opus / catalog no.
                <InfoTooltip
                  message="If this piece is part of a larger work which has a number assigned, enter that number."
                  ariaLabel="What Opus / catalog no. means"
                  triggerClassName="text-ink-soft/60 hover:text-ink-soft"
                >
                  <IconInfoCircle size={13} />
                </InfoTooltip>
              </label>
              <input
                id="f-opus"
                className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                {...register('workOpusNumber', { maxLength: 255 })}
              />
            </div>
            <div className="flex min-w-[250px] flex-1 flex-col gap-1">
              <label htmlFor="f-year" className="text-sm text-ink-soft">
                Year written
              </label>
              <input
                id="f-year"
                placeholder={!watch('yearWritten') && piece.yearWritten.inherited ? piece.yearWritten.value : undefined}
                className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-soft/40 placeholder:italic"
                {...register('yearWritten', { maxLength: 255 })}
              />
              {!watch('yearWritten') && piece.yearWritten.inherited && (
                <InheritedNote
                  bookValue={piece.yearWritten.value}
                  onCopy={() => setValue('yearWritten', piece.yearWritten.value)}
                />
              )}
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor="f-publisher" className="text-sm text-ink-soft">
                Publisher
              </label>
              <input
                id="f-publisher"
                placeholder={!watch('publisher') && piece.publisher.inherited ? piece.publisher.value : undefined}
                className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-soft/40 placeholder:italic"
                {...register('publisher', { maxLength: 255 })}
              />
            </div>
            <div className="flex w-36 shrink-0 flex-col gap-1">
              <label htmlFor="f-publisher-id" className="text-sm text-ink-soft">
                Publisher ID
              </label>
              <input
                id="f-publisher-id"
                placeholder={
                  !watch('publisherId') && piece.publisherId.inherited ? piece.publisherId.value : undefined
                }
                className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-right text-ink placeholder:text-ink-soft/40 placeholder:italic"
                {...register('publisherId', { maxLength: 255 })}
              />
            </div>
          </div>
          {!watch('publisher') &&
            !watch('publisherId') &&
            piece.publisher.inherited &&
            piece.publisherId.inherited && (
              <InheritedNote
                bookValue={`${piece.publisher.value} · ${piece.publisherId.value}`}
                onCopy={() => {
                  setValue('publisher', piece.publisher.value)
                  setValue('publisherId', piece.publisherId.value)
                }}
              />
            )}
          <div className="flex flex-col gap-1">
            <label htmlFor="f-imslp" className="text-sm text-ink-soft">
              IMSLP no.
            </label>
            <input
              id="f-imslp"
              placeholder={!watch('imslpNumber') && piece.imslpNumber.inherited ? piece.imslpNumber.value : undefined}
              className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-soft/40 placeholder:italic"
              {...register('imslpNumber', { maxLength: 255 })}
            />
            {!watch('imslpNumber') && piece.imslpNumber.inherited && (
              <InheritedNote
                bookValue={piece.imslpNumber.value}
                onCopy={() => setValue('imslpNumber', piece.imslpNumber.value)}
              />
            )}
          </div>
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="f-page-start" className="text-sm text-ink-soft">
                Book page start
              </label>
              <input
                id="f-page-start"
                type="number"
                className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                {...register('sourcePageStart')}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="f-page-end" className="text-sm text-ink-soft">
                Book page end
              </label>
              <input
                id="f-page-end"
                type="number"
                className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                {...register('sourcePageEnd')}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="f-description" className="text-sm text-ink-soft">
              Description
            </label>
            <textarea
              id="f-description"
              rows={3}
              className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('description')}
            />
          </div>
        </div>

        {/* Classification */}
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <SectionHeading>Classification</SectionHeading>
          <Controller
            name="keys"
            control={control}
            render={({ field }) => (
              <TagComboBox
                label="Key(s)"
                options={keyOptions}
                selected={field.value}
                multiple
                onChange={field.onChange}
                filterOption={(o, query) => matchesKeyQuery(o.name, query)}
                allowDuplicates
                sequenceStyle
              />
            )}
          />
          <Controller
            name="sheetType"
            control={control}
            render={({ field }) => (
              <SingleSelect
                label="Sheet Type"
                options={sheetTypeSelectOptions}
                value={field.value}
                onChange={field.onChange}
                bookValue={piece.sheetType.inherited ? (piece.sheetType.value?.name ?? undefined) : undefined}
                onCopy={() => field.onChange(piece.sheetType.value?.name ?? '')}
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
                bookValue={
                  piece.instruments.inherited
                    ? piece.instruments.values.map((i) => i.name).join(', ')
                    : undefined
                }
                onCopy={() => field.onChange(piece.instruments.values)}
              />
            )}
          />
          <Controller
            name="userTags"
            control={control}
            render={({ field }) => (
              <TagComboBox
                label="Your Tags"
                options={userTagOptions}
                selected={field.value}
                multiple
                onChange={field.onChange}
              />
            )}
          />
        </div>

        {/* Personal */}
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <SectionHeading>Personal</SectionHeading>
          <Controller
            name="practiceStatus"
            control={control}
            render={({ field }) => (
              <SingleSelect
                label="Practice status"
                options={PRACTICE_STATUS_OPTIONS}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="f-notes" className="text-sm text-ink-soft">
              Your notes
            </label>
            <textarea
              id="f-notes"
              rows={2}
              className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('userNotes')}
            />
          </div>
        </div>

        {/* Duration */}
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <SectionHeading>Duration</SectionHeading>
          <div className="flex flex-col gap-1">
            <label htmlFor="f-duration" className="text-sm text-ink-soft">
              Duration (mm:ss)
            </label>
            <input
              id="f-duration"
              placeholder="e.g. 3:45"
              className="w-32 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('duration', {
                pattern: { value: /^\d+:[0-5]\d$/, message: 'Enter duration as mm:ss (e.g. 3:45).' },
              })}
            />
          </div>
          {errors.duration && <p className="text-sm text-red-700">{errors.duration.message}</p>}
          <div>
            <button
              type="button"
              onClick={() => setTempoOpen((o) => !o)}
              className="flex items-center gap-1 text-xs text-ink-soft/60 hover:text-ink-soft"
            >
              <IconChevronRight
                size={12}
                className={`transition-transform ${tempoOpen ? 'rotate-90' : ''}`}
              />
              Calculate from tempo
            </button>
            {tempoOpen && (
              <div className="mt-2 flex flex-wrap items-end gap-3 pl-5">
                <div className="flex flex-col gap-1">
                  <label htmlFor="f-bpm" className="text-sm text-ink-soft">
                    BPM
                  </label>
                  <input
                    id="f-bpm"
                    type="number"
                    min={1}
                    className="w-24 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                    {...register('bpm', { min: { value: 1, message: 'Must be positive.' } })}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="f-measures" className="text-sm text-ink-soft">
                    Measures
                  </label>
                  <input
                    id="f-measures"
                    type="number"
                    min={1}
                    className="w-24 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                    {...register('measureCount', { min: { value: 1, message: 'Must be positive.' } })}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="f-beats" className="text-sm text-ink-soft">
                    Beats / measure
                  </label>
                  <input
                    id="f-beats"
                    type="number"
                    min={1}
                    className="w-24 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                    {...register('beatsPerMeasure', { min: { value: 1, message: 'Must be positive.' } })}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleCalculateDuration}
                  disabled={!canCalculateDuration}
                  className="rounded-md border border-border bg-paper-raised px-3 py-2 font-display text-sm text-ink hover:border-accent disabled:pointer-events-none disabled:opacity-40"
                >
                  Calculate
                </button>
              </div>
            )}
          </div>
        </div>
      </form>
    </Modal>
  )
}
