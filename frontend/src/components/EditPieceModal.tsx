import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
  IconInfoCircle,
  IconXFilled,
} from '@tabler/icons-react'
import { listPeople } from '../api/people'
import { getPieceThumbnailUrl, updatePiece } from '../api/pieces'
import { lookupImslp } from '../api/imslp'
import { listInstruments, listKeys, listSheetTypes, listUserTags } from '../api/lookups'
import { ApiError } from '../api/client'
import { secondsToMMSS, mmssToSeconds } from '../lib/duration'
import { matchesKeyQuery } from '../lib/keySearch'
import { afterMinDuration } from '../lib/minDuration'
import type { Piece, PieceWriteRequest, PracticeStatus, Tag } from '../api/types'
import { Modal } from './Modal'
import { InfoTooltip } from './InfoTooltip'
import { InheritedNote } from './InheritedNote'
import { ImslpAutofillButton } from './ImslpAutofillButton'
import { TagComboBox } from './TagComboBox'
import { SingleSelect } from './SingleSelect'
import { SourceBookField } from './SourceBookField'
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
  // Composer/Arranger (composer/arranger overhaul, Stage C) are ordered
  // Person lists now — real TagComboBox fields, same shape as `keys`
  // below, not the plain comma-separated-text bridge Stage B used as a
  // stopgap.
  composer: Tag[]
  arranger: Tag[]
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
  sourceBookId: number | null
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

// Same ownValue treatment, for Composer/Arranger's ordered Person lists
// (composer/arranger overhaul, Stage C) — empty when inherited (so saving
// with nothing picked keeps inheriting), the piece's own list otherwise.
// Mirrors Instruments' own field below exactly (`piece.instruments.values`
// when overridden, `[]` when inherited).
function ownTagList(field: { values: Tag[]; inherited: boolean }): Tag[] {
  return field.inherited ? [] : field.values
}

function pieceToFormValues(piece: Piece): FormValues {
  return {
    title: piece.title,
    composer: ownTagList(piece.composer),
    // Book-inheritable — same ownTagList treatment as every other field
    // here (blank when inherited, so leaving it blank on save keeps
    // inheriting), not a raw echo of the resolved value.
    arranger: ownTagList(piece.arranger),
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
    sourceBookId: piece.sourceBookId,
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
    composers: data.composer.map((t) => t.name),
    arrangers: data.arranger.map((t) => t.name),
    // Favorite lives on the Piece Details page's own header (a real toggle there
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
    sourceBookId: data.sourceBookId,
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

// Measures an element's real layout height via ResizeObserver's own entry
// data (entry.borderBoxSize), not getBoundingClientRect() — confirmed via
// direct measurement that getBoundingClientRect() was a real source of
// error: Modal's dialog pops in with a CSS `scale-95 -> scale-100`
// transform, and the very first observer callback fires while that
// transform is still mid-animation. getBoundingClientRect() reports the
// *visually rendered* (transform-affected) box, quietly undershooting by
// however much the transform hadn't finished animating yet.
// entry.borderBoxSize is layout size, unaffected by CSS transforms, so
// it's correct from the very first callback. `active` gates whether a
// given resize is actually recorded — used to freeze a measurement (e.g.
// the toggle row's own height should only be captured while the preview
// panel below it is collapsed, not mid-expansion).
function useMeasuredHeight(active = true) {
  const [el, setEl] = useState<Element | null>(null)
  const [height, setHeight] = useState(0)
  const ref = useCallback((node: HTMLElement | null) => setEl(node), [])
  useLayoutEffect(() => {
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      if (!active) return
      const entry = entries[0]
      setHeight(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height)
    })
    observer.observe(el, { box: 'border-box' })
    return () => observer.disconnect()
  }, [el, active])
  return [ref, height] as const
}

export function EditPieceModal({ piece, open, onClose }: EditPieceModalProps) {
  const queryClient = useQueryClient()
  const [tempoOpen, setTempoOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewPage, setPreviewPage] = useState(piece.thumbnailPage)
  // Captured right before mutate() fires, read in onSuccess — see
  // lib/minDuration.ts. Without this, the "Saving…" button label (and
  // this modal closing) resolves in ~1-15ms against this app's local
  // SQLite backend, faster than a browser paint, so the label is never
  // actually seen — same underlying bug as EditBookModal's stripe
  // animation never visibly playing.
  const saveStartedAtRef = useRef(0)
  // Drives the button's label/disabled state instead of
  // saveMutation.isPending directly — isPending flips to false the
  // instant the real request resolves, which on this app's fast local
  // backend is well before afterMinDuration lets onClose actually fire,
  // and would otherwise leave the button reading "Save" for a few
  // hundred idle-looking ms while the modal still hasn't closed.
  const [isSaving, setIsSaving] = useState(false)

  // "At most 50% of the modal" has to mean 50% of the dialog's actual
  // rendered height, not an approximation — a first vh-based version
  // drifted badly whenever the dialog wasn't sitting at its own
  // max-h-[90vh] cap (the common case: most content auto-sizes down
  // below 90vh), confirmed wrong in practice on a real 1118px-tall
  // dialog. CSS percentage-height can't solve this either — Modal's
  // dialog is auto-height, not a definite height, so a plain `%` has
  // nothing to resolve against.
  //
  // A second version measured the closed dialog's own rendered height
  // and still overshot 50% on real devices — two separate real bugs, not
  // just tuning:
  //
  // (1) Self-reference: opening the preview doesn't shrink anything else
  // to make room — Modal's header slot is shrink-0, so the dialog simply
  // grows by however tall the panel is. Sizing the panel to half of the
  // dialog as it existed *before* being added makes it a third of the
  // *grown* total, not a half (T = rest + panel; panel = rest/2 gives
  // panel/T = (rest/2)/(1.5*rest) = 1/3). Making the panel equal to
  // "rest" (not half of it) is what actually produces a 50/50 split of
  // the grown total: T = rest + panel = 2*rest, panel/T = 0.5.
  //
  // (2) The closed dialog's rendered height is frequently already less
  // than the true content it's showing — confirmed directly: on a dialog
  // whose fields alone already exceed Modal's max-h-[90vh] cap, the body
  // is already internally scrolling even with the preview collapsed, so
  // "closed dialog height" reads as the 90vh cap itself, not the fields'
  // real (larger) height. Sizing the panel off that number silently
  // treats an already-clipped quantity as if it were the true total, and
  // materially overshoots 50% of the actually-rendered dialog once
  // opened.
  //
  // The fix measures the pieces that make up "rest" directly, each
  // unclipped by Modal's own overflow ancestor (a plain child of an
  // overflow:auto parent still reports its own true natural height via
  // ResizeObserver, regardless of whether the *ancestor* is currently
  // clipping/scrolling it) — title block, the toggle row itself (only
  // while collapsed, so the panel's own height never feeds back into the
  // measurement), the scrollable fields area, and the footer:
  const [titleBlockRef, titleBlockHeight] = useMeasuredHeight()
  const [toggleRowRef, toggleRowHeight] = useMeasuredHeight(!previewOpen)
  const [fieldsRef, fieldsHeight] = useMeasuredHeight()
  const [footerRef, footerHeight] = useMeasuredHeight()

  const [viewportHeight, setViewportHeight] = useState(
    () => (typeof window === 'undefined' ? 800 : window.innerHeight),
  )
  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const dialogCapHeight = viewportHeight * 0.9 // matches Modal.tsx's max-h-[90vh]
  const preambleHeight = titleBlockHeight + toggleRowHeight
  const restHeight = preambleHeight + fieldsHeight + footerHeight
  // Uncapped case: panel = restHeight (see (1) above) gives an exact 50%
  // split of a grown-but-still-under-the-cap total (2*restHeight).
  // Capped case (2*restHeight would exceed the dialog's own ceiling):
  // the dialog pins at dialogCapHeight regardless — shrink-0 elements
  // (preamble, panel, footer) never compress to absorb the overflow, only
  // the scrollable fields area does — so hitting 50% of *that* fixed
  // total means solving preambleHeight + panel = 0.5 * dialogCapHeight
  // for panel directly, not deriving it from restHeight at all.
  const previewWrapperMaxHeight =
    restHeight * 2 <= dialogCapHeight
      ? restHeight
      : Math.max(0, dialogCapHeight / 2 - preambleHeight)
  const previewImageMaxHeight = Math.max(0, previewWrapperMaxHeight - 80)
  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    getValues,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: pieceToFormValues(piece) })

  useEffect(() => {
    if (open) {
      reset(pieceToFormValues(piece))
      // Reopening (possibly for a different piece) always resets to that
      // piece's own thumbnail page — carrying over a scrolled-to-page-4
      // state from whatever was last edited would be confusing, not a
      // convenience. Default open/closed state itself depends on viewport:
      // a viewport taller than 800px has room to show the preview without
      // it dominating the dialog, so it starts open there; shorter
      // viewports (and mobile) keep the original collapsed-by-default
      // behavior. Deliberately reads viewportHeight via closure rather than
      // listing it as a dependency — this should only decide the *opening*
      // state, not re-fire (and reset the whole form) on every resize while
      // the modal is already open.
      setPreviewOpen(viewportHeight > 800)
      setPreviewPage(piece.thumbnailPage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // People catalog (composer/arranger overhaul, Stage C) — reused
  // unpaginated as the Composer/Arranger TagComboBox's own option source,
  // same "small personal-library scale" assumption every other lookup
  // list here already makes.
  const { data: peopleOptions = [] } = useQuery({ queryKey: ['people'], queryFn: () => listPeople() })

  const sheetTypeSelectOptions = [
    { value: '', label: '—' },
    ...sheetTypeOptions.map((o) => ({ value: o.name, label: o.name })),
  ]

  const bpm = Number(watch('bpm'))
  const measureCount = Number(watch('measureCount'))
  const beatsPerMeasure = Number(watch('beatsPerMeasure'))
  const canCalculateDuration = bpm > 0 && measureCount > 0 && beatsPerMeasure > 0

  // Effective value first (the form's own live value, falling back to
  // the piece's already-resolved effective IMSLP number — inherited or
  // not, piece.imslpNumber.value is that resolution already), then
  // stripped of any "IMSLP" label the same way a real save would
  // normalize it, before checking it's actually just digits — same rule
  // ImslpAutofillButton's own comment documents.
  const effectiveImslpNumber = watch('imslpNumber') || piece.imslpNumber.value
  const isValidImslpNumber = /^\d+$/.test(stripImslpPrefix(effectiveImslpNumber).trim())
  const [imslpFetchState, setImslpFetchState] = useState<'idle' | 'fetching' | 'done'>('idle')
  // Which fields the *most recent* autofill actually touched — drives a
  // brief highlight ring so it's obvious which values just changed.
  const [imslpFilledFields, setImslpFilledFields] = useState<Set<string>>(new Set())

  const imslpMutation = useMutation({
    mutationFn: () => lookupImslp(stripImslpPrefix(effectiveImslpNumber).trim()),
    onSuccess: (info) => {
      const filled = new Set<string>()
      const current = getValues()
      // Only fields currently blank on the piece — this is meant to save
      // typing, not silently overwrite something already entered,
      // book-inherited or not (same rule as the design mockup this is
      // built from).
      // Composer is now an ordered Person list (composer/arranger
      // overhaul, Stage C) — IMSLP only ever resolves a single composer
      // name, appended as a placeholder-id entry the same way
      // TagComboBox's own "create new" affordance does; the real id is
      // resolved server-side by name on save, same as every other
      // find-or-create tag field.
      if (current.composer.length === 0 && info.composer) {
        setValue('composer', [{ id: -1, name: info.composer }])
        filled.add('composer')
      }
      if (!current.workOpusNumber && info.workOpusNumber) {
        setValue('workOpusNumber', info.workOpusNumber)
        filled.add('workOpusNumber')
      }
      if (!current.yearWritten && info.yearWritten) {
        setValue('yearWritten', info.yearWritten)
        filled.add('yearWritten')
      }
      if (!current.publisher && info.publisher) {
        setValue('publisher', info.publisher)
        filled.add('publisher')
      }
      if (!current.publisherId && info.publisherId) {
        setValue('publisherId', info.publisherId)
        filled.add('publisherId')
      }
      setImslpFilledFields(filled)
      setImslpFetchState('done')
      window.setTimeout(() => setImslpFetchState('idle'), 1400)
      window.setTimeout(() => setImslpFilledFields(new Set()), 2400)
    },
    onError: () => setImslpFetchState('idle'),
  })

  function handleImslpAutofill() {
    if (imslpFetchState !== 'idle' || !isValidImslpNumber) return
    setImslpFetchState('fetching')
    imslpMutation.mutate()
  }

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
    // The Date.now() capture lives here, not in onSubmit below — onSubmit
    // is passed straight into react-hook-form's handleSubmit(), which the
    // react-hooks/purity and react-hooks/refs lint rules can't statically
    // prove doesn't invoke it during render, so an impure call or ref
    // write there gets flagged even though it never actually runs until a
    // real submit event. mutationFn has no such ambiguity — react-query
    // only ever calls it from mutate(), well after render.
    mutationFn: (data: FormValues) => {
      saveStartedAtRef.current = Date.now()
      return updatePiece(piece.id, formValuesToWriteRequest(data, piece))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pieces'] })
      queryClient.invalidateQueries({ queryKey: ['piece'] })
      afterMinDuration(saveStartedAtRef.current, () => {
        setIsSaving(false)
        onClose()
      })
    },
    onError: () => setIsSaving(false),
  })

  function onSubmit(data: FormValues) {
    setIsSaving(true)
    saveMutation.mutate(data)
  }

  // Shift+Enter saves from anywhere in the form — including a field with
  // its own open dropdown (Key, Sheet Type, Instruments, Your Tags,
  // Source Book), which would
  // otherwise treat plain Enter as "pick the highlighted row" and never
  // reach a submit at all. Those fields' own handlers (TagComboBox/
  // SingleSelect/SourceBookField) explicitly skip Shift+Enter rather than
  // acting on it, so this handler is the only thing that fires — no
  // double effect of both picking an option and saving.
  function handleFormKeyDown(event: ReactKeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault()
      handleSubmit(onSubmit)()
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="edit-piece-title"
      size="lg"
      header={
        <div className="flex flex-col gap-3">
          <div ref={titleBlockRef} className="flex items-start justify-between gap-4">
            <div>
              <h2 id="edit-piece-title" className="font-display text-2xl font-medium text-ink">
                Edit piece
              </h2>
              <p className="text-sm text-ink-soft">{piece.title}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="mt-1 shrink-0 cursor-pointer text-ink-soft hover:text-accent"
            >
              <IconXFilled size={22} />
            </button>
          </div>

          {/* Page preview — pinned here (Modal's `header` slot) rather than
              inside the scrolling form, specifically so it can't scroll out
              of view while the fields below it do. Starts closed; toggling
              it open only adds height here, never changes the modal's
              width. Full-width image in its own capped-
              height scroll box (a portrait page at full modal width is
              taller than any reasonable fixed strip) with the plain below-
              image PageCycleControl underneath — not the Piece Details page's
              floating-capsule cycler, which overlaps the bottom of the page
              itself and could cover exactly the content (final measures, a
              signature, page numbers) someone opened the preview to check. */}
          {/* Toggle + collapsible panel share one non-gapped wrapper, not
              two direct children of the outer `gap-3` flex column — a
              flex `gap` reserves its full space between every pair of
              siblings regardless of whether one of them is visually
              collapsed to zero height, so treating the panel as a sibling
              of the toggle button (rather than nested under it) left a
              stray extra gap-3 worth of whitespace even while folded.

              border-b lives on THIS wrapper, not inside the collapsible
              panel below (where it used to be, conditional on
              previewOpen) — a border on the panel itself disappears along
              with everything else once max-h collapses to 0, so the
              header had no bottom edge at all in the (default) closed
              state, and the transition into the scrolling form content
              below read as abrupt once a user actually started scrolling.
              This wrapper never collapses, so the line is always there,
              right under the toggle button when closed and right under
              the preview when open.

              -mx-6 + px-6 (bleeding past this header's own padding, then
              adding it straight back as this element's own padding)
              full-bleeds the line to the dialog's true edges instead of
              stopping at the same content width as the fields below.
              Standard 1px weight (1.5px reads as more of a structural
              divider than intended; 1px plus the full-bleed already does
              that job). */}
          <div ref={toggleRowRef} className="-mx-6 border-b border-border px-6 pb-3">
            <button
              type="button"
              onClick={() => setPreviewOpen((o) => !o)}
              className="flex w-fit cursor-pointer items-center gap-1.5 rounded-full border border-border bg-paper px-3 py-1.5 text-xs text-ink-soft hover:text-ink"
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
              className="overflow-hidden transition-[max-height] duration-200 ease-in-out"
              style={{ maxHeight: previewOpen ? `${previewWrapperMaxHeight}px` : '0px' }}
            >
              {/* The header sits in Modal's shrink-0 header slot, so its
                  full open height comes straight out of the scrollable
                  form body's share of the 90vh dialog cap — a tall preview
                  eats into the fields' (Title, Composer, everything else)
                  own room. Image box capped at previewImageMaxHeight (see
                  the sizing block above this component for the full
                  derivation) — still has its own overflow-y-auto if more
                  detail is needed. Wrapper's own cap stays 80px above the
                  image box's, for the PageCycleControl row and padding
                  underneath. */}
              <div className="flex flex-col gap-2 pt-3 pb-1">
                <div
                  className="overflow-y-auto rounded-md border border-border bg-paper-sunken"
                  style={{ maxHeight: `${previewImageMaxHeight}px` }}
                >
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
        <div ref={footerRef} className="flex flex-col gap-2">
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
              className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="edit-piece-form"
              disabled={isSaving}
              className="cursor-pointer rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90 disabled:cursor-default disabled:opacity-60"
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      }
    >
      <form
        ref={fieldsRef}
        id="edit-piece-form"
        onSubmit={handleSubmit(onSubmit)}
        onKeyDown={handleFormKeyDown}
        className="flex flex-col gap-6"
      >
        <div className="flex flex-col gap-3">
          {/* Title/Year written share a row, 2/3-1/3 split (flex-[2]/
              flex-1) — Title is the field that actually needs the room;
              Year written is short by nature. */}
          <div className="flex flex-col gap-3 min-[525px]:flex-row">
            <div className="flex min-w-0 flex-[2] flex-col gap-1">
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
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor="f-year" className="text-sm text-ink-soft">
                Year written
              </label>
              <input
                id="f-year"
                placeholder={!watch('yearWritten') && piece.yearWritten.inherited ? piece.yearWritten.value : undefined}
                className={`rounded-md border border-border bg-paper-raised px-3 py-2 text-ink transition-shadow duration-700 placeholder:text-ink-soft/40 placeholder:italic ${imslpFilledFields.has('yearWritten') ? 'ring-2 ring-accent-on-dark' : ''}`}
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
          {/* min-[525px]:flex-row — the same fixed breakpoint every paired
              row in this form uses (see the Musical Details/Personal
              sections' own comments below for why fixed beats
              content-driven flex-wrap): every row must split to stacked
              layout at the same point, or the form visibly staggers as
              the modal narrows. min-w-0 (not the old min-w-[250px] floor)
              so Composer can shrink freely once stacked and paired
              side-by-side above 525px alike. */}
          <div className="flex flex-col gap-3 min-[525px]:flex-row">
            <div className="min-w-0 flex-1">
              <Controller
                name="composer"
                control={control}
                render={({ field }) => (
                  <TagComboBox
                    label="Composer"
                    options={peopleOptions}
                    selected={field.value}
                    multiple
                    onChange={field.onChange}
                    pillStyle="paper"
                    newOptionLabel="New person"
                    highlighted={imslpFilledFields.has('composer')}
                    bookValue={
                      piece.composer.inherited ? piece.composer.values.map((p) => p.name).join(', ') : undefined
                    }
                    onCopy={() => field.onChange(piece.composer.values)}
                  />
                )}
              />
            </div>
            <div className="min-w-0 flex-1">
              <Controller
                name="arranger"
                control={control}
                render={({ field }) => (
                  <TagComboBox
                    label="Arranger"
                    options={peopleOptions}
                    selected={field.value}
                    multiple
                    onChange={field.onChange}
                    pillStyle="paper"
                    newOptionLabel="New person"
                    bookValue={
                      piece.arranger.inherited ? piece.arranger.values.map((p) => p.name).join(', ') : undefined
                    }
                    onCopy={() => field.onChange(piece.arranger.values)}
                  />
                )}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <SectionHeading>Frontmatter</SectionHeading>
          {/* Opus / IMSLP no. share a row, 50/50 — min-[525px]:flex-row,
              same unified breakpoint as every other paired row in this
              form (see Composer/Arranger above). Year written moved up to
              pair with Title instead (2/3-1/3 split, see that row's own
              comment above). */}
          <div className="flex flex-col gap-3 min-[525px]:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor="f-opus" className="flex items-center gap-1 text-sm text-ink-soft">
                Opus / catalog no.
                <InfoTooltip
                  message="If this piece is part of a larger work which has a number assigned, enter that number."
                  ariaLabel="What Opus / catalog no. means"
                  // Solid pre-blend, not opacity — IconInfoCircle is
                  // multi-path, a translucent color double-blends at the
                  // overlaps.
                  triggerClassName="text-[#9d9892] hover:text-ink-soft"
                >
                  <IconInfoCircle size={13} />
                </InfoTooltip>
              </label>
              <input
                id="f-opus"
                className={`rounded-md border border-border bg-paper-raised px-3 py-2 text-ink transition-shadow duration-700 ${imslpFilledFields.has('workOpusNumber') ? 'ring-2 ring-accent-on-dark' : ''}`}
                {...register('workOpusNumber', { maxLength: 255 })}
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor="f-imslp" className="text-sm text-ink-soft">
                IMSLP no.
              </label>
              {/* relative + pr-9 reserve room for ImslpAutofillButton
                  inside the input itself — same placement as a password
                  field's show/hide toggle. Always rendered, not shown-
                  only-when-present — see ImslpAutofillButton's own
                  comment for why the cloud-off state matters just as much
                  as the fetchable one. */}
              <div className="relative">
                <input
                  id="f-imslp"
                  placeholder={!watch('imslpNumber') && piece.imslpNumber.inherited ? piece.imslpNumber.value : undefined}
                  className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 pr-9 text-ink placeholder:text-ink-soft/40 placeholder:italic"
                  {...register('imslpNumber', { maxLength: 255 })}
                />
                <ImslpAutofillButton
                  state={imslpFetchState}
                  valid={isValidImslpNumber}
                  onClick={handleImslpAutofill}
                />
              </div>
              {!watch('imslpNumber') && piece.imslpNumber.inherited && (
                <InheritedNote
                  bookValue={piece.imslpNumber.value}
                  onCopy={() => setValue('imslpNumber', piece.imslpNumber.value)}
                />
              )}
              {imslpMutation.isError && (
                <p className="text-sm text-red-700">
                  {imslpMutation.error instanceof ApiError
                    ? imslpMutation.error.message
                    : 'Could not reach IMSLP.'}
                </p>
              )}
            </div>
          </div>
          {/* Publisher/Publisher ID deliberately never wraps to separate
              rows, unlike the min-width-floor pairs above — both shrink
              freely (min-w-0 overrides the flex default of refusing to
              shrink below content width), so the pair always fits on one
              line even on a narrow phone viewport. Plain 50/50 split
              (flex-1/flex-1, not the old fixed-width Publisher ID). */}
          <div className="flex gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor="f-publisher" className="text-sm text-ink-soft">
                Publisher
              </label>
              <input
                id="f-publisher"
                placeholder={!watch('publisher') && piece.publisher.inherited ? piece.publisher.value : undefined}
                className={`w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink transition-shadow duration-700 placeholder:text-ink-soft/40 placeholder:italic ${imslpFilledFields.has('publisher') ? 'ring-2 ring-accent-on-dark' : ''}`}
                {...register('publisher', { maxLength: 255 })}
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor="f-publisher-id" className="flex items-center gap-1 text-sm text-ink-soft">
                Publisher ID
                <InfoTooltip
                  message="Publisher serial or engraving plate number. Typically found in bottom margin notes."
                  ariaLabel="What Publisher ID means"
                  // Solid pre-blend, not opacity — IconInfoCircle is
                  // multi-path, a translucent color double-blends at the
                  // overlaps.
                  triggerClassName="text-[#9d9892] hover:text-ink-soft"
                >
                  <IconInfoCircle size={13} />
                </InfoTooltip>
              </label>
              <input
                id="f-publisher-id"
                placeholder={
                  !watch('publisherId') && piece.publisherId.inherited ? piece.publisherId.value : undefined
                }
                className={`w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink transition-shadow duration-700 placeholder:text-ink-soft/40 placeholder:italic ${imslpFilledFields.has('publisherId') ? 'ring-2 ring-accent-on-dark' : ''}`}
                {...register('publisherId', { maxLength: 255 })}
              />
            </div>
          </div>
          {!watch('publisher') &&
            !watch('publisherId') &&
            piece.publisher.inherited &&
            piece.publisherId.inherited && (
              <InheritedNote
                bookValue={`${piece.publisher.value} • ${piece.publisherId.value}`}
                onCopy={() => {
                  setValue('publisher', piece.publisher.value)
                  setValue('publisherId', piece.publisherId.value)
                }}
              />
            )}
          <div className="flex flex-col gap-1">
            <label htmlFor="f-description" className="text-sm text-ink-soft">
              Description <span className="text-ink-soft/60 italic">(Markdown supported)</span>
            </label>
            <textarea
              id="f-description"
              rows={3}
              className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              {...register('description')}
            />
          </div>
        </div>

        {/* Musical Details: Sheet type/Instruments, then Key(s)/Duration
            plus the tempo-calc disclosure tied to Duration. Your Tags
            lives in Personal instead — it's the user's own organizational
            label, not a musical-classification fact about the piece. */}
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <SectionHeading>Musical Details</SectionHeading>
          {/* Sheet Type/Instruments share a row, first in this section.
              min-[525px]:flex-row — same unified breakpoint as every other
              paired row in this form (see Composer/Arranger above). */}
          <div className="flex flex-col gap-3 min-[525px]:flex-row">
            <div className="min-w-0 flex-1">
              <Controller
                name="sheetType"
                control={control}
                render={({ field }) => (
                  <SingleSelect
                    label="Sheet type"
                    options={sheetTypeSelectOptions}
                    value={field.value}
                    onChange={field.onChange}
                    bookValue={
                      piece.sheetType.inherited ? (piece.sheetType.value?.name ?? undefined) : undefined
                    }
                    onCopy={() => field.onChange(piece.sheetType.value?.name ?? '')}
                  />
                )}
              />
            </div>
            <div className="min-w-0 flex-1">
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
            </div>
          </div>

          {/* Key(s)/Duration share a row — Key(s) grows (it can hold an
              arbitrary-length modulation sequence), Duration keeps its
              fixed width (w-48, matching Publisher ID's split point above)
              on the right. Stacks to its own row at narrow widths (unlike
              Publisher/Publisher ID, which never wraps) — Key(s) genuinely
              needs room a phone viewport can't spare next to a fixed-width
              Duration.

              min-[525px]:flex-row (the Edit Book modal's own breakpoint,
              also used by the Personal section's split below) instead of
              content-driven flex-wrap — deliberately, so the disclosure
              below can key off this exact same breakpoint to match
              Duration's own alignment in both states. flex-wrap's wrap
              point depends on how many keys are selected (an unrelated
              sibling's content), which made it impossible for a plain CSS
              rule elsewhere to reliably tell which state Duration was in;
              a fixed breakpoint sidesteps that entirely. Below 525px,
              Duration is a plain stacked block — flex's default
              align-items:stretch doesn't override its own explicit width
              (w-1/2 there, see its own div below), so it sits at the
              column's natural start (left), matching every other stacked
              field in this form. */}
          <div className="flex flex-col gap-3 min-[525px]:flex-row">
            <div className="min-w-0 flex-1">
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
            </div>
            {/* Duration — manually entered as mm:ss (this input's whole
                reason to exist), stored server-side as an integer of
                seconds; the frontend only ever shows/accepts mm:ss.
                w-1/2 while stacked on its own row below 525px (a bare
                fixed-width box floating alone on an otherwise full-width
                narrow form read as oddly small) — min-[525px]:w-48
                restores the fixed width once it's paired with Key(s)
                again, matching Publisher ID's split point. */}
            <div className="flex w-1/2 flex-col gap-1 min-[525px]:w-48 min-[525px]:shrink-0">
              <label htmlFor="f-duration" className="text-sm text-ink-soft">
                Duration (mm:ss)
              </label>
              <input
                id="f-duration"
                placeholder="e.g. 3:45"
                className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                {...register('duration', {
                  pattern: { value: /^\d+:[0-5]\d$/, message: 'Enter duration as mm:ss (e.g. 3:45).' },
                })}
              />
              {errors.duration && <p className="text-sm text-red-700">{errors.duration.message}</p>}
            </div>
          </div>

          {/* Tempo-calc disclosure — matches Duration's own alignment at
              the same min-[525px] breakpoint the row above uses: left (the
              default, no class needed) while Duration is stacked below
              Key(s), right-aligned once Duration sits paired on the right
              of that row. The revealed BPM/Measures/Beats/Calculate row
              follows the same split. Same chevron + text-xs/60 convention
              as the Piece Details page's own "Tempo details" disclosure
              (PiecePage.tsx), which is itself commented as matching this
              edit menu; duration is what matters day-to-day, the calc
              fields are a supporting, occasionally-needed alternate path
              to it. */}
          <div className="flex flex-col items-start gap-2 min-[525px]:items-end">
            <button
              type="button"
              onClick={() => setTempoOpen((o) => !o)}
              // Solid pre-blend (icon + label share one color) — identical
              // against a static background either way for the text half,
              // but the chevron icon needs it.
              className="flex cursor-pointer items-center gap-1 text-xs text-[#9d9892] hover:text-ink-soft"
            >
              <IconChevronRight
                size={12}
                className={`transition-transform ${tempoOpen ? 'rotate-90' : ''}`}
              />
              Calculate from tempo
            </button>
            {tempoOpen && (
              <div className="flex flex-wrap items-end gap-3 min-[525px]:justify-end">
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
                  className="cursor-pointer rounded-md border border-border bg-paper-raised px-3 py-2 font-display text-sm text-ink hover:border-accent disabled:pointer-events-none disabled:cursor-default disabled:opacity-40"
                >
                  Calculate
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Personal — Your Tags lives here, not Musical Details (it's the
            user's own organizational label, not a musical fact about the
            piece). Two-column split inspired by the Edit Book modal's own
            closing IMSLP/Sheet Type/Instruments-vs-Description row:
            Practice status/Your tags stacked on the left, Your notes
            spanning the same height on the right — the one genuinely tall
            field gets the one genuinely tall column. min-[525px]:flex-row
            matches every other paired row in this form, so the whole
            modal splits to stacked layout at one unified breakpoint
            instead of each row wrapping at its own content-driven
            threshold. */}
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <SectionHeading>Personal</SectionHeading>
          <div className="flex flex-col gap-3 min-[525px]:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-4">
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
              <Controller
                name="userTags"
                control={control}
                render={({ field }) => (
                  <TagComboBox
                    label="Your tags"
                    options={userTagOptions}
                    selected={field.value}
                    multiple
                    onChange={field.onChange}
                  />
                )}
              />
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
              <label htmlFor="f-notes" className="text-sm text-ink-soft">
                Your notes <span className="text-ink-soft/60 italic">(Markdown supported)</span>
              </label>
              <textarea
                id="f-notes"
                rows={2}
                className="min-h-[96px] flex-1 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                {...register('userNotes')}
              />
            </div>
          </div>
        </div>

        {/* Book Details — the Source Book search field, plus the page
            range. Moved to the very end of the form: it's about where
            this piece lives inside its source book, not a fact about the
            piece itself the way every section above it is, so it reads
            last rather than competing with the piece's own bibliographic
            fields for early attention. Source Book itself still sits
            above the page range within this section — picking a
            different book is the thing that makes "page 22–24 of what?"
            answerable, so it still reads first within the section even
            though the section itself moved. key={piece.id} forces a full
            remount (resetting the field's internal search-query text)
            whenever this modal is reused for a different piece, rather
            than only when it unmounts. */}
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <SectionHeading>Book Details</SectionHeading>
          <Controller
            name="sourceBookId"
            control={control}
            render={({ field }) => (
              <SourceBookField
                key={piece.id}
                value={field.value}
                onChange={field.onChange}
                initialTitle={piece.sourceBookTitle ?? null}
              />
            )}
          />
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="f-page-start" className="text-sm text-ink-soft">
                Start page
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
                End page
              </label>
              <input
                id="f-page-end"
                type="number"
                className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
                {...register('sourcePageEnd')}
              />
            </div>
          </div>
        </div>
      </form>
    </Modal>
  )
}
