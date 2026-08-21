import { forwardRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { deletePiece, updatePiece } from '../api/pieces'
import { ApiError } from '../api/client'
import type { Piece } from '../api/types'
import { pieceToWriteRequest } from '../lib/pieceToWriteRequest'
import { ContextMenu, type ContextMenuHandle } from './ContextMenu'
import { EditPieceModal } from './EditPieceModal'

interface PieceContextMenuProps {
  piece: Piece
  children: ReactNode
  /** Passed through to ContextMenu — set when a caller supplies its own
   * custom-positioned trigger via this component's forwarded ref instead
   * (see PieceGridCard, which anchors its trigger to the thumbnail). */
  hideTriggerButton?: boolean
}

// Shared right-click menu for piece cards (grid + list): a favorite toggle,
// "Edit Piece", and, at the end, a destructive "Delete Piece".
export const PieceContextMenu = forwardRef<ContextMenuHandle, PieceContextMenuProps>(
  function PieceContextMenu({ piece, children, hideTriggerButton }, ref) {
    const [editOpen, setEditOpen] = useState(false)
    const queryClient = useQueryClient()

    // Same full-replace PATCH pattern as PiecePage's own favorite toggle
    // (its keyboard-shortcut "F" and header heart button) — kept here as a
    // separate mutation rather than a shared hook since there's nowhere
    // else yet that both need it from outside a piece-details context.
    const favoriteMutation = useMutation({
      mutationFn: () => updatePiece(piece.id, { ...pieceToWriteRequest(piece), favorite: !piece.favorite }),
      onSuccess: (updated) => {
        queryClient.setQueryData(['piece', piece.id], updated)
        queryClient.invalidateQueries({ queryKey: ['pieces'] })
      },
      onError: (error) => {
        window.alert(error instanceof ApiError ? error.message : 'Could not update this piece.')
      },
    })

    // Hard delete, no undo (CLAUDE.md > File handling) — confirm before
    // sending it. A native confirm() rather than a custom modal: cheap,
    // blocking (can't misclick past it), fine for a single yes/no gate.
    const deleteMutation = useMutation({
      mutationFn: () => deletePiece(piece.id),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['pieces'] })
      },
      onError: (error) => {
        window.alert(error instanceof ApiError ? error.message : 'Could not delete this piece.')
      },
    })

    return (
      <>
        <ContextMenu
          ref={ref}
          hideTriggerButton={hideTriggerButton}
          items={[
            {
              label: piece.favorite ? 'Remove from Favorites' : 'Add to Favorites',
              onSelect: () => favoriteMutation.mutate(),
            },
            { label: 'Edit Piece', onSelect: () => setEditOpen(true) },
            {
              label: 'Delete Piece',
              destructive: true,
              onSelect: () => {
                if (window.confirm(`Delete "${piece.title}"? This can't be undone.`)) {
                  deleteMutation.mutate()
                }
              },
            },
          ]}
        >
          {children}
        </ContextMenu>
        <EditPieceModal piece={piece} open={editOpen} onClose={() => setEditOpen(false)} />
      </>
    )
  },
)
