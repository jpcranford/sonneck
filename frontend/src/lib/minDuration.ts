// This app's mutations hit a local SQLite backend and routinely resolve
// in under a browser paint frame (confirmed: a Book PATCH round-trips in
// ~1-15ms in practice). Any "in progress" UI gated purely on
// isPending/a manual save-state flag — a moving-stripe animation, a
// "Saving…" button label — can mount and unmount before it's ever
// actually painted, which reads as nothing having happened rather than
// as a fast success. Real bug found 2026-08-26: the Book Properties Edit
// Menu's stripe-animated Save button (EditBookModal.tsx) never visibly
// animated because its "saving" state lasted ~10ms.
//
// Call this from a mutation's onSuccess, passing the Date.now() captured
// right before mutate() was called, to guarantee the in-progress state
// stays visible for at least minMs — without adding any delay when a
// request genuinely takes longer than that.
export const MIN_PROGRESS_DISPLAY_MS = 250

export function afterMinDuration(
  startedAt: number,
  callback: () => void,
  minMs: number = MIN_PROGRESS_DISPLAY_MS,
): void {
  const remaining = minMs - (Date.now() - startedAt)
  if (remaining > 0) {
    setTimeout(callback, remaining)
  } else {
    callback()
  }
}
