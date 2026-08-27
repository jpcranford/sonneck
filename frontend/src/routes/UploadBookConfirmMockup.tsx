import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  IconArrowLeft,
  IconBook,
  IconBook2,
  IconCheck,
  IconCircleCheckFilled,
  IconEyeOff,
  IconX,
} from '@tabler/icons-react'
import { useMockupTitle } from '../lib/useMockupTitle'

// ---------------------------------------------------------------------
// DESIGN MOCKUP — Book Upload Wizard, Screen 6 of 6: "Ready to import"
// (design doc §5's "Confirm" step, the final screen). Not wired to the
// API — the piece list is the same fixed "Album für die Jugend" fixture
// used throughout the wizard's mockups. Read-only review, not editable —
// nothing here is a form field.
//
// Genuinely interactive: clicking "Import" runs a real (if simulated —
// there's no backend to actually call from a mockup) idle -> importing ->
// success state machine, reusing EditBookModal.tsx's own real stripe-
// animation button pattern (`animate-stripe-move`) rather than a static
// comparison of the two states. The success screen reuses UploadPage.tsx's
// exact "done" convention (IconCircleCheckFilled, "Upload another file"
// resets back to the start) and demonstrates the imported-titles
// sentence's truncation rule — verified for both the ≤3 and >3 cases via
// a standalone script before wiring it in, since this fixed 3-piece
// fixture only ever exercises the ≤3 branch live.
// ---------------------------------------------------------------------

const TOTAL_STEPS = 6
const CURRENT_STEP = 6
// Simulates a printed-page correction having been set back on Screen 3
// ("About this book," see UploadBookAboutMockup.tsx's own "Printed-PDF
// page number offset" field) — piece.start/piece.end stay the raw PDF
// position, only the numbers *displayed* below (sourcePageStart/
// sourcePageEnd, once this actually imports) are shown offset-adjusted,
// same convention as UploadBookSplitMockup.tsx/UploadBookTitlesMockup.tsx.
const PAGE_OFFSET = 6

interface PieceFixture {
  start: number
  end: number
  color: string
  title: string
  composer: string
}

const BOOK_TITLE = 'Album für die Jugend, Op. 68'
const PAGE_COUNT = 8
const SKIPPED_PAGES = [4]

// Same 3 pieces, same colors, same book as Screens 4 and 5 — carried
// forward for continuity. No `isLast`/open-piece state here: by the
// confirm step every piece is a final, closed range, so page ranges
// render as plain "pp. X–Y" with no trailing "+".
const PIECES: PieceFixture[] = [
  { start: 1, end: 3, color: '#6b8a9c', title: 'Prelude in C', composer: 'J. Burgmüller' },
  { start: 5, end: 7, color: '#b8935a', title: 'Nocturne', composer: 'Fr. Chopin' },
  { start: 7, end: 8, color: '#9c7ab8', title: 'Waltz in A♭', composer: 'Fr. Chopin' },
]

// Academic p./pp. convention app-wide (singular vs. a range), same as
// PiecePage.tsx/BookDetailsPage.tsx — this card grid had drifted to a
// bare "pp" with no period and no singular form.
function formatPageRange(piece: PieceFixture): string {
  const start = piece.start + PAGE_OFFSET
  const end = piece.end + PAGE_OFFSET
  return end !== start ? `pp. ${start}–${end}` : `p. ${start}`
}

// Compacts a sorted page list into ranges — same convention as Screen 4's
// Skipped pill ("4–6" not "4, 5, 6"), reused here for the same reason.
function formatPageList(pages: number[]): string {
  const sorted = [...pages].sort((a, b) => a - b)
  const parts: string[] = []
  let rangeStart = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i <= sorted.length; i++) {
    const current = sorted[i]
    if (current !== prev + 1) {
      parts.push(rangeStart === prev ? `${rangeStart}` : `${rangeStart}–${prev}`)
      rangeStart = current
    }
    prev = current
  }
  return parts.join(', ')
}

// The locked truncation rule: ≤3 pieces lists every title in full ("X";
// "X" and "Y"; "X", "Y", and "Z"); >3 lists only the first two titles,
// then "and N more pieces" where N is the remainder, not the total.
function formatImportedTitlesSentence(titles: string[]): string {
  const quoted = titles.map((t) => `"${t}"`)
  const verb = quoted.length === 1 ? 'is' : 'are'
  if (quoted.length <= 3) {
    const list =
      quoted.length === 1
        ? quoted[0]
        : quoted.length === 2
          ? `${quoted[0]} and ${quoted[1]}`
          : `${quoted[0]}, ${quoted[1]}, and ${quoted[2]}`
    return `${list} ${verb} now in your library.`
  }
  const remainder = quoted.length - 2
  return `${quoted[0]}, ${quoted[1]}, and ${remainder} more piece${remainder === 1 ? '' : 's'} are now in your library.`
}

// Same illustrative-SVG spirit as Screens 4/5's page thumbnails — full
// portrait shape here (not cropped/landscape), per the artifact's
// explicit deviation from Book Details' real PieceGrid styling: only its
// column *sizing* is reused, not its landscape-crop-plus-pill-overlay
// look.
function PieceThumb({ title }: { title: string }) {
  const staffGroupYs = [58, 91, 124, 157, 190, 223]
  const lineOffsets = [0, 3.5, 7, 10.5, 14]
  return (
    <svg viewBox="0 0 200 260" className="block h-auto w-full">
      <rect x="0.5" y="0.5" width="199" height="259" fill="#fffdf9" stroke="#e4e0d8" />
      <text x="100" y="26" textAnchor="middle" fontFamily="var(--font-display)" fontSize="9" fill="#5c5349">
        {title}
      </text>
      {staffGroupYs.map((y) => (
        <g key={y} stroke="#c9c2b6" strokeWidth="0.5">
          {lineOffsets.map((offset) => (
            <line key={offset} x1="18" x2="182" y1={y + offset} y2={y + offset} />
          ))}
        </g>
      ))}
    </svg>
  )
}

type Stage = 'confirm' | 'importing' | 'success'

export function UploadBookConfirmMockup() {
  useMockupTitle('Upload — Confirm Import')

  const [stage, setStage] = useState<Stage>('confirm')

  function handleImport() {
    setStage('importing')
    // No real backend to call from a mockup — this stands in for the
    // genuine extraction/hash/create work a multi-piece import actually
    // does, which is why the button shows a real in-flight state at all
    // rather than resolving instantly.
    setTimeout(() => setStage('success'), 1400)
  }

  function handleCancelUpload() {
    const confirmed = window.confirm(
      "Cancel this upload? The uploaded file and its generated page previews will be permanently removed from the server.",
    )
    if (!confirmed) return
    // Mockup only — see UploadBookAboutMockup.tsx's own copy of this
    // function for the real-build notes (DELETE /api/books/{id}, thumbnail
    // cache cleanup gap, return-to-Upload-landing). Only reachable while
    // stage === 'confirm' here (see the chrome's own conditional below) —
    // once a real import has actually run, pieces exist and there's
    // nothing left to "cancel."
    console.log('Mockup: cancel confirmed — would delete book + cached thumbnails, return to Upload landing')
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6 md:p-8">
      <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
        Design mockup —{' '}
        <span className="font-medium text-ink">Book Upload Wizard, Screen 6 of 6: "Ready to import"</span> (design
        doc §5). Not wired to real data — click Import to see the real stripe-animation loading state and the
        success screen.
      </div>

      {stage !== 'success' && (
        <>
          {/* Wizard chrome — identical to Screens 3–5's, carried forward
              verbatim, including Back routing to /mockup rather than
              simulating real step-nav — see UploadBookAboutMockup.tsx's
              own comment on this. */}
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
                      step < CURRENT_STEP ? 'bg-accent-on-dark' : step === CURRENT_STEP ? 'bg-accent' : 'bg-border'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          <div>
            <h1 className="font-display text-2xl font-medium text-ink">Ready to import</h1>
            <p className="text-sm text-ink-soft">Review before this creates {PIECES.length} new pieces.</p>
          </div>

          <div className="flex items-center gap-2.5 rounded-md bg-accent-soft px-3.5 py-3">
            <IconBook size={18} className="shrink-0 text-accent" />
            <div>
              <p className="font-display text-sm font-medium text-ink">{BOOK_TITLE}</p>
              <p className="text-xs text-ink-soft">
                {PAGE_COUNT} pages • {PIECES.length} pieces
              </p>
            </div>
          </div>

          {SKIPPED_PAGES.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-ink-soft">
              <IconEyeOff size={14} className="shrink-0" />
              {SKIPPED_PAGES.length} page{SKIPPED_PAGES.length === 1 ? '' : 's'} skipped (p.{' '}
              {formatPageList(SKIPPED_PAGES.map((p) => p + PAGE_OFFSET))}) — won't be included in any piece
            </div>
          )}

          <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3">
            {PIECES.map((piece) => (
              <div
                key={piece.start}
                className="overflow-hidden rounded-lg border border-border bg-paper-raised"
                style={{ borderColor: piece.color }}
              >
                {/* border-b hairline between thumbnail and info text — same
                    treatment as the Piece/Book Library grid cards
                    (PieceGridCard.tsx/BookGridCard.tsx); this card just
                    never had it. */}
                <div className="border-b border-border">
                  <PieceThumb title={piece.title} />
                </div>
                <div className="flex flex-col gap-px px-2 py-1.5">
                  <p className="truncate font-display text-[0.8rem] font-medium text-ink">{piece.title}</p>
                  <p className="truncate text-[0.7rem] text-ink-soft">{piece.composer}</p>
                  <p className="truncate text-[0.7rem] text-ink-soft">{formatPageRange(piece)}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Cancel upload shares this row with Import — see
              UploadBookAboutMockup.tsx's own comment on this same row for
              the full placement/styling reasoning. Disabled once stage ===
              'importing', same reasoning as the Import button's own
              disabled state right next to it — the create request is
              already in flight by then, nothing left to cancel. */}
          <div className="flex items-center justify-between border-t border-border pt-5">
            <button
              type="button"
              onClick={handleCancelUpload}
              disabled={stage === 'importing'}
              className="flex cursor-pointer items-center gap-1.5 text-base text-red-700 hover:text-red-800 disabled:pointer-events-none disabled:opacity-40"
            >
              <IconX size={24} />
              Cancel upload
            </button>
            {/* min-w, not a fixed width — "Importing N pieces…" is longer
                than "Import N Pieces", and should push the button wider
                to stay on one line rather than wrap and grow taller
                instead (whitespace-nowrap is what actually prevents the
                wrap; min-w just keeps the idle state from looking
                undersized). */}
            <button
              type="button"
              onClick={handleImport}
              disabled={stage === 'importing'}
              className="relative flex min-w-[190px] shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md bg-accent px-4 py-2.5 font-display whitespace-nowrap text-white disabled:cursor-default"
            >
              {stage === 'importing' && (
                <span
                  aria-hidden="true"
                  className="absolute inset-0 animate-stripe-move bg-[length:56px_56px] [background-image:repeating-linear-gradient(45deg,rgba(255,255,255,0.3)_0,rgba(255,255,255,0.3)_10px,transparent_10px,transparent_20px)] motion-reduce:animate-none motion-reduce:opacity-60"
                />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                {stage === 'confirm' && (
                  <>
                    <IconCheck size={16} />
                    Import {PIECES.length} Pieces
                  </>
                )}
                {stage === 'importing' && `Importing ${PIECES.length} pieces…`}
              </span>
            </button>
          </div>
        </>
      )}

      {stage === 'success' && (
        <div className="flex w-full max-w-md flex-col items-center gap-3 self-center text-center">
          <IconCircleCheckFilled size={40} className="text-accent" />
          <h1 className="font-display text-2xl font-medium text-ink">{PIECES.length} pieces imported</h1>
          <p className="text-sm text-ink-soft">{formatImportedTitlesSentence(PIECES.map((p) => p.title))}</p>
          <div className="mt-1 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setStage('confirm')}
              className="rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
            >
              Upload another file
            </button>
            {/* No real book to link to in this fixture-data mockup — real
                build (BookUploadWizard.tsx) links to /books/:id instead. */}
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90"
            >
              <IconBook2 size={16} />
              Open book
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
