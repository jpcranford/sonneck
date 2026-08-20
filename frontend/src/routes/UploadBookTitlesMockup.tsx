import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { IconAlertTriangle, IconArrowLeft, IconArrowRight, IconX } from '@tabler/icons-react'
import { useMockupTitle } from '../lib/useMockupTitle'

// ---------------------------------------------------------------------
// DESIGN MOCKUP — Book Upload Wizard, Screen 5 of 6: "Name each piece"
// (design doc §5's "fill fields" step). Not wired to the API — the piece
// list below is a fixed local fixture, same book as Screens 3 and 4
// (frontend-book-upload-wizard memory's "Album für die Jugend" fixture),
// continued here for continuity across the wizard's mockups.
// Locked design: https://claude.ai/code/artifact/8db38350-9f5f-4e11-b227-209a64e06ede
//
// Field entry is deliberately light — just Title (required) and Composer
// (required only because this particular book has none set at the book
// level; a book WITH a composer wouldn't ask for it here at all, since
// book-level soft inheritance already covers it). Genuinely interactive:
// clear a field and hit Next to see the real required-field validation
// the locked artifact demonstrated with a permanently-blank row — this
// mockup validates for real instead of hard-coding that blank state.
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
}

// Same 3 pieces, same colors (PALETTE[0..2] from Screen 4's Garden
// Variety palette), same book — carried forward for continuity rather
// than inventing a new fixture for this screen.
const PIECES: PieceFixture[] = [
  {
    start: 1,
    end: 3,
    isLast: false,
    color: '#6b8a9c',
    title: 'Prelude in C',
    composer: 'J. Burgmüller',
  },
  { start: 5, end: 7, isLast: false, color: '#b8935a', title: 'Nocturne', composer: 'Fr. Chopin' },
  {
    start: 7,
    end: 8,
    isLast: true,
    color: '#9c7ab8',
    title: 'Waltz in A♭',
    composer: 'Fr. Chopin',
  },
]

// This book has no composer set at the book level — the reason the
// Composer field appears here at all (design doc §5: only asked when the
// book itself has none set, since book-level soft inheritance otherwise
// covers it).
const BOOK_HAS_COMPOSER = false

function formatPieceLabel(piece: PieceFixture) {
  return `pp ${piece.start}${piece.end !== piece.start ? `–${piece.end}` : ''}${piece.isLast ? '+' : ''}`
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

// Full-page preview overlay — tap a thumbnail to see the page larger,
// dismiss via the close button, clicking the backdrop, or Escape. No
// dedicated shared "preview toast" component exists yet in the codebase
// to reuse (checked before building this) — Modal.tsx is close but wraps
// content in a white card meant for forms, not a borderless centered
// image over a dimmed backdrop, so this is purpose-built for that shape
// instead, reusing Modal.tsx's own proven backdrop-click/Escape/double-
// rAF-transition conventions rather than reinventing those specific
// mechanics. Click-to-open, not hover — device-aware conventions (CLAUDE.md)
// rule out relying on hover anywhere in the app.
function PagePreviewOverlay({ piece, onClose }: { piece: PieceFixture; onClose: () => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => setVisible(true))
    })
    return () => cancelAnimationFrame(raf1)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-ink/60 backdrop-blur-sm transition-opacity duration-150 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={`flex w-full max-w-xs flex-col items-center gap-3 px-6 transition-[transform,opacity] duration-150 ${
          visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
      >
        <div
          className="w-full overflow-hidden rounded-md shadow-2xl"
          style={{ border: `2px solid ${piece.color}` }}
        >
          <PieceThumb title={piece.title} page={piece.start} />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        >
          <IconX size={18} />
        </button>
      </div>
    </div>
  )
}

interface FormValues {
  pieces: { title: string; composer: string }[]
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
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: { pieces: PIECES.map((p) => ({ title: p.title, composer: p.composer })) },
  })

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
        <p className="text-sm text-ink-soft">Tap a thumbnail to see the page larger.</p>
      </div>

      <form onSubmit={handleSubmit((data) => console.log('Mockup: advance to Confirmation', data))}>
        {/* Desktop: table-like grid, piece label first, thumbnail tucked
            tight against Title, then Composer — order and column widths
            locked in the artifact. */}
        {isDesktop && (
          <div>
            <div className="grid grid-cols-[128px_38px_1fr_1fr] gap-2.5 px-3 pb-1.5">
              <span />
              <span />
              <span className="text-xs font-semibold text-ink-soft">Title *</span>
              <span className="text-xs font-semibold text-ink-soft">
                Composer {!BOOK_HAS_COMPOSER && '* (book has none set)'}
              </span>
            </div>
            <div className="flex flex-col border-t border-border">
              {PIECES.map((piece, index) => {
                const titleError = errors.pieces?.[index]?.title
                const composerError = errors.pieces?.[index]?.composer
                return (
                  <div
                    key={piece.start}
                    className={`grid grid-cols-[128px_38px_1fr_1fr] items-center gap-2.5 px-3 py-1.5 ${
                      index % 2 === 0 ? 'bg-paper-sunken' : ''
                    }`}
                  >
                    <span className="text-sm text-ink-soft">
                      Piece {index + 1} • {formatPieceLabel(piece)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPreviewIndex(index)}
                      title="Tap to preview page"
                      className="overflow-hidden rounded"
                      style={{ border: `1.5px solid ${piece.color}` }}
                    >
                      <PieceThumb title={piece.title} page={piece.start} />
                    </button>
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
                        {...register(`pieces.${index}.composer`, {
                          required: !BOOK_HAS_COMPOSER,
                          maxLength: 255,
                        })}
                      />
                      {composerError && (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-red-700">
                          <IconAlertTriangle size={10} />
                          Required
                        </span>
                      )}
                    </div>
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
              return (
                <div
                  key={piece.start}
                  className={`flex items-start gap-3.5 px-4 py-3.5 ${index % 2 === 0 ? 'bg-paper-sunken' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => setPreviewIndex(index)}
                    title="Tap to preview page"
                    className="w-[115px] shrink-0 overflow-hidden rounded"
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
                      <label className="mb-1 block text-sm text-ink-soft">
                        Composer {!BOOK_HAS_COMPOSER && <span className="text-red-700">*</span>}
                        {!BOOK_HAS_COMPOSER && ' (book has none set)'}
                      </label>
                      <input
                        className={`w-full rounded-md border bg-paper-raised px-3 py-2 text-base text-ink ${
                          composerError ? 'border-red-700' : 'border-border'
                        }`}
                        placeholder="Composer"
                        {...register(`pieces.${index}.composer`, {
                          required: !BOOK_HAS_COMPOSER,
                          maxLength: 255,
                        })}
                      />
                      {composerError && (
                        <span className="mt-1 flex items-center gap-1 text-xs text-red-700">
                          <IconAlertTriangle size={10} />
                          Required
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="flex justify-end border-t border-border pt-5">
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
        <PagePreviewOverlay piece={PIECES[previewIndex]} onClose={() => setPreviewIndex(null)} />
      )}
    </div>
  )
}
