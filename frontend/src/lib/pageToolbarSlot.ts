import { createContext } from 'react'

/** The element AppShell keeps between the narrow-screen top bar and the
 * scroll container, for a page's own toolbar (components/PageToolbarSlot.tsx).
 * Null outside AppShell, or before the slot has mounted. */
export const PageToolbarSlotContext = createContext<HTMLElement | null>(null)
