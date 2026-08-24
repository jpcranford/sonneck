import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent } from 'react'
import { useForm } from 'react-hook-form'
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconChevronLeft,
  IconChevronRightFilled,
  IconX,
  IconXFilled,
} from '@tabler/icons-react'
import { useMockupTitle } from '../lib/useMockupTitle'

// ---------------------------------------------------------------------
// DESIGN MOCKUP — Book Upload Wizard, Screen 5 of 6: "Name each piece"
// (design doc §5's "fill fields" step). Not wired to the API — the piece
// list below is a fixed local fixture.
//
// Field entry is deliberately light — just Title (required), Composer
// (always shown), and Arranger (shown only when the book itself doesn't
// already have one of its own — book-level soft inheritance otherwise
// covers it, so asking again per piece here would be redundant). Neither
// Composer nor Arranger is actually required unless the book supplies
// neither — see REQUIRE_COMPOSER_OR_ARRANGER below.
//
// This fixture's book has an arranger set but no composer, specifically
// to demonstrate that asymmetry: Arranger disappears, Composer stays.
// See the constants below to preview the other cases.
// ---------------------------------------------------------------------

const TOTAL_STEPS = 6
const CURRENT_STEP = 5

interface PieceFixture {
  start: number
  end: number
  isLast: boolean
  color: string
  title: string
  composer: string
  arranger: string
}

// Same 3 pieces, same colors (PALETTE[0..2] from Screen 4's Garden
// Variety palette), same book — carried forward for continuity rather
// than inventing a new fixture for this screen. Arranger starts blank on
// all three — composer alone already satisfies each row.
const PIECES: PieceFixture[] = [
  {
    start: 1,
    end: 3,
    isLast: false,
    color: '#6b8a9c',
    title: 'Prelude in C',
    composer: 'J. Burgmüller',
    arranger: '',
  },
  {
    start: 5,
    end: 7,
    isLast: false,
    color: '#b8935a',
    title: 'Nocturne',
    composer: 'Fr. Chopin',
    arranger: '',
  },
  {
    start: 7,
    end: 8,
    isLast: true,
    color: '#9c7ab8',
    title: 'Waltz in A♭',
    composer: 'Fr. Chopin',
    arranger: '',
  },
]

// Composer always shows, regardless of what the book itself has set —
// there's no per-piece harm in leaving it editable even when it's not
// strictly needed. Arranger is the one that hides, and only when the book
// already has one of its own: unlike Composer, a book-level Arranger with
// no per-piece override is a common, unremarkable case (see CLAUDE.md's
// composer-or-arranger validation history), so re-asking for it on every
// row here would be pure redundancy. This fixture's book has an arranger
// set (Theodor Kirchner) but no composer, specifically so that asymmetry
// — Arranger gone, Composer still present — is the thing on screen to
// review. Blank BOOK_ARRANGER below to preview the other case (both
// fields shown).
const BOOK_COMPOSER = ''
const BOOK_ARRANGER = 'Theodor Kirchner'
const BOOK_HAS_COMPOSER = !!BOOK_COMPOSER
const BOOK_HAS_ARRANGER = !!BOOK_ARRANGER
const SHOW_ARRANGER_FIELD = !BOOK_HAS_ARRANGER
// Neither field is actually required here unless the book supplies
// neither composer nor arranger of its own — whichever one the book
// already has satisfies the backend's composer-or-arranger rule via
// inheritance regardless of what (if anything) gets typed on this screen.
const REQUIRE_COMPOSER_OR_ARRANGER = !BOOK_HAS_COMPOSER && !BOOK_HAS_ARRANGER

// Desktop grid template: label/thumb/title/composer always present,
// arranger only when SHOW_ARRANGER_FIELD.
const DESKTOP_GRID_COLS = SHOW_ARRANGER_FIELD
  ? 'grid-cols-[128px_88px_1fr_1fr_1fr]'
  : 'grid-cols-[128px_88px_1fr_1fr]'

// Academic p./pp. convention app-wide (singular vs. a range), same as
// PiecePage.tsx/BookDetailsPage.tsx — this row label had drifted to a
// bare "pp" with no period and no singular form.
function formatPieceLabel(piece: PieceFixture) {
  return piece.end !== piece.start ? `pp. ${piece.start}–${piece.end}` : `p. ${piece.start}`
}

// A single representative page (the piece's own start page) standing in
// for a real rendered PDF page — same illustrative-SVG spirit as Screen
// 4's PageThumb, parameterized by piece title instead of blank/page
// content since this screen is about naming pieces, not marking pages.
function PieceThumb({ title, page }: { title: string; page: number }) {
  const staffGroupYs = [58, 91, 124, 157, 190, 223]
  const lineOffsets = [0, 3.5, 7, 10.5, 14]
  return (
    <svg viewBox="0 0 200 260" className="block h-auto w-full">
      <rect x="0.5" y="0.5" width="199" height="259" fill="#fffdf9" stroke="#e4e0d8" />
      <text
        x="100"
        y="26"
        textAnchor="middle"
        fontFamily="var(--font-display)"
        fontSize="9"
        fill="#5c5349"
      >
        {title}
      </text>
      {staffGroupYs.map((y) => (
        <g key={y} stroke="#c9c2b6" strokeWidth="0.5">
          {lineOffsets.map((offset) => (
            <line key={offset} x1="18" x2="182" y1={y + offset} y2={y + offset} />
          ))}
        </g>
      ))}
      <text
        x="184"
        y="248"
        textAnchor="end"
        fontFamily="var(--font-display)"
        fontSize="7"
        fill="#8f857a"
      >
        {page}
      </text>
    </svg>
  )
}

// Desktop-only hover popover trigger + popup, pulled into its own
// component (not inlined in the row map below) specifically so each row
// can own independent position/hover state via hooks — a plain useState
// inside the .map() callback would be one shared value fighting over
// every row instead of one per row.
//
// position: fixed with JS-computed viewport coordinates, not position:
// absolute anchored to the trigger's own relative parent (this mockup's
// first version of this fix — reverted after building the real
// BookUploadTitlesStep.tsx off it surfaced two real bugs an
// absolutely-positioned, always-mounted popup has: it contributes its
// transformed bounds to its nearest *scrolling* ancestor's
// scrollable-overflow region for as long as it's mounted, even while
// invisible, and shrinking that footprint (exactly what a top/bottom
// clamp does) can force the browser to re-clamp scrollTop to a smaller
// max if the container happened to be scrolled to its old max at that
// instant — silently cancelling the popup's own on-screen correction, or
// worse, changing scroll position under a *stationary* mouse can change
// what's actually under the cursor, triggering a mouseleave → unmount →
// scrollHeight-shrinks-back → mouseenter-again oscillation. Both
// confirmed directly while building the real version — see that file's
// own copy of this component for the full trace. position: fixed
// sidesteps this entirely: a fixed-position descendant never contributes
// to an ancestor's scrollable content, regardless of size or position,
// the same reason PageLightbox.tsx and Modal.tsx's own backdrops (also
// fixed) never hit this. No portal needed — a fixed descendant only gets
// trapped by an ancestor establishing its own containing block
// (transform/filter/perspective, the exact bug BookUploadAboutStep.tsx's
// lightbox hit from a sticky ancestor, fixed earlier), and nothing
// between this component and the document root does that here either.
//
// Position is computed in two passes, both before the browser's first
// paint of the popup (useLayoutEffect, not useEffect): the popup mounts
// top-aligned with the trigger first (a safe placement that needs no
// foreknowledge of the popup's own height), then this effect measures
// its actual rendered height and recenters it on the trigger — clamped
// to the viewport, nudging up/down only as much as needed to clear
// whichever edge it would've clipped, bottom taking priority over top in
// the (rare) case a popup taller than the viewport would violate both,
// same precedence InfoTooltip.tsx's own left/right clamp uses for
// right-over-left.
function HoverPagePreview({ piece, onPreview }: { piece: PieceFixture; onPreview: () => void }) {
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
    if (!pos) {
      setPos({ top: triggerRect.top, left })
      return
    }
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
          fixed width (88px column here vs. mobile's own 115px).
          rounded-lg matches that same card's corner radius. The per-piece
          color border stays: it's this wizard's own continuity cue tying
          a piece back to its Screen 4 split color, not decorative chrome
          to drop for the sake of matching. Tap-to-preview is unchanged —
          only the trigger's shape changed, not what it does. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={onPreview}
        title="Tap to preview page"
        className="relative block aspect-[180/132] w-full overflow-hidden rounded-lg"
        style={{ border: `1.5px solid ${piece.color}` }}
      >
        <PieceThumb title={piece.title} page={piece.start} />
      </button>
      {/* No fade-in transition (the old opacity-0 -> group-hover:opacity-100
          is gone along with group-hover itself, since visibility is now
          driven by the `hovering` state, not CSS): mounting straight into
          an animated opacity change here would mean a *third* render pass
          on top of the two the position fix already needs, for a purely
          cosmetic touch — not worth the extra fragility this component
          has already shown once. */}
      {hovering && pos && (
        <div
          ref={popupRef}
          style={{ border: `2px solid ${piece.color}`, top: pos.top, left: pos.left }}
          className="pointer-events-none fixed z-20 w-[420px] overflow-hidden rounded-md shadow-xl"
        >
          <PieceThumb title={piece.title} page={piece.start} />
        </div>
      )}
    </div>
  )
}

// Local copy of components/PageLightbox.tsx, same "no shared component
// between a mockup and the real thing" convention as every other mockup
// in this codebase (see UploadBookAboutMockup.tsx's own copy for
// precedent) — renders PieceThumb in place of a real page image. Replaces
// the old PagePreviewOverlay (a single fixed-size popup with no zoom
// capability): this is the real lightbox's actual fit/actual-size zoom
// toggle, not a simplified stand-in — 'actual' is a genuine 1:1 view, not
// just a slightly-bigger 'fit'. Cycles between pieces (not pages within
// one piece — this screen only ever shows a piece's own start page), so
// prev/next here means "the piece before/after this one in the list."
function PageLightbox({
  piece,
  pieceIndex,
  pieceCount,
  onClose,
  onPrev,
  onNext,
}: {
  piece: PieceFixture
  pieceIndex: number
  pieceCount: number
  onClose: () => void
  onPrev: () => void
  onNext: () => void
}) {
  // 'fit' shows the whole page within the screen; 'actual' shows it at a
  // larger, fixed pixel size in a scrollable box — this mockup's
  // placeholder is a vector SVG with no real pixel size to be "1:1"
  // against, so 'actual' stands in for what would be the real page
  // image's true native size in the real build (same convention as
  // UploadBookAboutMockup.tsx's own copy). Resets to 'fit' on every piece
  // change by remounting this component on `key={pieceIndex}` from the
  // caller (React's own recommended pattern for "reset state when a prop
  // changes") rather than an effect calling setState for the same result.
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
              ? 'w-[70vw] max-w-[440px] overflow-hidden rounded-md shadow-2xl sm:w-[420px]'
              : 'w-[820px] overflow-hidden rounded-md shadow-2xl'
          }
          style={{ border: `2px solid ${piece.color}` }}
        >
          <PieceThumb title={piece.title} page={piece.start} />
        </div>
      </button>

      {pieceCount > 1 && (
        <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-ink/80 px-2 py-1 shadow-md backdrop-blur-sm">
          <button
            type="button"
            onClick={onPrev}
            disabled={pieceIndex === 0}
            aria-label="Previous piece"
            className="flex size-7 items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-accent-on-dark disabled:pointer-events-none disabled:opacity-35"
          >
            <IconChevronLeft size={16} />
          </button>
          <span className="text-xs tabular-nums text-white/90">
            {pieceIndex + 1} / {pieceCount}
          </span>
          <button
            type="button"
            onClick={onNext}
            disabled={pieceIndex === pieceCount - 1}
            aria-label="Next piece"
            className="flex size-7 items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-accent-on-dark disabled:pointer-events-none disabled:opacity-35"
          >
            <IconChevronRightFilled size={16} />
          </button>
        </div>
      )}
    </div>
  )
}

interface FormValues {
  pieces: { title: string; composer: string; arranger: string }[]
}

// Matches the `md:` breakpoint (768px) used to switch layouts below.
const DESKTOP_BREAKPOINT_PX = 768

// A real conditional render, not `hidden md:block` / `md:hidden` CSS —
// found live, not assumed: with both layouts CSS-toggled but still both
// mounted, their inputs share the same react-hook-form field names
// (`pieces.${i}.title`), and RHF only tracks one of the two identically-
// named refs per field. Clearing the visible (desktop) input didn't
// actually clear what RHF validated against — the hidden mobile
// duplicate still held the old value, so "Next" submitted successfully
// with an apparently-blank required field. Rendering only one layout's
// inputs at a time removes the duplicate registration entirely.
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

export function UploadBookTitlesMockup() {
  useMockupTitle('Upload — Name Each Piece')

  const isDesktop = useIsDesktop()
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)

  function handleCancelUpload() {
    const confirmed = window.confirm(
      "Cancel this upload? The uploaded file and its generated page previews will be permanently removed from the server.",
    )
    if (!confirmed) return
    // Mockup only — see UploadBookAboutMockup.tsx's own copy of this
    // function for the real-build notes (DELETE /api/books/{id}, thumbnail
    // cache cleanup gap, return-to-Upload-landing).
    console.log('Mockup: cancel confirmed — would delete book + cached thumbnails, return to Upload landing')
  }
  const {
    register,
    handleSubmit,
    getValues,
    trigger,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      pieces: PIECES.map((p) => ({ title: p.title, composer: p.composer, arranger: p.arranger })),
    },
  })

  // Composer and Arranger validate each other: either one being non-blank
  // satisfies both — but only when REQUIRE_COMPOSER_OR_ARRANGER is true in
  // the first place (the book supplies neither on its own). When Arranger
  // is hidden (SHOW_ARRANGER_FIELD false), REQUIRE_COMPOSER_OR_ARRANGER is
  // always false too — the book's own arranger already satisfies the
  // backend's requirement via inheritance — so this never blocks
  // submission on a field the user can no longer even see. Wraps
  // register's own onBlur to also re-trigger the sibling field's
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
        !REQUIRE_COMPOSER_OR_ARRANGER ||
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
      <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
        Design mockup —{' '}
        <span className="font-medium text-ink">
          Book Upload Wizard, Screen 5 of 6: "Name each piece"
        </span>{' '}
        (design doc §5). Not wired to real data — clear a field and hit Next to see live validation.
      </div>

      {/* Wizard chrome — identical to Screens 3 and 4's, carried forward verbatim. */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="flex items-center gap-1.5 text-base text-ink-soft hover:text-ink"
        >
          <IconArrowLeft size={24} />
          Back
        </button>
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-xs text-ink-soft">
            Step {CURRENT_STEP} of {TOTAL_STEPS}
          </span>
          <div className="flex gap-1.5">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((step) => (
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
          Hover or tap a thumbnail to see the page larger.{' '}
          {BOOK_HAS_ARRANGER &&
            `This book already credits arranger ${BOOK_ARRANGER}, so there's no per-piece Arranger field below — set a Composer per piece if you'd like one on record.`}
          {REQUIRE_COMPOSER_OR_ARRANGER &&
            ' This book has no composer or arranger set, so enter at least one of the two for each piece below.'}
        </p>
      </div>

      <form onSubmit={handleSubmit((data) => console.log('Mockup: advance to Confirmation', data))}>
        {/* Desktop: table-like grid, piece label first, thumbnail tucked
            tight against Title, then Composer/Arranger as same-width
            field columns. */}
        {isDesktop && (
          <div>
            <div className={`grid ${DESKTOP_GRID_COLS} gap-2.5 px-3 pb-1.5`}>
              <span />
              <span />
              <span className="text-xs font-semibold text-ink-soft">Title *</span>
              <span className="text-xs font-semibold text-ink-soft">Composer</span>
              {SHOW_ARRANGER_FIELD && (
                <span className="text-xs font-semibold text-ink-soft">Arranger</span>
              )}
            </div>
            <div className="flex flex-col border-t border-border">
              {PIECES.map((piece, index) => {
                const titleError = errors.pieces?.[index]?.title
                const composerError = errors.pieces?.[index]?.composer
                const arrangerError = errors.pieces?.[index]?.arranger
                return (
                  <div
                    key={piece.start}
                    className={`grid ${DESKTOP_GRID_COLS} items-center gap-2.5 px-3 py-1.5 ${
                      index % 2 === 0 ? 'bg-paper-sunken' : ''
                    }`}
                  >
                    <span className="text-sm text-ink-soft">
                      Piece {index + 1} • {formatPieceLabel(piece)}
                    </span>
                    {/* Desktop-only hover popover, on top of the existing
                        tap-to-open overlay rather than replacing it — a
                        mouse is guaranteed on desktop, so a hover preview
                        doesn't run into the "no hover-dependent
                        interactions" device-aware rule (CLAUDE.md): that
                        rule exists for touch parity, and touch users
                        already have the tap-to-open overlay below as
                        their equivalent path. See HoverPagePreview's own
                        comment for why this needs real hover-position
                        measurement (not pure CSS group-hover) and why
                        it's its own component rather than inlined here. */}
                    <HoverPagePreview piece={piece} onPreview={() => setPreviewIndex(index)} />
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
                    {SHOW_ARRANGER_FIELD && (
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

        {/* Mobile: same table language stacked, deliberately without
            per-piece card/box chrome — just the alternating row
            background carrying the grouping, same as desktop. */}
        {!isDesktop && (
          <div className="flex flex-col border-t border-border">
            {PIECES.map((piece, index) => {
              const titleError = errors.pieces?.[index]?.title
              const composerError = errors.pieces?.[index]?.composer
              const arrangerError = errors.pieces?.[index]?.arranger
              return (
                <div
                  key={piece.start}
                  className={`flex items-start gap-3.5 px-4 py-3.5 ${index % 2 === 0 ? 'bg-paper-sunken' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => setPreviewIndex(index)}
                    title="Tap to preview page"
                    className="relative aspect-[180/132] w-[115px] shrink-0 overflow-hidden rounded-lg"
                    style={{ border: `1.5px solid ${piece.color}` }}
                  >
                    <PieceThumb title={piece.title} page={piece.start} />
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
                    {SHOW_ARRANGER_FIELD && (
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
            UploadBookAboutMockup.tsx's own comment on this same row for
            the full placement/styling reasoning. */}
        <div className="flex items-center justify-between border-t border-border pt-5">
          <button
            type="button"
            onClick={handleCancelUpload}
            className="flex items-center gap-1.5 text-base text-red-700 hover:text-red-800"
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
          piece={PIECES[previewIndex]}
          pieceIndex={previewIndex}
          pieceCount={PIECES.length}
          onClose={() => setPreviewIndex(null)}
          onPrev={() => setPreviewIndex((i) => Math.max(0, (i ?? 0) - 1))}
          onNext={() => setPreviewIndex((i) => Math.min(PIECES.length - 1, (i ?? 0) + 1))}
        />
      )}
    </div>
  )
}
