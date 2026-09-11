import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
} from 'react'
import {
  Controller,
  useForm,
  useFormState,
  type Control,
  type UseFormGetValues,
  type UseFormRegister,
  type UseFormTrigger,
} from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconLetterCase,
  IconX,
} from '@tabler/icons-react'
import { getBookPageThumbnailUrl } from '../api/books'
import { listPeople } from '../api/people'
import type { Tag } from '../api/types'
import { PageLightbox } from '../components/PageLightbox'
import { TagComboBox } from '../components/TagComboBox'
import { autosizeTextarea, preventTextareaNewline } from '../lib/autosizeTextarea'
import type { Piece } from '../lib/pieceSplitLogic'
import { nameCase, titleCase } from '../lib/textCase'
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
// to-preview overlay. Browses the *whole book* by raw physical page, not
// just the pieces — it originally cycled between pieces only (prev/next
// meant "the piece before/after this one"), which
// displayed a piece index as if it were a page number and made it
// impossible to check a skipped page without leaving this screen and
// going back to the Split step. A user reviewing piece names still needs
// to be able to flip through every page, including skipped ones, in case
// the split itself was wrong.

const CURRENT_STEP = 5
// Deliberately NOT the app's own `md:` breakpoint (768px, Sidebar.tsx/
// MobileNav.tsx) — found live building UploadBookTitlesMockup.tsx's own
// two-tier row layout (Option A of a density-comparison artifact, see
// CLAUDE.md's Book Upload Wizard entry): at exactly 768px both the
// sidebar (256px) and this row's own Composer/Arranger split turned on at
// the same instant, which is the worst possible moment for the split —
// the sidebar has just claimed its full width and the fields column has
// its least room, producing a visibly cramped ~150px-wide field. Set
// wider so the two-column split only engages once there's still real
// room left over after the sidebar appears.
const DESKTOP_BREAKPOINT_PX = 1024

// Academic p./pp. convention app-wide (singular vs. a range), same as
// PiecePage.tsx/BookDetailsPage.tsx — this row label had drifted to a
// bare "pp" with no period and no singular form. Displays the
// printed-PDF-offset-adjusted range (matching what actually gets written
// to SourcePageStart/SourcePageEnd at import) rather than the raw
// physical position.
function formatPieceLabel(piece: Piece, pageOffset: number) {
  const start = piece.start + pageOffset
  const end = piece.end + pageOffset
  return end !== start ? `pp. ${start}–${end}` : `p. ${start}`
}

interface FormValues {
  pieces: { title: string; composer: Tag[]; arranger: Tag[] }[]
}

// Real bug found live-testing the perf fix below (a genuine, pre-existing
// data-loss bug, not something the perf refactor introduced — confirmed
// against git history): every "flush to the wizard's lifted pieceFields"
// call site passed `getValues().pieces` straight through. react-hook-form
// doesn't necessarily hand back a fresh array/object graph on every
// getValues() call — for fields that still trace back to this form's own
// `defaultValues` (itself literally `pieceFields` from BookUploadWizard,
// passed in uncloned), RHF can return a reference that's the *same
// object* already sitting in the wizard's own React state, mutated in
// place as more fields change. The first flush after mount looks fine (a
// genuinely new array vs. the initial empty one, so React re-renders
// normally) — but once that first flush's reference gets adopted into
// parent state, every *later* flush can hand back that exact same
// reference, and React's setState bails out on `Object.is(new, old)`
// without re-rendering, even though the array's own contents have moved
// on. Confirmed live via instrumentation: `getValues().pieces ===
// pieceFields` was `true` starting from a row's second edit onward, and
// the wizard's own pieceFields state (and therefore the localStorage
// draft) silently stopped updating from that point on — while the DOM/
// RHF's own live values stayed correct throughout, so it read as "typing
// still works, but autosave randomly stops," matching a real user report
// of "hit or miss, only a word here or there" gets saved. Fix: every
// flush clones both the array and each piece object fresh, so the
// reference handed to setPieceFields can never alias anything RHF might
// still be mutating.
function clonePieces(pieces: FormValues['pieces']): FormValues['pieces'] {
  return pieces.map((p) => ({ ...p }))
}

// Pulled out of the row-render body (originally private closures inside
// this component) so DesktopPieceRow/MobilePieceRow below can call them
// with their own row-scoped `index`, without needing the whole component
// re-created per row — register/getValues/trigger are stable RHF
// references, so these are cheap plain functions, not hooks.
//
// Same immediate-flush-on-blur reasoning the Composer/Arranger
// TagComboBox fields flush on every onChange for: the debounced watch()
// autosave in BookUploadTitlesStep (300ms after the last keystroke)
// already covers "still typing when the tab crashes," but leaves a real,
// if narrow, race — a keystroke followed by a reload/navigation within
// that 300ms window wouldn't have flushed yet. A field's onBlur is a hard
// guarantee independent of the timer.
function titleFieldProps(
  register: UseFormRegister<FormValues>,
  getValues: UseFormGetValues<FormValues>,
  onFieldFlush: (pieces: FormValues['pieces']) => void,
  index: number,
) {
  const registered = register(`pieces.${index}.title`, { required: true, maxLength: 255 })
  return {
    ...registered,
    ref: (el: HTMLTextAreaElement | null) => {
      registered.ref(el)
      autosizeTextarea(el)
    },
    onChange: (event: ChangeEvent<HTMLTextAreaElement>) => {
      void registered.onChange(event)
      autosizeTextarea(event.currentTarget)
    },
    onBlur: (event: FocusEvent<HTMLTextAreaElement>) => {
      registered.onBlur(event)
      onFieldFlush(clonePieces(getValues().pieces))
    },
  }
}

// Composer and Arranger validate each other: either one having at least
// one person satisfies both — but only when requireComposerOrArranger is
// true in the first place. This checks *presence* only (does the array
// have anything in it), not format — TagComboBox's own "pick existing or
// create new" flow can't produce a blank/malformed entry.
function composerOrArrangerRules(
  getValues: UseFormGetValues<FormValues>,
  requireComposerOrArranger: boolean,
  field: 'composer' | 'arranger',
  index: number,
) {
  const other = field === 'composer' ? 'arranger' : 'composer'
  return {
    validate: (value: Tag[]) =>
      !requireComposerOrArranger ||
      value.length > 0 ||
      getValues(`pieces.${index}.${other}`).length > 0 ||
      'Composer or arranger required',
  }
}

// Every prop here must be reference-stable across a re-render caused by
// editing a *different* row, or the React.memo wrapper on the two row
// components below can't bail out of re-rendering — the entire reason
// they're memoized in the first place (see the perf note above
// DesktopPieceRow). `control`/`register`/`getValues`/`trigger` are all
// stable per react-hook-form's own API contract; `piece` is stable
// because BookUploadWizard.tsx memoizes the `pieces` array it computes
// this from; `onFieldFlush` is the wizard's plain useState setter
// (setPieceFields), also stable; `setPreviewPage` is this component's own
// useState setter.
interface PieceRowProps {
  control: Control<FormValues>
  index: number
  piece: Piece
  bookId: number
  pageOffset: number
  showComposerField: boolean
  showArrangerField: boolean
  requireComposerOrArranger: boolean
  peopleOptions: Tag[]
  register: UseFormRegister<FormValues>
  getValues: UseFormGetValues<FormValues>
  trigger: UseFormTrigger<FormValues>
  onFieldFlush: (pieces: FormValues['pieces']) => void
  setPreviewPage: (page: number) => void
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

// Desktop-only hover popover trigger + popup, pulled into its own
// component (not inlined in the row map below) specifically so each row
// can own independent position/hover state via hooks — a plain useState
// inside the .map() callback would be one shared value fighting over
// every row instead of one per row.
//
// position: fixed with JS-computed viewport coordinates, not position:
// absolute anchored to the trigger's own relative parent (the first,
// simpler version of this fix, tried and reverted after two real bugs
// surfaced building it out from the locked mockup):
//
// 1. An absolutely-positioned popup — even one only mounted while
//    hovering, even one whose clamp math is provably correct — still
//    contributes its transformed bounds to its nearest *scrolling*
//    ancestor's scrollable-overflow region for as long as it's mounted.
//    Confirmed: this wizard's row list sits inside AppShell's
//    own scroll container, and mounting/positioning the popup measurably
//    changed that container's scrollHeight (677px → 712px in one real
//    trace). If the container's scrollTop needs to be re-clamped to a
//    new, smaller max as a result, the resulting scroll adjustment can
//    silently cancel out the popup's own on-screen position correction —
//    or, worse, changing scroll position under a *stationary* mouse
//    changes what element is actually under the cursor, which can
//    trigger a mouseleave → unmount → scrollHeight-shrinks-back →
//    mouseenter-again oscillation (confirmed independently: the popup
//    mounting and unmounting in a tight loop, multiple times a second,
//    for a row positioned exactly where this could happen).
// 2. position: fixed removes the popup from any ancestor's scrollable
//    content entirely, regardless of size or position — the same reason
//    PageLightbox.tsx and Modal.tsx's own backdrops (also fixed) never
//    hit this class of bug. No portal needed to get that guarantee here:
//    a fixed-position descendant only gets trapped by an *ancestor*
//    establishing its own containing block (transform/filter/perspective
//    — the exact bug BookUploadAboutStep.tsx's lightbox hit from a
//    sticky ancestor, fixed earlier), and nothing between this component
//    and the document root does that.
//
// Position is computed in two passes, both before the browser's first
// paint of the popup (useLayoutEffect, not useEffect): the popup mounts
// top-aligned with the trigger first (a safe placement that needs no
// foreknowledge of the popup's own height, since a portrait-ish page
// image's rendered height depends on its real aspect ratio), then this
// effect measures its actual rendered height and recenters it on the
// trigger — clamped to the viewport, nudging up/down only as much as
// needed to clear whichever edge it would've clipped. The popup's own
// max-height (see its own comment below) keeps it from ever being taller
// than the viewport in the first place, so this clamp always has enough
// room to satisfy both edges — no top-vs-bottom priority call needed.
function HoverPagePreview({
  piece,
  bookId,
  onPreview,
}: {
  piece: Piece
  bookId: number
  onPreview: () => void
}) {
  const [hovering, setHovering] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!hovering) return
    const trigger = triggerRef.current
    if (!trigger) return
    const triggerRect = trigger.getBoundingClientRect()
    const left = triggerRect.right + 8
    // First pass: top-aligned with the trigger — doesn't require knowing
    // the popup's own height, so it's safe to render before the popup
    // (and its image) has ever been measured.
    if (!pos) {
      setPos({ top: triggerRect.top, left })
      return
    }
    // Second pass: the popup is now in the DOM at that first-guess
    // position — measure its real height and recenter/clamp against it.
    const popup = popupRef.current
    if (!popup) return
    const margin = 8
    const popupHeight = popup.getBoundingClientRect().height
    let top = triggerRect.top + triggerRect.height / 2 - popupHeight / 2
    const viewportBottom = window.innerHeight - margin
    if (top + popupHeight > viewportBottom) {
      top = viewportBottom - popupHeight
    }
    if (top < margin) {
      top = margin
    }
    if (top !== pos.top) setPos({ top, left })
  }, [hovering, pos])

  function handleLeave() {
    setHovering(false)
    setPos(null)
  }

  return (
    <div onMouseEnter={() => setHovering(true)} onMouseLeave={handleLeave}>
      {/* Masked to the same aspect-[180/132] top-of-page crop the Piece
          Library grid cards use (PieceGridCard.tsx) — same treatment as
          the mobile thumb elsewhere on this screen, just a different
          fixed width (88px column here vs. mobile's own 115px). The
          per-piece color border stays: it's this wizard's own continuity
          cue tying a piece back to its Split-step color, not decorative
          chrome to drop for the sake of matching. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={onPreview}
        title="Tap to preview page"
        className="relative block aspect-[180/132] w-full cursor-pointer overflow-hidden rounded-lg"
        style={{ border: `1.5px solid ${piece.color}` }}
      >
        <img
          src={getBookPageThumbnailUrl(bookId, piece.start)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover object-top"
        />
      </button>
      {/* No fade-in transition (the pre-portal version's opacity-0 ->
          group-hover:opacity-100 is gone along with group-hover itself,
          since visibility is now driven by the `hovering` state, not
          CSS): mounting straight into an animated opacity change here
          would mean a *third* render pass on top of the two the position
          fix already needs, for a purely cosmetic touch — not worth the
          extra fragility this component has already shown once. */}
      {hovering && pos && (
        <div
          ref={popupRef}
          style={{ border: `2px solid ${piece.color}`, top: pos.top, left: pos.left }}
          className="pointer-events-none fixed z-20 overflow-hidden rounded-md shadow-xl"
        >
          {/* max-w/max-h (not a fixed width) — a full-page image at 420px
              wide can render taller than a short viewport, which the
              position clamp below can reposition around but never fully
              avoid clipping once the popup is simply taller than the
              screen. w-auto/h-auto are load-bearing, not redundant with
              the max- versions: without an explicit auto basis, the
              browser has no clear starting size to apply the max-
              constraints against and the image can collapse to ~0.
              Capping both dimensions this way lets the browser's own
              default replaced-element scaling shrink the image
              proportionally (no object-fit needed) so the popup is now
              *always* small enough to fit before the position clamp ever
              runs, so that clamp never hits its old "bottom has to win,
              something clips" case. */}
          <img
            src={getBookPageThumbnailUrl(bookId, piece.start)}
            alt=""
            className="block h-auto w-auto max-h-[calc(100vh-16px)] max-w-[420px]"
          />
        </div>
      )}
    </div>
  )
}

// Perf fix (real report: "lags with 200+ pieces, eventually slows to a
// crawl as the user fills it all out"). Originally every row lived inline
// in one big pieces.map() inside BookUploadTitlesStep's own render, and
// the component read `formState: { errors }` at the top — a subscription
// to the *entire* form's error object. With that shape, editing a single
// field anywhere (a keystroke's validation, a blur, a composer/arranger
// pick) forced React to reconcile every row's JSX on every single edit,
// including 200+ TagComboBox/Controller instances and their own
// re-renders — the cost scaled with total piece count, not with what
// actually changed, which is exactly why it got worse the further into a
// large book someone got (more rows mounted, same full-list reconciliation
// on every keystroke).
//
// Fix, the standard react-hook-form pattern for large dynamic lists:
// isolate each row into its own component, wrap it in React.memo, and
// scope its error subscription to just its own three fields via
// useFormState({ name: [...] }) instead of the parent's blanket
// `formState.errors`. Now an edit to row 173 only re-renders row 173 —
// see PieceRowProps' own comment above for what has to stay reference-
// stable for the memo to actually take effect.
const DesktopPieceRow = memo(function DesktopPieceRow({
  control,
  index,
  piece,
  bookId,
  pageOffset,
  showComposerField,
  showArrangerField,
  requireComposerOrArranger,
  peopleOptions,
  register,
  getValues,
  trigger,
  onFieldFlush,
  setPreviewPage,
}: PieceRowProps) {
  const { errors } = useFormState({
    control,
    name: [`pieces.${index}.title`, `pieces.${index}.composer`, `pieces.${index}.arranger`],
  })
  const titleError = errors.pieces?.[index]?.title
  const composerError = errors.pieces?.[index]?.composer
  const arrangerError = errors.pieces?.[index]?.arranger

  return (
    <div className={`flex gap-3.5 px-3 py-3 ${index % 2 === 0 ? 'bg-paper-sunken' : ''}`}>
      <div className="flex w-28 shrink-0 flex-col gap-1.5">
        <HoverPagePreview
          piece={piece}
          bookId={bookId}
          onPreview={() => setPreviewPage(piece.start)}
        />
        <span className="text-xs text-ink-soft">
          Piece {index + 1} • {formatPieceLabel(piece, pageOffset)}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="min-w-0">
          <label className="mb-1 block text-sm text-ink-soft">
            Title <span className="text-red-700">*</span>
          </label>
          <textarea
            rows={1}
            className={`w-full resize-none overflow-hidden rounded-md border bg-paper-raised px-2.5 py-[11px] text-sm text-ink ${
              titleError ? 'border-red-700' : 'border-border'
            }`}
            placeholder="Title"
            onKeyDown={preventTextareaNewline}
            {...titleFieldProps(register, getValues, onFieldFlush, index)}
          />
          {titleError && (
            <span className="mt-0.5 flex items-center gap-1 text-xs text-red-700">
              <IconAlertTriangle size={10} />
              Required
            </span>
          )}
        </div>
        {showComposerField && (
          <div className="flex gap-2.5">
            <div className="min-w-0 flex-1">
              <Controller
                name={`pieces.${index}.composer`}
                control={control}
                rules={composerOrArrangerRules(getValues, requireComposerOrArranger, 'composer', index)}
                render={({ field }) => (
                  <TagComboBox
                    label="Composer"
                    options={peopleOptions}
                    selected={field.value}
                    multiple
                    onChange={(next) => {
                      field.onChange(next)
                      void trigger(`pieces.${index}.arranger`)
                      onFieldFlush(clonePieces(getValues().pieces))
                    }}
                    pillStyle="paper"
                    newOptionLabel="New person"
                  />
                )}
              />
              {composerError && (
                <span className="mt-0.5 flex items-center gap-1 text-xs text-red-700">
                  <IconAlertTriangle size={10} />
                  {composerError.message}
                </span>
              )}
            </div>
            {showArrangerField && (
              <div className="min-w-0 flex-1">
                <Controller
                  name={`pieces.${index}.arranger`}
                  control={control}
                  rules={composerOrArrangerRules(getValues, requireComposerOrArranger, 'arranger', index)}
                  render={({ field }) => (
                    <TagComboBox
                      label="Arranger"
                      options={peopleOptions}
                      selected={field.value}
                      multiple
                      onChange={(next) => {
                        field.onChange(next)
                        void trigger(`pieces.${index}.composer`)
                        onFieldFlush(clonePieces(getValues().pieces))
                      }}
                      pillStyle="paper"
                      newOptionLabel="New person"
                    />
                  )}
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
        )}
      </div>
    </div>
  )
})

// Mobile counterpart — same per-row isolation, no HoverPagePreview (touch
// has no hover; the tap-to-open overlay below is its equivalent), stacked
// Composer/Arranger instead of a side-by-side split.
const MobilePieceRow = memo(function MobilePieceRow({
  control,
  index,
  piece,
  bookId,
  pageOffset,
  showComposerField,
  showArrangerField,
  requireComposerOrArranger,
  peopleOptions,
  register,
  getValues,
  trigger,
  onFieldFlush,
  setPreviewPage,
}: PieceRowProps) {
  const { errors } = useFormState({
    control,
    name: [`pieces.${index}.title`, `pieces.${index}.composer`, `pieces.${index}.arranger`],
  })
  const titleError = errors.pieces?.[index]?.title
  const composerError = errors.pieces?.[index]?.composer
  const arrangerError = errors.pieces?.[index]?.arranger

  return (
    <div
      className={`flex items-start gap-3.5 px-4 py-3.5 ${index % 2 === 0 ? 'bg-paper-sunken' : ''}`}
    >
      {/* Piece label sits under the thumbnail, same stacked media column
          as the desktop layout. */}
      <div className="flex w-[115px] shrink-0 flex-col gap-1.5">
        <button
          type="button"
          onClick={() => setPreviewPage(piece.start)}
          title="Tap to preview page"
          className="relative aspect-[180/132] w-full cursor-pointer overflow-hidden rounded-lg"
          style={{ border: `1.5px solid ${piece.color}` }}
        >
          <img
            src={getBookPageThumbnailUrl(bookId, piece.start)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover object-top"
          />
        </button>
        <span className="text-sm text-ink-soft">
          Piece {index + 1} • {formatPieceLabel(piece, pageOffset)}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div>
          <label className="mb-1 block text-sm text-ink-soft">
            Title <span className="text-red-700">*</span>
          </label>
          <textarea
            rows={1}
            className={`w-full resize-none overflow-hidden rounded-md border bg-paper-raised px-3 py-2 text-base text-ink ${
              titleError ? 'border-red-700' : 'border-border'
            }`}
            placeholder="Title"
            onKeyDown={preventTextareaNewline}
            {...titleFieldProps(register, getValues, onFieldFlush, index)}
          />
          {titleError && (
            <span className="mt-1 flex items-center gap-1 text-xs text-red-700">
              <IconAlertTriangle size={10} />
              Required
            </span>
          )}
        </div>
        {showComposerField && (
          <div>
            <Controller
              name={`pieces.${index}.composer`}
              control={control}
              rules={composerOrArrangerRules(getValues, requireComposerOrArranger, 'composer', index)}
              render={({ field }) => (
                <TagComboBox
                  label="Composer"
                  options={peopleOptions}
                  selected={field.value}
                  multiple
                  onChange={(next) => {
                    field.onChange(next)
                    void trigger(`pieces.${index}.arranger`)
                    onFieldFlush(clonePieces(getValues().pieces))
                  }}
                  pillStyle="paper"
                  newOptionLabel="New person"
                />
              )}
            />
            {composerError && (
              <span className="mt-1 flex items-center gap-1 text-xs text-red-700">
                <IconAlertTriangle size={10} />
                {composerError.message}
              </span>
            )}
          </div>
        )}
        {showArrangerField && (
          <div>
            <Controller
              name={`pieces.${index}.arranger`}
              control={control}
              rules={composerOrArrangerRules(getValues, requireComposerOrArranger, 'arranger', index)}
              render={({ field }) => (
                <TagComboBox
                  label="Arranger"
                  options={peopleOptions}
                  selected={field.value}
                  multiple
                  onChange={(next) => {
                    field.onChange(next)
                    void trigger(`pieces.${index}.composer`)
                    onFieldFlush(clonePieces(getValues().pieces))
                  }}
                  pillStyle="paper"
                  newOptionLabel="New person"
                />
              )}
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
})

interface BookUploadTitlesStepProps {
  bookId: number
  bookComposer: string | null
  bookArranger: string | null
  bookImslpNumber: string | null
  pageOffset: number
  pageCount: number
  pieces: Piece[]
  pieceFields: { title: string; composer: Tag[]; arranger: Tag[] }[]
  onChange: (fields: { title: string; composer: Tag[]; arranger: Tag[] }[]) => void
  onBack: () => void
  onNext: () => void
  onCancel: () => void
  cancelPending: boolean
}

export function BookUploadTitlesStep({
  bookId,
  bookComposer,
  bookArranger,
  bookImslpNumber,
  pageOffset,
  pageCount,
  pieces,
  pieceFields,
  onChange,
  onBack,
  onNext,
  onCancel,
  cancelPending,
}: BookUploadTitlesStepProps) {
  const isDesktop = useIsDesktop()
  // Raw physical page currently shown in the lightbox — not a piece
  // index. Seeded from a piece's own start page when its thumbnail is
  // tapped, but prev/next below page through the whole book (1..
  // pageCount), not just between piece starts — see this file's own
  // header comment for why.
  const [previewPage, setPreviewPage] = useState<number | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const {
    register,
    control,
    handleSubmit,
    getValues,
    setValue,
    trigger,
    watch,
  } = useForm<FormValues>({ defaultValues: { pieces: pieceFields } })
  // Deliberately NOT destructuring `formState: { errors }` here anymore —
  // that subscribed this whole component (which renders every row) to
  // the entire form's error object, forcing a full re-render of all 200+
  // rows on any single field's validation change. Each row now scopes its
  // own error subscription via useFormState inside
  // DesktopPieceRow/MobilePieceRow — see the perf comment above those
  // components. handleSubmit still validates the whole form internally on
  // submit; it doesn't need this component to also subscribe to errors.

  // People catalog (composer/arranger overhaul, Stage C pattern) — same
  // unpaginated listPeople() call as EditPieceModal.tsx/EditBookModal.tsx/
  // BookUploadAboutStep.tsx's own Composer/Arranger TagComboBox option
  // source.
  const { data: peopleOptions = [] } = useQuery({ queryKey: ['people'], queryFn: () => listPeople() })

  // Autosaves to the wizard's lifted pieceFields on every field edit, not
  // just on Back/Next — previously, closing the tab or
  // crashing mid-typing on this step lost everything typed since the last
  // Back/Next, including from the wizard's own localStorage draft
  // (BookUploadWizard.tsx's save-draft effect keys off pieceFields, so it
  // never saw anything this step hadn't explicitly flushed). watch's
  // callback form, not `const pieces = watch('pieces')` during render —
  // the latter returns a new array reference every render regardless of
  // whether anything actually changed, which would keep resetting a
  // reference-equality-based debounce (useDebouncedValue) on unrelated
  // re-renders (e.g. toggling the lightbox), not just on real edits.
  // Reads the canonical values via getValues() inside the timeout rather
  // than trusting the callback's own (DeepPartial-typed) argument.
  // handleBack's own immediate flush below stays regardless — this is
  // debounced, so a Back click within the 300ms window still needs that
  // explicit, unconditional flush to not lose the last edit.
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const subscription = watch(() => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = setTimeout(() => {
        onChange(clonePieces(getValues().pieces))
      }, 300)
    })
    return () => {
      subscription.unsubscribe()
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    }
  }, [watch, getValues, onChange])

  const bookHasArranger = !!bookArranger
  // Composer + a real IMSLP number together mean the book is already a
  // confirmed, single-work catalog entry — an IMSLP number identifies one
  // specific edition/work, so every piece in this book is by the same
  // already-named composer with nothing left to disambiguate per piece.
  // Hides Composer *and* Arranger both, not just Arranger the way
  // bookHasArranger alone does below.
  const bookHasConfirmedAttribution = !!bookComposer && !!bookImslpNumber
  const showComposerField = !bookHasConfirmedAttribution
  const showArrangerField = !bookHasArranger && !bookHasConfirmedAttribution
  // Neither field is actually required unless the book supplies neither
  // composer nor arranger of its own — whichever one it does have already
  // satisfies the backend's composer-or-arranger rule via inheritance
  // regardless of what (if anything) gets typed on this screen. Already
  // false whenever bookHasConfirmedAttribution is true (bookComposer is
  // set), so that case needs no separate guard here.
  const requireComposerOrArranger = !bookComposer && !bookArranger

  function onSubmit(data: FormValues) {
    // Cloned for the same reason every other flush call site is — see
    // clonePieces' own comment. handleSubmit's own payload is less likely
    // to alias pieceFields directly, but the cost of cloning 200-odd small
    // objects is trivial next to the risk of silently reintroducing the
    // same bug here.
    onChange(clonePieces(data.pieces))
    onNext()
  }

  // Back doesn't submit the form (it's a type="button", not the Next
  // button's type="submit"), so without this, whatever's currently typed
  // here only ever reaches the wizard's lifted pieceFields on a real
  // submit — going Back to fix a split point and returning would find
  // every field blank again, since the wizard never received them in the
  // first place. No validation here (unlike onSubmit's handleSubmit) —
  // Back has nothing to block on, it just needs to flush whatever's
  // currently in the form, valid or not, before the step unmounts.
  function handleBack() {
    onChange(clonePieces(getValues().pieces))
    onBack()
  }

  // Bulk-cleans every row in one pass — titleCase for Title (headline-
  // style: minor words lowercase except first/last), nameCase for each
  // selected Composer/Arranger's own name — see lib/textCase.ts for what
  // each actually does. Runs against whatever's currently in the form
  // (getValues), not the pieceFields prop, so it also cleans up anything
  // typed since the last submit/Back. Composer/Arranger are Tag[] now
  // (real per-piece TagComboBox fields) — nameCase applies to each
  // selected person's own name, not the field as a whole; this still
  // matters for a person just typed fresh via the "New tag: '...'" row
  // (raw OCR/filename-derived casing), and is a no-op against an existing
  // catalog pick's already-correctly-cased name.
  //
  // shouldValidate deliberately omitted (matches UploadBookTitlesMockup.tsx's
  // own fix): this is a formatting
  // convenience, not a submit attempt — a piece with a still-blank Title
  // (very plausible mid-wizard, before every row's been typed in yet)
  // would otherwise light up a "required" error the instant Capitalize is
  // clicked, for a field the button didn't even touch meaningfully
  // (titleCase on an empty string is a no-op). shouldDirty stays — the
  // field's *value* did change for every non-blank row, RHF's dirty
  // tracking should reflect that regardless of validation timing.
  function handleCapitalize() {
    const current = getValues()
    current.pieces.forEach((piece, index) => {
      setValue(`pieces.${index}.title`, titleCase(piece.title), { shouldDirty: true })
      setValue(
        `pieces.${index}.composer`,
        piece.composer.map((t) => ({ ...t, name: nameCase(t.name) })),
        { shouldDirty: true },
      )
      setValue(
        `pieces.${index}.arranger`,
        piece.arranger.map((t) => ({ ...t, name: nameCase(t.name) })),
        { shouldDirty: true },
      )
    })
    // setValue writes straight to each field's DOM value without firing a
    // native input event, so the per-field onChange-driven autosize below
    // never sees this — resize every field in one pass afterward instead.
    // Only Title is a <textarea> now; Composer/Arranger's TagComboBox
    // fields size themselves.
    formRef.current
      ?.querySelectorAll('textarea')
      .forEach((el) => autosizeTextarea(el as HTMLTextAreaElement))
  }

  // Composer/Arranger's sibling-revalidation-on-change and Title's
  // flush-on-blur wiring (both formerly defined here as closures) now
  // live in the module-level titleFieldProps/composerOrArrangerRules
  // helpers above, called from inside each memoized row component instead
  // — see the perf comment above DesktopPieceRow for why they moved.

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6 md:p-8">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleBack}
          className="flex cursor-pointer items-center gap-1.5 text-base text-ink-soft hover:text-ink"
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

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-medium text-ink">Name each piece</h1>
          <p className="text-sm text-ink-soft">
            Tap a thumbnail to see the page larger.{' '}
            {bookHasConfirmedAttribution &&
              `This book already has a composer and IMSLP number on record, so there are no per-piece Composer/Arranger fields below — every piece already credits ${bookComposer}.`}
            {!bookHasConfirmedAttribution &&
              bookHasArranger &&
              `This book already credits arranger ${bookArranger}, so there's no per-piece Arranger field below — set a Composer per piece if you'd like one on record.`}
            {requireComposerOrArranger &&
              ' This book has no composer or arranger set, so enter at least one of the two for each piece below.'}
          </p>
        </div>
        {/* Bulk action, not per-row — cleaning up casing one piece at a
            time defeats the point when a scanned book's OCR/filename-
            derived titles are often ALL CAPS or all-lowercase across
            every piece at once. */}
        <button
          type="button"
          onClick={handleCapitalize}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-paper-raised px-3 py-1.5 text-sm text-ink hover:border-accent"
        >
          <IconLetterCase size={16} />
          Capitalize
        </button>
      </div>

      <form ref={formRef} onSubmit={handleSubmit(onSubmit)}>
        {/* Desktop: "two-tier" rows (Option A of a density comparison —
            CLAUDE.md's Book Upload Wizard entry, ported from
            UploadBookTitlesMockup.tsx once approved). Replaces the old
            single-row 5-column grid: that layout squeezed Title/Composer/
            Arranger into equal narrow columns, and a piece with 2+
            composers or a long OCR'd title wrapped/cramped badly the
            moment Arranger also showed. Now each piece is its own row — a
            stacked media column (thumb over its page-range label) on the
            left, Title on its own full-width line, Composer/Arranger
            splitting the line below it 50/50 (or Composer alone taking
            the full line when Arranger's hidden — automatic from flex:1
            with a single child). No shared column header above the list
            anymore — each field carries its own inline label instead,
            since tiers no longer line up into one consistent row shape
            the way a single grid could label once. */}
        {isDesktop && (
          <div className="flex flex-col border-t border-border">
            {pieces.map((piece, index) => (
              <DesktopPieceRow
                key={index}
                control={control}
                index={index}
                piece={piece}
                bookId={bookId}
                pageOffset={pageOffset}
                showComposerField={showComposerField}
                showArrangerField={showArrangerField}
                requireComposerOrArranger={requireComposerOrArranger}
                peopleOptions={peopleOptions}
                register={register}
                getValues={getValues}
                trigger={trigger}
                onFieldFlush={onChange}
                setPreviewPage={setPreviewPage}
              />
            ))}
          </div>
        )}

        {!isDesktop && (
          <div className="flex flex-col border-t border-border">
            {pieces.map((piece, index) => (
              <MobilePieceRow
                key={index}
                control={control}
                index={index}
                piece={piece}
                bookId={bookId}
                pageOffset={pageOffset}
                showComposerField={showComposerField}
                showArrangerField={showArrangerField}
                requireComposerOrArranger={requireComposerOrArranger}
                peopleOptions={peopleOptions}
                register={register}
                getValues={getValues}
                trigger={trigger}
                onFieldFlush={onChange}
                setPreviewPage={setPreviewPage}
              />
            ))}
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
            className="flex cursor-pointer items-center gap-1.5 text-base text-red-700 hover:text-red-800 disabled:cursor-default disabled:opacity-45"
          >
            <IconX size={24} />
            Cancel upload
          </button>
          <button
            type="submit"
            className="flex cursor-pointer items-center gap-1.5 rounded-md bg-accent px-5 py-2.5 font-display font-medium text-white hover:bg-accent/90"
          >
            Next
            <IconArrowRight size={16} />
          </button>
        </div>
      </form>

      {previewPage !== null && (
        <PageLightbox
          key={previewPage}
          imageUrl={getBookPageThumbnailUrl(bookId, previewPage)}
          alt={`Page ${previewPage + pageOffset}`}
          // previewPage itself stays raw physical (that's what the
          // thumbnail fetch and the onPrev/onNext clamps below need) —
          // only the displayed page/pageCount/minPage are shifted by
          // pageOffset, matching every other number on this screen
          // (formatPieceLabel's own "p."/"pp." labels). Without minPage,
          // PageLightbox's Previous button would never disable at all
          // once pageOffset is nonzero, since its own hardcoded "=== 1"
          // check would be comparing against a displayed number the
          // offset shifted past.
          page={previewPage + pageOffset}
          pageCount={pageCount + pageOffset}
          minPage={1 + pageOffset}
          onClose={() => setPreviewPage(null)}
          onPrev={() => setPreviewPage((p) => Math.max(1, (p ?? 1) - 1))}
          onNext={() => setPreviewPage((p) => Math.min(pageCount, (p ?? 1) + 1))}
        />
      )}
    </div>
  )
}
