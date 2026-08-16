import { useRef } from 'react'
import { IconDotsVerticalFilled } from '@tabler/icons-react'
import { getPieceThumbnailUrl } from '../api/pieces'
import type { Piece } from '../api/types'
import { ClickableCard } from './ClickableCard'
import { PieceContextMenu } from './PieceContextMenu'
import type { ContextMenuHandle } from './ContextMenu'
import { TagPills } from './TagPills'

interface PieceGridCardProps {
  piece: Piece
}

// No page-cycle control here — the locked mockup only shows it on list
// cards (see PieceListCard). Grid always shows the piece's first page.
export function PieceGridCard({ piece }: PieceGridCardProps) {
  const menuRef = useRef<ContextMenuHandle>(null)

  return (
    <PieceContextMenu piece={piece} ref={menuRef} hideTriggerButton>
      <ClickableCard
        to={`/pieces/${piece.id}`}
        className="flex flex-col overflow-hidden rounded-lg border border-border bg-paper-raised text-left transition-colors hover:border-accent"
      >
        <div className="relative aspect-[180/132] w-full overflow-hidden bg-border">
          <img
            src={getPieceThumbnailUrl(piece.id, 1)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover object-top"
          />
          {/* Anchored to the thumbnail specifically (bottom-right), not the
              whole card — the card's own text/tag section below the
              thumbnail varies in height, so this can't be a simple
              top/bottom offset on the outer card the way list cards' can. */}
          <button
            type="button"
            aria-label="More actions"
            onClick={(event) => {
              event.stopPropagation()
              const rect = event.currentTarget.getBoundingClientRect()
              menuRef.current?.open(rect.right, rect.bottom)
            }}
            className="absolute right-2 bottom-2 z-10 flex size-7 items-center justify-center rounded-md bg-paper-raised/90 text-ink-soft shadow-sm hover:text-ink"
          >
            <IconDotsVerticalFilled size={16} />
          </button>
        </div>
        <div className="flex flex-col gap-1 p-3">
          <p className="truncate font-display text-sm font-medium text-ink">{piece.title}</p>
          {piece.composer.value && (
            <p className="truncate text-xs text-ink-soft">{piece.composer.value}</p>
          )}
          <div className="mt-1 flex items-center justify-end">
            <TagPills
              keys={piece.keys}
              sheetType={piece.sheetType.value}
              instruments={piece.instruments.values}
              userTags={piece.userTags}
            />
          </div>
        </div>
      </ClickableCard>
    </PieceContextMenu>
  )
}
