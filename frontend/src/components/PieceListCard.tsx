import { useState } from 'react'
import { IconHeartFilled } from '@tabler/icons-react'
import { getPieceThumbnailUrl } from '../api/pieces'
import type { Piece } from '../api/types'
import { formatPieceMeta } from '../lib/formatPieceMeta'
import { ClickableCard } from './ClickableCard'
import { PageCycleControl } from './PageCycleControl'
import { PieceContextMenu } from './PieceContextMenu'
import { TagPills } from './TagPills'

interface PieceListCardProps {
  piece: Piece
  /** Shown by the Piece Details page's own Back control as "Back to
   * {backLabel}" once it's navigated to from here — see PiecePage.tsx's
   * back-button section for the full mechanism. */
  backLabel: string
  /** Passed straight through to PieceContextMenu/EditPieceModal — see
   * PieceContextMenu's own doc comment. */
  siblingPieces?: Piece[]
}

export function PieceListCard({ piece, backLabel, siblingPieces }: PieceListCardProps) {
  const [page, setPage] = useState(piece.thumbnailPage)
  const meta = formatPieceMeta(piece)

  return (
    // No visible "⋯" trigger, same as PieceGridCard — right-click
    // (desktop) and ContextMenu's built-in long-press (touch) cover it instead.
    <PieceContextMenu piece={piece} hideTriggerButton siblingPieces={siblingPieces}>
      <ClickableCard
        to={`/pieces/${piece.id}`}
        state={{ backLabel }}
        className="flex w-full flex-col overflow-hidden rounded-lg border border-border bg-paper-raised p-3 text-left transition-colors hover:border-accent"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            {/* Favorite heart, same treatment as PieceGridCard's title
                line — this list view never had one at all (a real gap, not
                a deliberate omission), so Library/Favorites/Currently
                Practicing's list view silently never showed a piece was
                favorited. */}
            <p className="flex min-w-0 items-center gap-1.5 font-display text-lg font-medium text-ink">
              <span className="truncate">{piece.title}</span>
              {piece.favorite && (
                <span className="shrink-0 text-accent" title="Favorite">
                  <IconHeartFilled size={13} />
                </span>
              )}
            </p>
            {meta && <p className="text-sm text-ink-soft">{meta}</p>}
          </div>
          <div className="flex w-[134px] shrink-0 justify-center">
            <img
              src={getPieceThumbnailUrl(piece.id, page)}
              alt=""
              loading="lazy"
              className="h-[84px] w-auto rounded-md border border-border object-contain"
            />
          </div>
        </div>
        <div className="mt-2 flex items-center border-t border-border pt-2">
          <TagPills
            practiceStatus={piece.practiceStatus}
            keys={piece.keys}
            sheetType={piece.sheetType.value}
            instruments={piece.instruments.values}
            userTags={piece.userTags}
          />
          {/* ml-auto (not justify-between on the parent) so this stays pinned
              under the thumbnail even when TagPills renders nothing — with no
              sibling, justify-between has nothing to push against and the
              control collapses to the start instead of staying on the right. */}
          <div className="ml-auto flex w-[134px] shrink-0 justify-center">
            <PageCycleControl page={page} pageCount={piece.pageCount} onChange={setPage} />
          </div>
        </div>
      </ClickableCard>
    </PieceContextMenu>
  )
}
