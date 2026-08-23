import { IconHeartFilled } from '@tabler/icons-react'
import { getPieceThumbnailUrl } from '../api/pieces'
import type { Piece } from '../api/types'
import { ClickableCard } from './ClickableCard'
import { PieceContextMenu } from './PieceContextMenu'
import { PracticeStatusIcon } from './PracticeStatusIcon'

interface PieceGridCardProps {
  piece: Piece
  /** Shown by the Piece Details page's own Back control as "Back to
   * {backLabel}" once it's navigated to from here — see PiecePage.tsx's
   * back-button section for the full mechanism. */
  backLabel: string
}

// No page-cycle control here — the locked mockup only shows it on list
// cards (see PieceListCard). Grid always shows the piece's first page.
export function PieceGridCard({ piece, backLabel }: PieceGridCardProps) {
  // Composer (+ arranger) • year written only — narrower than
  // PieceListCard's formatPieceMeta (which also folds in opus number/
  // source book), since the grid card's tighter layout only has room for
  // the two most identifying fields. Same "•" bullet convention, same
  // blank-omission rule (design doc §6 citation philosophy). Arranger
  // rides on the composer segment itself ("Author, arr. Arranger"), not
  // as its own bullet-separated part — it qualifies the composer, it
  // isn't a peer fact like the year.
  //
  // Three-way fallback (composer-or-arranger, 2026-08-20): falls back to
  // "arr. Arranger" when only an arranger is set (own or book-inherited) —
  // the old two-way ternary silently dropped that case entirely.
  const composerPart =
    piece.composer.value && piece.arranger.value
      ? `${piece.composer.value}, arr. ${piece.arranger.value}`
      : piece.composer.value
        ? piece.composer.value
        : piece.arranger.value
          ? `arr. ${piece.arranger.value}`
          : null
  const meta = [composerPart, piece.yearWritten.value]
    .filter((part): part is string => !!part)
    .join(' • ')

  return (
    // No visible "⋯" trigger on grid cards (removed 2026-08-18 — a
    // permanently-visible button on every card in a dense grid read as
    // clutter, and it only ever existed for touch users anyway since
    // desktop already has right-click). Touch users get the menu via
    // ContextMenu's built-in long-press instead; hideTriggerButton stays
    // true so the button doesn't fall back in.
    <PieceContextMenu piece={piece} hideTriggerButton>
      <ClickableCard
        to={`/pieces/${piece.id}`}
        state={{ backLabel }}
        className="flex flex-col overflow-hidden rounded-lg border border-border bg-paper-raised text-left transition-colors hover:border-accent"
      >
        {/* border-b hairline between thumbnail and info text (2026-08-21,
            direct instruction) — tested first on Book Details' own grid
            card (BookDetailsSample.tsx/BookDetailsPage.tsx), approved,
            ported here. Previously nothing but whitespace separated the
            two; relied entirely on the outer card border to read as "one
            card." */}
        <div className="relative aspect-[180/132] w-full overflow-hidden border-b border-border bg-border">
          <img
            src={getPieceThumbnailUrl(piece.id, piece.thumbnailPage)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover object-top"
          />
          {/* Very soft white scrim behind the practice-status badge only —
              real scans vary (a plain white notation page vs. a dark cover
              photo), and this gives the badge something consistent to sit
              on without visibly washing out the artwork above it. "Light"
              strength chosen from a 4-step comparison (design review,
              2026-08-17, upgraded from "Subtle" same day): https://claude.ai/code/artifact/be28d110-28a2-4459-ae73-3bdcdced142a */}
          {piece.practiceStatus && (
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-[linear-gradient(to_top,rgba(255,255,255,0.55)_0%,rgba(255,255,255,0.1925)_32%,rgba(255,255,255,0)_62%)]"
            />
          )}
          {/* Practice status as a badge over the thumbnail, not a footer
              pill — keeps every grid card the same height regardless of
              whether a status is set, instead of the text block growing by
              a row when one is present (design review, 2026-08-17: "Option
              B" from a 5-way comparison). Bottom-left. */}
          {piece.practiceStatus && (
            // Opaque background (was bg-accent-soft/90 + backdrop-blur-sm)
            // — the translucent version still had a hard time standing out
            // against busy scan artwork; solid + no blur reads clearly
            // regardless of what's underneath. Icon size unified to 13px
            // (was 11px) to match the Piece Details pill exactly — the two
            // are now the same icon/text size everywhere a status shows.
            <span className="absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-3rem)] items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent shadow-sm">
              <PracticeStatusIcon status={piece.practiceStatus} size={13} className="shrink-0" />
              <span className="truncate">{piece.practiceStatus}</span>
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1 p-3">
          <p className="flex min-w-0 items-center gap-1.5 font-display text-sm font-medium text-ink">
            <span className="truncate">{piece.title}</span>
            {piece.favorite && (
              <span className="shrink-0 text-accent" title="Favorite">
                <IconHeartFilled size={13} />
              </span>
            )}
          </p>
          {meta && <p className="truncate text-xs text-ink-soft">{meta}</p>}
        </div>
      </ClickableCard>
    </PieceContextMenu>
  )
}
