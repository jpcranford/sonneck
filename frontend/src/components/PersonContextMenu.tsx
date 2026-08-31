import { forwardRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { deletePerson } from '../api/people'
import { ApiError } from '../api/client'
import type { Person } from '../api/types'
import { ContextMenu, type ContextMenuHandle } from './ContextMenu'
import { EditPersonModal } from './EditPersonModal'

interface PersonContextMenuProps {
  person: Person
  children: ReactNode
  /** Passed through to ContextMenu — set when a caller supplies its own
   * custom-positioned trigger via this component's forwarded ref instead. */
  hideTriggerButton?: boolean
}

// Shared right-click menu for Person cards (grid + list), mirroring
// BookContextMenu.tsx: "Edit Person" and, at the end, a destructive
// "Delete Person" — hard delete (their credit rows cascade), not the
// separate, non-destructive Split People action (that lives on Person
// Details itself, not this menu, since it needs a real ordered-replacement
// picker, not a one-line confirm()).
export const PersonContextMenu = forwardRef<ContextMenuHandle, PersonContextMenuProps>(
  function PersonContextMenu({ person, children, hideTriggerButton }, ref) {
    const [editOpen, setEditOpen] = useState(false)
    const queryClient = useQueryClient()

    const deleteMutation = useMutation({
      mutationFn: () => deletePerson(person.id),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['people'] })
        queryClient.invalidateQueries({ queryKey: ['pieces'] })
        queryClient.invalidateQueries({ queryKey: ['piece'] })
        queryClient.invalidateQueries({ queryKey: ['books'] })
      },
      onError: (error) => {
        window.alert(error instanceof ApiError ? error.message : 'Could not delete this person.')
      },
    })

    return (
      <>
        <ContextMenu
          ref={ref}
          hideTriggerButton={hideTriggerButton}
          items={[
            { label: 'Edit Person', onSelect: () => setEditOpen(true) },
            {
              label: 'Delete Person',
              destructive: true,
              onSelect: () => {
                if (window.confirm(`Delete "${person.name}"? This can't be undone.`)) {
                  deleteMutation.mutate()
                }
              },
            },
          ]}
        >
          {children}
        </ContextMenu>
        <EditPersonModal person={person} open={editOpen} onClose={() => setEditOpen(false)} />
      </>
    )
  },
)
