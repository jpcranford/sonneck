// Hands a file dropped anywhere in the app (components/DropToUpload.tsx)
// to the Upload page, which picks it up as it mounts and starts the
// matching upload. Kept in memory, not router state: a File in history
// state would be cloned into the browser's history entry and come back on
// Back/Forward, restarting an upload nobody asked for.
export interface PendingUpload {
  file: File
  kind: 'piece' | 'book'
}

let pending: PendingUpload | null = null

export function setPendingUpload(upload: PendingUpload): void {
  pending = upload
}

/** Returns the waiting upload without clearing it — safe to call from a
 * render (a lazy useState initializer runs twice under StrictMode). */
export function peekPendingUpload(): PendingUpload | null {
  return pending
}

export function clearPendingUpload(): void {
  pending = null
}
