import { forwardRef, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deletePiece, setPiecePracticeStatus, updatePiece } from '../api/pieces'
import { listPracticeStatuses } from '../api/lookups'
import { ApiError } from '../api/client'
import type { Piece } from '../api/types'
import { hasPermission, useAuth } from '../lib/AuthContext'
import { pieceToWriteRequest } from '../lib/pieceToWriteRequest'
import { ContextMenu, type ContextMenuHandle } from './ContextMenu'
import { EditPieceModal } from './EditPieceModal'
import { AddToSetlistPicker } from './AddToSetlistPicker'
import { PracticeStatusStrip } from './PracticeStatusStrip'
import { confirmAction, showAlert } from '../lib/dialogs'

interface PieceContextMenuProps {
  piece: Piece
  children: ReactNode
  /** Passed through to ContextMenu — set when a caller supplies its own
   * custom-positioned trigger via this component's forwarded ref instead
   * (see PieceGridCard, which anchors its trigger to the thumbnail). */
  hideTriggerButton?: boolean
  /** Passed straight through to EditPieceModal — the ordered list a
   * caller wants "Edit Piece"'s footer nav arrows to cycle through
   * (whatever's currently on screen at the call site). Optional; omitting
   * it hides the nav control entirely. */
  siblingPieces?: Piece[]
}

// Shared right-click menu for piece cards (Library grid + list, Book
// Details, Person Details): the practice status strip on top (hidden
// without `practice`), then a favorite toggle, "Add to Setlist" (hidden
// without `create`), "Edit Piece", and, at the end, a destructive
// "Delete Piece".
export const PieceContextMenu = forwardRef<ContextMenuHandle, PieceContextMenuProps>(
  function PieceContextMenu({ piece, children, hideTriggerButton, siblingPieces }, ref) {
    const [editOpen, setEditOpen] = useState(false)
    const [pickerOpen, setPickerOpen] = useState(false)
    const cardRef = useRef<HTMLDivElement>(null)
    const queryClient = useQueryClient()
    const canEdit = hasPermission(useAuth(), 'edit')
    const canDelete = hasPermission(useAuth(), 'delete')
    // Hidden, not shown faint, without `create`: setlists are the one
    // thing that permission covers, so there's nothing to offer.
    const canCreate = hasPermission(useAuth(), 'create')
    // Hidden, not faded, without `practice` — the same call as the
    // Add to Setlist item above.
    const canPractice = hasPermission(useAuth(), 'practice')
    // One shared cache entry for every card on the page.
    const { data: practiceStatuses = [] } = useQuery({
      queryKey: ['practice-statuses'],
      queryFn: listPracticeStatuses,
      enabled: canPractice,
    })

    // Same full-replace PATCH pattern as PiecePage's own favorite toggle
    // (its keyboard-shortcut "F" and header heart button) — kept here as a
    // separate mutation rather than a shared hook since there's nowhere
    // else yet that both need it from outside a piece-details context.
    const favoriteMutation = useMutation({
      mutationFn: () =>
        updatePiece(piece.id, { ...pieceToWriteRequest(piece), favorite: !piece.favorite }),
      onSuccess: (updated) => {
        queryClient.setQueryData(['piece', piece.id], updated)
        queryClient.invalidateQueries({ queryKey: ['pieces'] })
      },
      onError: (error) => {
        showAlert(error instanceof ApiError ? error.message : 'Could not update this piece.')
      },
    })

    const practiceStatusMutation = useMutation({
      mutationFn: (status: string | null) => setPiecePracticeStatus(piece.id, status),
      onSuccess: (updated) => {
        queryClient.setQueryData(['piece', piece.id], updated)
        queryClient.invalidateQueries({ queryKey: ['pieces'] })
        queryClient.invalidateQueries({ queryKey: ['pieceFacets'] })
      },
      onError: (error) => {
        showAlert(error instanceof ApiError ? error.message : 'Could not set the practice status.')
      },
    })

    // Hard delete, no undo (CLAUDE.md > File handling) — confirm before
    // sending it, through the app's shared confirm dialog (lib/dialogs.ts).
    const deleteMutation = useMutation({
      mutationFn: () => deletePiece(piece.id),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['pieces'] })
      },
      onError: (error) => {
        showAlert(error instanceof ApiError ? error.message : 'Could not delete this piece.')
      },
    })

    return (
      // cardRef anchors AddToSetlistPicker's own portaled popup under the
      // card's bottom-right corner (see that component's own top comment
      // for why it's a portal, not plain CSS-relative positioning).
      <div ref={cardRef}>
        <ContextMenu
          ref={ref}
          hideTriggerButton={hideTriggerButton}
          header={
            canPractice && practiceStatuses.length > 0
              ? (close) => (
                  <PracticeStatusStrip
                    statuses={practiceStatuses}
                    current={piece.practiceStatus}
                    onChange={(status) => {
                      practiceStatusMutation.mutate(status)
                      close()
                    }}
                  />
                )
              : undefined
          }
          items={[
            {
              label: piece.favorite ? 'Remove from Favorites' : 'Add to Favorites',
              onSelect: () => favoriteMutation.mutate(),
            },
            ...(canCreate
              ? [{ label: 'Add to Setlist', onSelect: () => setPickerOpen(true) }]
              : []),
            {
              label: 'Edit Piece',
              onSelect: () => setEditOpen(true),
              disabled: !canEdit,
              disabledReason: "You don't have permission to edit",
            },
            {
              label: 'Delete Piece',
              destructive: true,
              disabled: !canDelete,
              disabledReason: "You don't have permission to delete",
              onSelect: async () => {
                const confirmed = await confirmAction({
                  title: `Delete "${piece.title}"?`,
                  message: "This can't be undone.",
                  confirmLabel: 'Delete piece',
                })
                if (confirmed) deleteMutation.mutate()
              },
            },
          ]}
        >
          {children}
        </ContextMenu>
        <EditPieceModal
          piece={piece}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          siblingPieces={siblingPieces}
        />
        {canCreate && pickerOpen && (
          <AddToSetlistPicker
            pieceId={piece.id}
            anchorRef={cardRef}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>
    )
  },
)
