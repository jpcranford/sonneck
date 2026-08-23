import { forwardRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { deleteBook } from '../api/books'
import { ApiError } from '../api/client'
import type { Book } from '../api/types'
import { ContextMenu, type ContextMenuHandle } from './ContextMenu'
import { EditBookModal } from './EditBookModal'

interface BookContextMenuProps {
  book: Book
  children: ReactNode
  /** Passed through to ContextMenu — set when a caller supplies its own
   * custom-positioned trigger via this component's forwarded ref instead
   * (see BookGridCard, which anchors its trigger to the cover). */
  hideTriggerButton?: boolean
}

// Shared right-click menu for book cards (grid + list), mirroring
// PieceContextMenu.tsx: "Edit Book" and, at the end, a destructive
// "Delete Book". No favorite toggle here — Book has no such field.
export const BookContextMenu = forwardRef<ContextMenuHandle, BookContextMenuProps>(
  function BookContextMenu({ book, children, hideTriggerButton }, ref) {
    const [editOpen, setEditOpen] = useState(false)
    const queryClient = useQueryClient()

    // Cascade delete, not the lighter unlink-pieces or empty-books-only
    // alternatives: removes the Book *and* every Piece referencing it in
    // one action — the single
    // largest-blast-radius action in the app, so the confirm() message
    // names the piece count explicitly rather than reusing Piece's plain
    // "this can't be undone." Hard delete, no undo either way (CLAUDE.md >
    // File handling), same native-confirm() reasoning as PieceContextMenu:
    // cheap, blocking, fine for a single yes/no gate.
    const deleteMutation = useMutation({
      mutationFn: () => deleteBook(book.id),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['books'] })
        queryClient.invalidateQueries({ queryKey: ['pieces'] })
        queryClient.invalidateQueries({ queryKey: ['piece'] })
      },
      onError: (error) => {
        window.alert(error instanceof ApiError ? error.message : 'Could not delete this book.')
      },
    })

    function confirmMessage(): string {
      if (book.pieceCount === 0) {
        return `Delete "${book.bookTitle}"? This can't be undone.`
      }
      const pieces = book.pieceCount === 1 ? 'the 1 piece' : `all ${book.pieceCount} pieces`
      return `Delete "${book.bookTitle}"? This will also permanently delete ${pieces} in this book. This can't be undone.`
    }

    return (
      <>
        <ContextMenu
          ref={ref}
          hideTriggerButton={hideTriggerButton}
          items={[
            { label: 'Edit Book', onSelect: () => setEditOpen(true) },
            {
              label: 'Delete Book',
              destructive: true,
              onSelect: () => {
                if (window.confirm(confirmMessage())) {
                  deleteMutation.mutate()
                }
              },
            },
          ]}
        >
          {children}
        </ContextMenu>
        <EditBookModal book={book} open={editOpen} onClose={() => setEditOpen(false)} />
      </>
    )
  },
)
