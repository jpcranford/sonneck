import { confirmAction } from './dialogs'

/** Asks before a setlist's custom entry is removed from Setlist Details'
 * menu, which removes it at once: its typed-in name and notes can't be got
 * back. Edit Setlist's Program tab doesn't ask, since its removals wait for
 * Save Setlist and Cancel undoes them. Resolves true to go ahead. */
export function confirmRemoveCustomEntry(name: string): Promise<boolean> {
  return confirmAction({
    title: `Remove “${name}”?`,
    message: 'It’s taken out of this setlist, with its notes. This can’t be undone.',
    confirmLabel: 'Remove entry',
  })
}

/** Asks before a piece entry is removed from Setlist Details' menu, which
 * removes it at once (its role with it). Resolves true to go ahead. */
export function confirmRemovePieceEntry(title: string): Promise<boolean> {
  return confirmAction({
    title: `Remove “${title}”?`,
    message: 'It’s taken out of this setlist. You can add it again later.',
    confirmLabel: 'Remove piece',
  })
}
