import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconBook,
  IconCheck,
  IconEyeOff,
} from '@tabler/icons-react'
import { confirmImport, getBookPageThumbnailUrl } from '../api/books'
import { ApiError } from '../api/client'
import type { Piece as ApiPiece } from '../api/types'
import type { Piece } from '../lib/pieceSplitLogic'
import { TOTAL_WIZARD_STEPS } from './BookUploadWizard'

// Book Upload Wizard, Screen 6 of 6: "Ready to import" (design doc §5's
// "Confirm" step). Real build of UploadBookConfirmMockup.tsx
// (/mockup/upload-book-confirm, kept as a standing design reference) —
// same read-only review + stripe-animation Import button, now a real
// confirmImport mutation tied to mutation.isPending instead of a
// setTimeout. The success screen itself lives in BookUploadWizard.tsx,
// not here — see this component's onImported prop.

const CURRENT_STEP = 6

export interface NamedPiece extends Piece {
  title: string
  composer: string
  arranger: string
}

function formatPageRange(piece: Piece): string {
  return piece.end !== piece.start ? `pp ${piece.start}–${piece.end}` : `pp ${piece.start}`
}

// Composer-or-arranger: fuses arranger onto composer
// (", arr. Arranger"), same convention as everywhere else in this app —
// arranger alone renders as "arr. Arranger" rather than disappearing when
// composer is blank (composer-or-arranger means a piece can legitimately
// have only one of the two).
function composerArrangerLabel(piece: NamedPiece): string {
  if (piece.composer && piece.arranger) return `${piece.composer}, arr. ${piece.arranger}`
  if (piece.composer) return piece.composer
  if (piece.arranger) return `arr. ${piece.arranger}`
  return ''
}

// Compacts a sorted page list into ranges — same convention as the Split
// step's Skipped pill.
function formatPageList(pages: number[]): string {
  const sorted = [...pages].sort((a, b) => a - b)
  if (sorted.length === 0) return ''
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

// The complement of every piece's range against [1, pageCount] — skipped
// pages need no separate tracking once the split is finalized; they're
// simply whatever pages no piece covers.
function deriveSkippedPages(pieces: Piece[], pageCount: number): number[] {
  const covered = new Set<number>()
  for (const piece of pieces) {
    for (let p = piece.start; p <= piece.end; p++) covered.add(p)
  }
  const skipped: number[] = []
  for (let p = 1; p <= pageCount; p++) {
    if (!covered.has(p)) skipped.push(p)
  }
  return skipped
}

interface BookUploadConfirmStepProps {
  bookId: number
  bookTitle: string
  pageCount: number
  pieces: NamedPiece[]
  onBack: () => void
  onImported: (createdPieces: ApiPiece[]) => void
}

export function BookUploadConfirmStep({
  bookId,
  bookTitle,
  pageCount,
  pieces,
  onBack,
  onImported,
}: BookUploadConfirmStepProps) {
  const queryClient = useQueryClient()
  const skippedPages = deriveSkippedPages(pieces, pageCount)

  const importMutation = useMutation({
    mutationFn: () =>
      confirmImport(bookId, {
        ranges: pieces.map((p) => ({ start: p.start, end: p.end })),
        pieces: pieces.map((p) => ({
          title: p.title,
          composer: p.composer || null,
          arranger: p.arranger || null,
          favorite: false,
          keys: [],
          instruments: [],
          userTags: [],
        })),
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      queryClient.invalidateQueries({ queryKey: ['book'] })
      queryClient.invalidateQueries({ queryKey: ['pieces'] })
      onImported(result.pieces)
    },
  })

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6 md:p-8">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={importMutation.isPending}
          className="flex items-center gap-1.5 text-base text-ink-soft hover:text-ink disabled:cursor-default disabled:opacity-45"
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
        <h1 className="font-display text-2xl font-medium text-ink">Ready to import</h1>
        <p className="text-sm text-ink-soft">
          Review before this creates {pieces.length} new pieces.
        </p>
      </div>

      <div className="flex items-center gap-2.5 rounded-md bg-accent-soft px-3.5 py-3">
        <IconBook size={18} className="shrink-0 text-accent" />
        <div>
          <p className="font-display text-sm font-medium text-ink">{bookTitle}</p>
          <p className="text-xs text-ink-soft">
            {pageCount} pages • {pieces.length} pieces
          </p>
        </div>
      </div>

      {skippedPages.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-ink-soft">
          <IconEyeOff size={14} className="shrink-0" />
          {skippedPages.length} page{skippedPages.length === 1 ? '' : 's'} skipped (p.{' '}
          {formatPageList(skippedPages)}) — won't be included in any piece
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3">
        {pieces.map((piece, index) => (
          <div
            key={index}
            className="overflow-hidden rounded-lg border border-border bg-paper-raised"
            style={{ borderColor: piece.color }}
          >
            <img
              src={getBookPageThumbnailUrl(bookId, piece.start)}
              alt=""
              loading="lazy"
              className="block h-auto w-full"
            />
            <div className="flex flex-col gap-px px-2 py-1.5">
              <p className="truncate font-display text-[0.8rem] font-medium text-ink">
                {piece.title}
              </p>
              <p className="truncate text-[0.7rem] text-ink-soft">{composerArrangerLabel(piece)}</p>
              <p className="truncate text-[0.7rem] text-ink-soft">{formatPageRange(piece)}</p>
            </div>
          </div>
        ))}
      </div>

      {importMutation.isError && (
        <p className="flex items-center gap-2 text-sm text-red-700">
          <IconAlertTriangle size={16} />
          {importMutation.error instanceof ApiError
            ? importMutation.error.message
            : 'Could not import. Please try again.'}
        </p>
      )}

      <div className="flex items-center justify-end border-t border-border pt-5">
        <button
          type="button"
          onClick={() => importMutation.mutate()}
          disabled={importMutation.isPending}
          className="relative flex min-w-[190px] shrink-0 items-center justify-center overflow-hidden rounded-md bg-accent px-4 py-2.5 font-display whitespace-nowrap text-white disabled:cursor-default"
        >
          {importMutation.isPending && (
            <span
              aria-hidden="true"
              className="absolute inset-0 animate-stripe-move bg-[length:56px_56px] [background-image:repeating-linear-gradient(45deg,rgba(255,255,255,0.3)_0,rgba(255,255,255,0.3)_10px,transparent_10px,transparent_20px)] motion-reduce:animate-none motion-reduce:opacity-60"
            />
          )}
          <span className="relative z-10 flex items-center gap-1.5">
            {!importMutation.isPending && (
              <>
                <IconCheck size={16} />
                Import {pieces.length} Pieces
              </>
            )}
            {importMutation.isPending && `Importing ${pieces.length} pieces…`}
          </span>
        </button>
      </div>
    </div>
  )
}
