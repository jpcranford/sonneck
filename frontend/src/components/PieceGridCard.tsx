import { getPieceThumbnailUrl } from '../api/pieces'
import type { Piece } from '../api/types'
import { ClickableCard } from './ClickableCard'
import { PieceContextMenu } from './PieceContextMenu'
import { TagPills } from './TagPills'

interface PieceGridCardProps {
  piece: Piece
}

// No page-cycle control here — the locked mockup only shows it on list
// cards (see PieceListCard). Grid always shows the piece's first page.
export function PieceGridCard({ piece }: PieceGridCardProps) {
  return (
    <PieceContextMenu piece={piece}>
      <ClickableCard
        to={`/pieces/${piece.id}`}
        className="flex flex-col overflow-hidden rounded-lg border border-border bg-paper-raised text-left transition-colors hover:border-accent"
      >
        <div className="aspect-[180/132] w-full overflow-hidden bg-border">
          <img
            src={getPieceThumbnailUrl(piece.id, 1)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover object-top"
          />
        </div>
        <div className="flex flex-col gap-1 p-3">
          <p className="truncate font-display text-sm text-ink">{piece.title}</p>
          {piece.composer.value && (
            <p className="truncate text-xs text-ink-soft">{piece.composer.value}</p>
          )}
          <div className="mt-1 flex items-center justify-end">
            <TagPills musicalKey={piece.key} userTags={piece.userTags} />
          </div>
        </div>
      </ClickableCard>
    </PieceContextMenu>
  )
}
