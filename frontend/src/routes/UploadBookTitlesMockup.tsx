import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { Controller, useForm } from 'react-hook-form'
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconChevronLeft,
  IconChevronRightFilled,
  IconLetterCase,
  IconX,
  IconXFilled,
} from '@tabler/icons-react'
import type { Tag } from '../api/types'
import { TagComboBox } from '../components/TagComboBox'
import { useMockupTitle } from '../lib/useMockupTitle'
import { autosizeTextarea, preventTextareaNewline } from '../lib/autosizeTextarea'
import { nameCase, titleCase } from '../lib/textCase'

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
// Simulates a printed-page correction having been set back on Screen 3
// ("About this book," see UploadBookAboutMockup.tsx's own "Printed-PDF
// page number offset" field) — piece.start/piece.end stay the raw PDF
// position (that's what PieceThumb's page-preview lookup and this
// wizard's split logic actually key off), only the numbers *displayed*
// below are shown offset-adjusted, same convention as
// UploadBookSplitMockup.tsx.
const PAGE_OFFSET = 6

interface PieceFixture {
  start: number
  end: number
  isLast: boolean
  color: string
  title: string
  composer: Tag[]
  arranger: Tag[]
}

// Composer/Arranger are ordered Person lists now (composer/arranger
// overhaul, migration 00020) — real per-piece TagComboBox fields, same
// pattern UploadBookAboutMockup.tsx's own book-level Composer/Arranger
// fields already use. Real callers (EditPieceModal.tsx/EditBookModal.tsx/
// BookUploadAboutStep.tsx) source their options from the real, unpaginated
// GET /api/people — this mockup has no backend to call, same "hardcoded
// fixture stands in for the lookup table" treatment INSTRUMENT_OPTIONS
// gets elsewhere in this app's mockups. Deliberately includes one name
// (Louis Köhler) not credited on any of the three fixture pieces below —
// something for the "type to search existing" path to actually find.
const PEOPLE_OPTIONS: Tag[] = [
  { id: 1, name: 'J. Burgmüller' },
  { id: 2, name: 'Fr. Chopin' },
  { id: 3, name: 'Louis Köhler' },
]

// Same 3 pieces, same colors (PALETTE[0..2] from Screen 4's Garden
// Variety palette), same book — carried forward for continuity rather
// than inventing a new fixture for this screen. Arranger starts blank on
// all three — composer alone already satisfies each row.
const PIECES: PieceFixture[] = [
  {
    start: 1,
    end: 3,
    isLast: false,
    color: '#7a9c6b',
    title: 'Prelude in C',
    composer: [PEOPLE_OPTIONS[0]],
    arranger: [PEOPLE_OPTIONS[2]],
  },
  {
    start: 5,
    end: 7,
    isLast: false,
    color: '#b87aaf',
    title: 'Nocturne',
    composer: [PEOPLE_OPTIONS[1]],
    // Two names on purpose — the worst case for the Arranger field's own
    // pill wrapping, same stress test the Composer field already got via
    // this piece before the two-tier redesign was picked.
    arranger: [PEOPLE_OPTIONS[0], PEOPLE_OPTIONS[2]],
  },
  {
    start: 7,
    end: 8,
    isLast: true,
    color: '#5c8a8a',
    title: 'Waltz in A♭',
    composer: [PEOPLE_OPTIONS[1]],
    // Left blank on purpose — shows the empty/placeholder state of the
    // field alongside the other two rows' filled state.
    arranger: [],
  },
]

// Same 8-page book the Split mockup uses (p.4 skipped, matching neither
// piece's start/end range) — the lightbox below browses the whole book by
// raw physical page, not just the 3 pieces, so it needs to know the real
// total.
const PAGE_COUNT = 8

// null for a page that isn't any piece's own range (a skipped page, e.g.
// p.4) — the lightbox renders that as a blank page, same as Screen 4's
// own skipped-page treatment, rather than pretending it belongs to
// whichever piece happens to be nearest.
function pieceForPage(page: number): PieceFixture | null {
  return PIECES.find((p) => page >= p.start && page <= p.end) ?? null
}

// Composer always shows, regardless of what the book itself has set —
// there's no per-piece harm in leaving it editable even when it's not
// strictly needed. Arranger is the one that hides, and only when the book
// already has one of its own: unlike Composer, a book-level Arranger with
// no per-piece override is a common, unremarkable case (see CLAUDE.md's
// composer-or-arranger validation history), so re-asking for it on every
// row here would be pure redundancy. Both left blank below — the book has
// neither of its own — specifically so both fields show on every row,
// including one with a 2-name Arranger, for reviewing the two-tier
// layout's actual worst case (both fields, one wrapping). Set
// BOOK_ARRANGER back to a real name to preview the other, Arranger-hidden
// case instead.
const BOOK_COMPOSER = ''
const BOOK_ARRANGER = ''
// Blank here (see BOOK_COMPOSER/BOOK_ARRANGER's own comment above) — set
// alongside a real BOOK_COMPOSER to preview the third case, where both
// people fields disappear entirely (direct request, 2026-09-02): a book
// that already has a composer *and* a confirmed IMSLP number is a
// single-work catalog entry, nothing left to disambiguate per piece.
const BOOK_IMSLP_NUMBER = ''
const BOOK_HAS_COMPOSER = !!BOOK_COMPOSER
const BOOK_HAS_ARRANGER = !!BOOK_ARRANGER
const BOOK_HAS_CONFIRMED_ATTRIBUTION = BOOK_HAS_COMPOSER && !!BOOK_IMSLP_NUMBER
const SHOW_COMPOSER_FIELD = !BOOK_HAS_CONFIRMED_ATTRIBUTION
const SHOW_ARRANGER_FIELD = !BOOK_HAS_ARRANGER && !BOOK_HAS_CONFIRMED_ATTRIBUTION
// Neither field is actually required here unless the book supplies
// neither composer nor arranger of its own — whichever one the book
// already has satisfies the backend's composer-or-arranger rule via
// inheritance regardless of what (if anything) gets typed on this screen.
// Already false whenever BOOK_HAS_CONFIRMED_ATTRIBUTION is true (implies
// BOOK_HAS_COMPOSER), so that case needs no separate guard here.
const REQUIRE_COMPOSER_OR_ARRANGER = !BOOK_HAS_COMPOSER && !BOOK_HAS_ARRANGER

// Academic p./pp. convention app-wide (singular vs. a range), same as
// PiecePage.tsx/BookDetailsPage.tsx — this row label had drifted to a
// bare "pp" with no period and no singular form.
function formatPieceLabel(piece: PieceFixture) {
  const start = piece.start + PAGE_OFFSET
  const end = piece.end + PAGE_OFFSET
  return end !== start ? `pp. ${start}–${end}` : `p. ${start}`
}

// A single representative page (the piece's own start page) standing in
// for a real rendered PDF page — same illustrative-SVG spirit as Screen
// 4's PageThumb, parameterized by piece title instead of blank/page
// content since this screen is about naming pieces, not marking pages.
// title is null for a page that isn't any piece's own range (the
// lightbox's whole-book browsing can land on a skipped page) — rendered
// as the same italic "(blank)" label Screen 4's PageThumb uses, staff
// lines omitted, so a blank page still reads as deliberately blank
// rather than as a piece with no name.
function PieceThumb({ title, page }: { title: string | null; page: number }) {
  const staffGroupYs = [58, 91, 124, 157, 190, 223]
  const lineOffsets = [0, 3.5, 7, 10.5, 14]
  return (
    <svg viewBox="0 0 200 260" className="block h-auto w-full">
      <rect
        x="0.5"
        y="0.5"
        width="199"
        height="259"
        fill={title === null ? '#f7f5f0' : '#fffdf9'}
        stroke="#e4e0d8"
      />
      {title === null ? (
        <text x="100" y="134" textAnchor="middle" fontSize="9" fill="#c9c2b6" fontStyle="italic">
          (blank)
        </text>
      ) : (
        <>
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
        </>
      )}
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
        <PieceThumb title={piece.title} page={piece.start + PAGE_OFFSET} />
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
          <PieceThumb title={piece.title} page={piece.start + PAGE_OFFSET} />
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
// just a slightly-bigger 'fit'.
//
// Browses the *whole book* by raw physical page, not just the pieces —
// originally cycled between pieces only (prev/next meant "the piece
// before/after this one"), which showed the wrong number here (a piece
// index masquerading as a page number) and made it impossible to check a
// skipped page without leaving this screen and going back to Screen 4.
// Fixed 2026-08-26 to match the real build (BookUploadTitlesStep.tsx):
// resolves whichever piece (if any) owns the current page via
// pieceForPage, rendering a blank PieceThumb for a page that isn't in
// any piece's range.
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
  const piece = pieceForPage(page)
  // 'fit' shows the whole page within the screen; 'actual' shows it at a
  // larger, fixed pixel size in a scrollable box — this mockup's
  // placeholder is a vector SVG with no real pixel size to be "1:1"
  // against, so 'actual' stands in for what would be the real page
  // image's true native size in the real build (same convention as
  // UploadBookAboutMockup.tsx's own copy). Resets to 'fit' on every page
  // change by remounting this component on `key={page}` from the caller
  // (React's own recommended pattern for "reset state when a prop
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
          style={{ border: `2px solid ${piece ? piece.color : '#e4e0d8'}` }}
        >
          <PieceThumb title={piece ? piece.title : null} page={page + PAGE_OFFSET} />
        </div>
      </button>

      {pageCount > 1 && (
        <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-ink/80 px-2 py-1 shadow-md backdrop-blur-sm">
          <button
            type="button"
            onClick={onPrev}
            disabled={page === 1}
            aria-label="Previous page"
            className="flex size-7 items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-accent-on-dark disabled:pointer-events-none disabled:opacity-35"
          >
            <IconChevronLeft size={16} />
          </button>
          {/* page/pageCount themselves stay raw physical (that's what
              pieceForPage's own lookup and the disabled checks above
              need) — only the displayed numbers are offset-adjusted,
              matching PieceThumb's own printed page number just above
              and every other number on this screen (formatPieceLabel's
              "p."/"pp." labels). */}
          <span className="text-xs tabular-nums text-white/90">
            {page + PAGE_OFFSET} / {pageCount + PAGE_OFFSET}
          </span>
          <button
            type="button"
            onClick={onNext}
            disabled={page === pageCount}
            aria-label="Next page"
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
  pieces: { title: string; composer: Tag[]; arranger: Tag[] }[]
}

// Deliberately NOT the app's own `md:` breakpoint (768px, Sidebar.tsx/
// MobileNav.tsx) — found live, not assumed: at exactly 768px both the
// sidebar (256px) and this row's own Composer/Arranger split turn on at
// the same instant, which is the worst possible moment for the split —
// the sidebar has just claimed its full width and the fields column has
// its least room. Set wider so the two-column split only engages once
// there's still real room left over after the sidebar appears, not right
// at the same pixel the sidebar shows up and eats into it.
const DESKTOP_BREAKPOINT_PX = 1024

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
  const [previewPage, setPreviewPage] = useState<number | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

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
    control,
    handleSubmit,
    getValues,
    setValue,
    trigger,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      pieces: PIECES.map((p) => ({ title: p.title, composer: p.composer, arranger: p.arranger })),
    },
  })

  // Bulk-cleans every row in one pass — titleCase for Title, nameCase for
  // each selected Composer/Arranger's own name — see lib/textCase.ts
  // (shared with the real build, not a local copy — it's pure logic, not
  // a component, same reasoning pieceSplitLogic.ts is shared rather than
  // duplicated). Runs against whatever's currently in the form
  // (getValues), not the PIECES fixture. Composer/Arranger are Tag[] now
  // (real per-piece TagComboBox fields, see PEOPLE_OPTIONS above) —
  // nameCase applies to each selected person's own name, not the field as
  // a whole; this still matters for a person just typed fresh via the
  // "New person: '...'" row (raw OCR/filename-derived casing), same as it
  // always did, but leaves an existing catalog pick's name exactly as
  // stored (nameCase is idempotent against an already-correctly-cased
  // name regardless, so this isn't a behavior change for that case, just
  // a reminder of why it's still safe to apply unconditionally).
  //
  // shouldValidate deliberately omitted (found firing 2026-08-27): this is
  // a formatting convenience, not a submit attempt — a piece with a still-
  // blank Title (very plausible mid-wizard, before every row's been typed
  // in yet) would otherwise light up a "required" error the instant
  // Capitalize is clicked, for a field the button didn't even touch
  // meaningfully (titleCase on an empty string is a no-op). shouldDirty
  // stays — the field's *value* did change for every non-blank row, RHF's
  // dirty tracking should reflect that regardless of validation timing.
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

  // Pulled out for Title since it has no sibling-validation logic to
  // otherwise wrap register's return value for (Composer/Arranger's own
  // sibling-presence check now lives in each Controller's `rules` below).
  function titleField(index: number) {
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
    }
  }

  // Composer and Arranger validate each other: either one having at least
  // one person satisfies both — but only when REQUIRE_COMPOSER_OR_ARRANGER
  // is true in the first place (the book supplies neither on its own).
  // When Arranger is hidden (SHOW_ARRANGER_FIELD false),
  // REQUIRE_COMPOSER_OR_ARRANGER is always false too — the book's own
  // arranger already satisfies the backend's requirement via inheritance —
  // so this never blocks submission on a field the user can no longer even
  // see. This checks *presence* only (does the array have anything in it),
  // not format — TagComboBox's own "pick existing or create new" flow
  // can't produce a blank/malformed entry, so there's nothing else worth
  // validating here (direct instruction: format validation on top of that
  // would be redundant). Composer/arrangerField's own onChange re-triggers
  // the sibling's validation immediately (not on blur, unlike the old
  // textarea version — TagComboBox's interaction model is pick-or-create,
  // not continuous typing with a natural blur point per keystroke), so
  // adding a name to Arranger clears a Composer error that was showing
  // (not just the reverse) right away.
  function composerOrArrangerRules(field: 'composer' | 'arranger', index: number) {
    const other = field === 'composer' ? 'arranger' : 'composer'
    return {
      validate: (value: Tag[]) =>
        !REQUIRE_COMPOSER_OR_ARRANGER ||
        value.length > 0 ||
        getValues(`pieces.${index}.${other}`).length > 0 ||
        'Composer or arranger required',
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

      {/* Wizard chrome — identical to Screens 3 and 4's, carried forward
          verbatim, including Back routing to /mockup rather than
          simulating real step-nav — see UploadBookAboutMockup.tsx's own
          comment on this. */}
      <div className="flex items-center justify-between">
        <Link to="/mockup" className="flex items-center gap-1.5 text-base text-ink-soft hover:text-ink">
          <IconArrowLeft size={24} />
          Back
        </Link>
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

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-medium text-ink">Name each piece</h1>
          <p className="text-sm text-ink-soft">
            Hover or tap a thumbnail to see the page larger.{' '}
            {BOOK_HAS_CONFIRMED_ATTRIBUTION &&
              `This book already has a composer and IMSLP number on record, so there are no per-piece Composer/Arranger fields below — every piece already credits ${BOOK_COMPOSER}.`}
            {!BOOK_HAS_CONFIRMED_ATTRIBUTION &&
              BOOK_HAS_ARRANGER &&
              `This book already credits arranger ${BOOK_ARRANGER}, so there's no per-piece Arranger field below — set a Composer per piece if you'd like one on record.`}
            {REQUIRE_COMPOSER_OR_ARRANGER &&
              ' This book has no composer or arranger set, so enter at least one of the two for each piece below.'}
          </p>
        </div>
        {/* Bulk action, not per-row — see the real build's own comment
            (BookUploadTitlesStep.tsx) for why. */}
        <button
          type="button"
          onClick={handleCapitalize}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-paper-raised px-3 py-1.5 text-sm text-ink hover:border-accent"
        >
          <IconLetterCase size={16} />
          Capitalize
        </button>
      </div>

      <form
        ref={formRef}
        onSubmit={handleSubmit((data) => console.log('Mockup: advance to Confirmation', data))}
      >
        {/* Desktop: "two-tier" rows (Option A of the density comparison —
            see CLAUDE.md's Book Upload Wizard entry once ported for the
            full artifact writeup). Replaces the old single-row 5-column
            grid: that layout squeezed Title/Composer/Arranger into equal
            narrow columns, and a piece with 2+ composers or a long OCR'd
            title wrapped/cramped badly the moment Arranger also showed.
            Now each piece is its own row — a stacked media column (thumb
            over its page-range label) on the left, Title on its own
            full-width line, Composer/Arranger splitting the line below it
            50/50 (or Composer alone taking the full line when Arranger's
            hidden — automatic from flex:1 with a single child, no
            separate narrower grid template needed). No shared column
            header above the list anymore — each field carries its own
            inline label instead, since tiers no longer line up into one
            consistent row shape the way a single grid could label once. */}
        {isDesktop && (
          <div className="flex flex-col border-t border-border">
            {PIECES.map((piece, index) => {
              const titleError = errors.pieces?.[index]?.title
              const composerError = errors.pieces?.[index]?.composer
              const arrangerError = errors.pieces?.[index]?.arranger
              return (
                <div
                  key={piece.start}
                  className={`flex gap-3.5 px-3 py-3 ${index % 2 === 0 ? 'bg-paper-sunken' : ''}`}
                >
                  <div className="flex w-28 shrink-0 flex-col gap-1.5">
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
                    <HoverPagePreview piece={piece} onPreview={() => setPreviewPage(piece.start)} />
                    <span className="text-xs text-ink-soft">
                      Piece {index + 1} • {formatPieceLabel(piece)}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                    <div className="min-w-0">
                      {/* Label matches TagComboBox's own label (text-sm,
                          regular weight) instead of the smaller bold-caps
                          style the old shared column header used — that
                          style was carried over by habit when this row
                          stopped being a grid, but nothing next to it
                          uses it anymore, so it read as a mismatched font.
                          Padding is py-[11px] (not py-1.5) so the box's
                          measured height lands at exactly 42px — the same
                          height TagComboBox's own min-h-[42px] wrapper
                          resolves to (confirmed via live boundingClientRect,
                          not just the Tailwind spacing scale's nearest
                          step) — so Title, Composer, and Arranger's boxes
                          line up instead of Title sitting visibly shorter. */}
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
                        {...titleField(index)}
                      />
                      {titleError && (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-red-700">
                          <IconAlertTriangle size={10} />
                          Required
                        </span>
                      )}
                    </div>
                    {SHOW_COMPOSER_FIELD && (
                      <div className="flex gap-2.5">
                        <div className="min-w-0 flex-1">
                          <Controller
                            name={`pieces.${index}.composer`}
                            control={control}
                            rules={composerOrArrangerRules('composer', index)}
                            render={({ field }) => (
                              <TagComboBox
                                label="Composer"
                                options={PEOPLE_OPTIONS}
                                selected={field.value}
                                multiple
                                onChange={(next) => {
                                  field.onChange(next)
                                  void trigger(`pieces.${index}.arranger`)
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
                        {SHOW_ARRANGER_FIELD && (
                          <div className="min-w-0 flex-1">
                            <Controller
                              name={`pieces.${index}.arranger`}
                              control={control}
                              rules={composerOrArrangerRules('arranger', index)}
                              render={({ field }) => (
                                <TagComboBox
                                  label="Arranger"
                                  options={PEOPLE_OPTIONS}
                                  selected={field.value}
                                  multiple
                                  onChange={(next) => {
                                    field.onChange(next)
                                    void trigger(`pieces.${index}.composer`)
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
            })}
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
                  {/* Piece label sits under the thumbnail, same stacked
                      media column as the desktop layout — it used to
                      float above Title inside the fields column instead,
                      which put it to the *side* of the thumbnail rather
                      than under it. */}
                  <div className="flex w-[115px] shrink-0 flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPreviewPage(piece.start)}
                      title="Tap to preview page"
                      className="relative aspect-[180/132] w-full overflow-hidden rounded-lg"
                      style={{ border: `1.5px solid ${piece.color}` }}
                    >
                      <PieceThumb title={piece.title} page={piece.start + PAGE_OFFSET} />
                    </button>
                    <span className="text-sm text-ink-soft">
                      Piece {index + 1} • {formatPieceLabel(piece)}
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
                        {...titleField(index)}
                      />
                      {titleError && (
                        <span className="mt-1 flex items-center gap-1 text-xs text-red-700">
                          <IconAlertTriangle size={10} />
                          Required
                        </span>
                      )}
                    </div>
                    {SHOW_COMPOSER_FIELD && (
                      <div>
                        <Controller
                          name={`pieces.${index}.composer`}
                          control={control}
                          rules={composerOrArrangerRules('composer', index)}
                          render={({ field }) => (
                            <TagComboBox
                              label="Composer"
                              options={PEOPLE_OPTIONS}
                              selected={field.value}
                              multiple
                              onChange={(next) => {
                                field.onChange(next)
                                void trigger(`pieces.${index}.arranger`)
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
                    {SHOW_ARRANGER_FIELD && (
                      <div>
                        <Controller
                          name={`pieces.${index}.arranger`}
                          control={control}
                          rules={composerOrArrangerRules('arranger', index)}
                          render={({ field }) => (
                            <TagComboBox
                              label="Arranger"
                              options={PEOPLE_OPTIONS}
                              selected={field.value}
                              multiple
                              onChange={(next) => {
                                field.onChange(next)
                                void trigger(`pieces.${index}.composer`)
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
            className="flex cursor-pointer items-center gap-1.5 text-base text-red-700 hover:text-red-800"
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
          page={previewPage}
          pageCount={PAGE_COUNT}
          onClose={() => setPreviewPage(null)}
          onPrev={() => setPreviewPage((p) => Math.max(1, (p ?? 1) - 1))}
          onNext={() => setPreviewPage((p) => Math.min(PAGE_COUNT, (p ?? 1) + 1))}
        />
      )}
    </div>
  )
}
