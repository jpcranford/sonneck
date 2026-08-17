// Shown under a book-inheritable field only while the piece's own value is
// empty (design doc §15) — gone the moment it has a value, typed or
// copied. `onCopy` performs the one-time copy, not an ongoing link.
//
// Distinct from PiecePage.tsx's read-only InheritedNote (a thin wrapper
// over the shared InfoTooltip, hover/tap to reveal "Inherited from book")
// — this edit-context version is deliberately always-visible with a real
// "Copy from book" action, since editing wants the value and the copy
// action visible immediately, not hidden behind a hover/tap gesture. Don't
// unify these two; see project memory "frontend-edit-piece-modal".
export function InheritedNote({ bookValue, onCopy }: { bookValue: string; onCopy: () => void }) {
  if (!bookValue) return null
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-ink-soft">
      <span>
        Inherited from book: <span className="text-ink italic">{bookValue}</span>
      </span>
      <button type="button" onClick={onCopy} className="shrink-0 text-accent hover:underline">
        Copy from book
      </button>
    </div>
  )
}
