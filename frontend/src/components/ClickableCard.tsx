import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface ClickableCardProps {
  to: string
  /** Forwarded to Link's own `state` prop — e.g. `{ backLabel: 'Library'
   * }`, so the destination page's own Back control (PiecePage's "Back to
   * X") can name where it was reached from. */
  state?: unknown
  className: string
  children: ReactNode
}

// Card root for PieceGridCard/PieceListCard/BookGridCard/BookListCard.
// Renders a real <a> (via react-router's Link) rather than a div with a
// click handler — a plain onClick-driven div can't be cmd/ctrl/middle-
// clicked into a new tab, since there's no href for the browser to act
// on. This is the one shared root every card-style nav link in the app
// goes through, so this fixes it everywhere at once. Link already
// implements exactly this: a plain left-click
// gets intercepted for client-side routing, but a modified click (cmd/
// ctrl/shift) or middle-click is left alone so the browser's native
// open-in-new-tab/new-window behavior takes over.
//
// PageCycleControl's and TagPills'/ContextMenu's own interactive children
// nested inside a card both already call stopPropagation() on their own
// click/mousedown handlers (that's what has kept them from triggering the
// card's own navigation all along, not the div-vs-anchor choice), so an
// interactive element nested inside this <a> behaves the same as it did
// nested inside the old div — clicking one of those still doesn't
// navigate the card away.
export function ClickableCard({ to, state, className, children }: ClickableCardProps) {
  return (
    <Link to={to} state={state} className={`cursor-pointer ${className}`}>
      {children}
    </Link>
  )
}
