import { useState } from 'react'
import { getPieceThumbnailUrl } from '../api/pieces'
import type { Piece } from '../api/types'
import { formatPieceMeta } from '../lib/formatPieceMeta'
import { ClickableCard } from './ClickableCard'
import { PageCycleControl } from './PageCycleControl'
import { PieceContextMenu } from './PieceContextMenu'
import { TagPills } from './TagPills'

interface PieceListCardProps {
  piece: Piece
}

export function PieceListCard({ piece }: PieceListCardProps) {
  const [page, setPage] = useState(piece.thumbnailPage)
  const meta = formatPieceMeta(piece)

  return (
    <PieceContextMenu piece={piece}>
      <ClickableCard
        to={`/pieces/${piece.id}`}
        className="flex w-full flex-col overflow-hidden rounded-lg border border-border bg-paper-raised p-3 text-left transition-colors hover:border-accent"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="truncate font-display text-lg font-medium text-ink">{piece.title}</p>
            {meta && <p className="truncate text-sm text-ink-soft">{meta}</p>}
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
