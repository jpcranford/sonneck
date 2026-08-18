import { IconProgress } from '@tabler/icons-react'
import { getPieceThumbnailUrl } from '../api/pieces'
import type { Piece } from '../api/types'
import { ClickableCard } from './ClickableCard'
import { PieceContextMenu } from './PieceContextMenu'

interface PieceGridCardProps {
  piece: Piece
}

// No page-cycle control here — the locked mockup only shows it on list
// cards (see PieceListCard). Grid always shows the piece's first page.
export function PieceGridCard({ piece }: PieceGridCardProps) {
  // Composer (+ arranger) • year written only — narrower than
  // PieceListCard's formatPieceMeta (which also folds in opus number/
  // source book), since the grid card's tighter layout only has room for
  // the two most identifying fields. Same "•" bullet convention, same
  // blank-omission rule (design doc §6 citation philosophy). Arranger
  // rides on the composer segment itself ("Author, arr. Arranger"), not
  // as its own bullet-separated part — it qualifies the composer, it
  // isn't a peer fact like the year.
  const composerPart = piece.composer.value
    ? piece.composer.value + (piece.arranger ? `, arr. ${piece.arranger}` : '')
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
        className="flex flex-col overflow-hidden rounded-lg border border-border bg-paper-raised text-left transition-colors hover:border-accent"
      >
        <div className="relative aspect-[180/132] w-full overflow-hidden bg-border">
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
            <span className="absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-3rem)] items-center gap-1 rounded-full bg-accent-soft/90 px-2 py-0.5 text-xs font-medium text-accent shadow-sm backdrop-blur-sm">
              <IconProgress size={11} className="shrink-0" />
              <span className="truncate">{piece.practiceStatus}</span>
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1 p-3">
          <p className="truncate font-display text-sm font-medium text-ink">{piece.title}</p>
          {meta && <p className="truncate text-xs text-ink-soft">{meta}</p>}
        </div>
      </ClickableCard>
    </PieceContextMenu>
  )
}
