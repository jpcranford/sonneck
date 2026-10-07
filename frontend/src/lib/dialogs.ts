// The app's own confirm and alert dialogs, in place of the browser's
// confirm()/alert(): those ignore the theme, and the Mac desktop app's web
// view can't show them at all (confirm() silently answers "no", so every
// Delete did nothing there). Picked from a side-by-side (design A): the
// same window as the app's other confirmations — serif question, one line
// on what happens, Cancel and a button that names the action.
//
// Call from anywhere, no hooks needed; components/DialogHost.tsx (mounted
// once in main.tsx) shows them one at a time, in the order asked.
//
//   if (await confirmAction({ title: 'Delete "X"?', message: "This can't be undone.", confirmLabel: 'Delete piece' })) …
//   showAlert('Could not delete this piece.')

export type DialogRequest =
  | {
      kind: 'confirm'
      id: number
      title: string
      message?: string
      confirmLabel: string
      destructive: boolean
      resolve: (confirmed: boolean) => void
    }
  | { kind: 'alert'; id: number; title?: string; message: string; resolve: () => void }

type Snapshot = { current: DialogRequest | null; last: DialogRequest | null }

let queue: DialogRequest[] = []
// The last dialog shown, kept after it's answered so its window can play
// its closing animation with its own text still in it.
let last: DialogRequest | null = null
let snapshot: Snapshot = { current: null, last: null }
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
  if (queue[0]) last = queue[0]
  snapshot = { current: queue[0] ?? null, last }
  listeners.forEach((listener) => listener())
}

export function subscribeDialogs(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getDialogSnapshot(): Snapshot {
  return snapshot
}

// Resolves true only when the action button is pressed; Cancel, Escape and
// a click on the backdrop all resolve false. Destructive (a red button) by
// default, since nearly every confirmation here deletes something.
export function confirmAction(options: {
  title: string
  message?: string
  confirmLabel: string
  destructive?: boolean
}): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [...queue, { kind: 'confirm', id: nextId++, destructive: true, ...options, resolve }]
    emit()
  })
}

// An error or notice with a single OK. Fire and forget: nothing waits on it.
export function showAlert(message: string, title?: string): void {
  queue = [...queue, { kind: 'alert', id: nextId++, title, message, resolve: () => {} }]
  emit()
}

export function settleDialog(id: number, confirmed: boolean) {
  const request = queue.find((r) => r.id === id)
  if (!request) return
  queue = queue.filter((r) => r.id !== id)
  emit()
  if (request.kind === 'confirm') request.resolve(confirmed)
  else request.resolve()
}
