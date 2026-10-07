import { useSyncExternalStore } from 'react'
import { getDialogSnapshot, settleDialog, subscribeDialogs } from '../lib/dialogs'
import { Modal } from './Modal'

// Shows lib/dialogs.ts's confirm and alert dialogs, one at a time. Mounted
// once, in main.tsx, so every screen (and every mockup) can use them.
// Cancel (or OK) takes focus when a dialog opens, so Enter never confirms a
// delete by accident.
export function DialogHost() {
  const { current, last } = useSyncExternalStore(subscribeDialogs, getDialogSnapshot)
  const shown = current ?? last

  return (
    <Modal
      open={current !== null}
      onClose={() => current && settleDialog(current.id, false)}
      labelledBy="app-dialog-title"
      size="sm"
    >
      {shown && (
        // Keyed by dialog so a second one opening right after the first
        // remounts its buttons and autoFocus lands again.
        <div key={shown.id} className="flex flex-col gap-4">
          {shown.kind === 'confirm' ? (
            <div>
              <h2
                id="app-dialog-title"
                className="font-display text-xl font-medium text-balance text-ink"
              >
                {shown.title}
              </h2>
              {shown.message && (
                <p className="mt-1 text-sm whitespace-pre-line text-ink-soft">{shown.message}</p>
              )}
            </div>
          ) : (
            <div>
              {shown.title && (
                <h2
                  id="app-dialog-title"
                  className="font-display text-xl font-medium text-balance text-ink"
                >
                  {shown.title}
                </h2>
              )}
              <p
                id={shown.title ? undefined : 'app-dialog-title'}
                className={`text-sm whitespace-pre-line ${shown.title ? 'mt-1 text-ink-soft' : 'text-ink'}`}
              >
                {shown.message}
              </p>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {shown.kind === 'confirm' ? (
              <>
                <button
                  type="button"
                  autoFocus
                  onClick={() => settleDialog(shown.id, false)}
                  className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display font-medium text-ink hover:border-accent"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => settleDialog(shown.id, true)}
                  className={`cursor-pointer rounded-md px-4 py-2 font-display font-medium text-white ${
                    shown.destructive
                      ? 'bg-danger-fill hover:bg-danger-fill-strong'
                      : 'bg-accent-fill hover:bg-accent-fill/90'
                  }`}
                >
                  {shown.confirmLabel}
                </button>
              </>
            ) : (
              <button
                type="button"
                autoFocus
                onClick={() => settleDialog(shown.id, true)}
                className="cursor-pointer rounded-md bg-accent-fill px-4 py-2 font-display font-medium text-white hover:bg-accent-fill/90"
              >
                OK
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
