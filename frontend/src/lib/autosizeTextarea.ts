// Shared by the real Book Upload Wizard "Name each piece" step and its
// mockup — pure DOM logic, not a component, same "shared not duplicated"
// reasoning as pieceSplitLogic.ts/textCase.ts. Grows a <textarea> standing
// in for a single-line text input (Title/Composer/Arranger) tall enough to
// show its full value instead of clipping/scrolling horizontally like a
// plain <input> would. Resetting height to 'auto' first is required —
// scrollHeight only shrinks correctly (e.g. after deleting text) if the
// element isn't already holding it open at its previous height.
export function autosizeTextarea(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

// These fields are semantically single-line values (a title, a composer
// name) — Enter should behave like it does in a plain <input> (submit the
// form) rather than a textarea's own default (insert a newline), which
// would silently embed a literal "\n" into saved data.
export function preventTextareaNewline(event: { key: string; preventDefault: () => void; currentTarget: HTMLTextAreaElement }) {
  if (event.key !== 'Enter') return
  event.preventDefault()
  event.currentTarget.form?.requestSubmit()
}
