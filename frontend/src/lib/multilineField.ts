// True when a key event comes from a field that takes line breaks — a
// <textarea> (every Markdown description/notes field) or anything
// contentEditable. The edit windows' Enter / Shift+Enter save shortcuts
// stand aside there, so either key just types a newline instead of saving
// (and closing) the window mid-paragraph.
export function isMultilineField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && (target.tagName === 'TEXTAREA' || target.isContentEditable)
  )
}
