/** A control's 48×48 tap area on touch screens and phone-width windows
 * (`.hit-area` in index.css, the Sheet Viewer's rule): put it inside the
 * button or link, which needs `relative`. Taps on it are taps on the
 * control. `start` grows it rightward only, for a split button's caret. */
export function HitArea({ start = false }: { start?: boolean }) {
  return (
    <span data-hit aria-hidden="true" className={start ? 'hit-area hit-area-start' : 'hit-area'} />
  )
}
