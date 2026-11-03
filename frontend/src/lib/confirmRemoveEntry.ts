import { confirmAction } from './dialogs'

/** Asks before a setlist's custom entry is removed (Setlist Details' menu,
 * Edit Setlist's Program tab): it holds typed-in text — a name, notes — that
 * can't be got back, unlike a piece entry, which can simply be added again
 * and so is removed without asking. Resolves true to go ahead. */
export function confirmRemoveCustomEntry(name: string): Promise<boolean> {
  return confirmAction({
    title: `Remove “${name}”?`,
    message: 'It’s taken out of this setlist, with its notes. This can’t be undone.',
    confirmLabel: 'Remove entry',
  })
}
