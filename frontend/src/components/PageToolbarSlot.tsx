import { useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { PageToolbarSlotContext } from '../lib/pageToolbarSlot'

/**
 * Draws a page's toolbar (the library pages' search/sort/filter bar) into
 * AppShell's slot above the scroll container, so it stays put while the
 * page scrolls under it. Not `sticky` inside the scroller: iOS's
 * rubber-band bounce at the top drags a sticky element down with the
 * content. Outside AppShell it renders in place.
 */
export function PageToolbarPortal({ children }: { children: ReactNode }) {
  const slot = useContext(PageToolbarSlotContext)
  return slot ? createPortal(children, slot) : children
}
