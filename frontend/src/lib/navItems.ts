import type { ComponentType } from 'react'
import type { Permission } from '../api/admin'
import type { AuthMe } from '../api/auth'
import { hasPermission } from './AuthContext'
import {
  IconLibrary,
  IconBooks,
  IconUser,
  IconCloudUpload,
  IconHeart,
  IconCircleHalf2,
  IconCircleDashed,
  IconCircleCheckFilled,
} from '@tabler/icons-react'

// Shared between Sidebar.tsx (desktop rail) and MobileNav.tsx (mobile top
// bar + drawer) — split into its own module rather than exported
// alongside the Sidebar component itself, since a component file
// exporting non-component constants breaks React Fast Refresh for that
// file (react-refresh/only-export-components).
export interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
  /** When set, the item is left out of the sidebar for a viewer who lacks
   * this permission (see visibleNavItems). */
  permission?: Permission
}

/** The items the sidebar shows, in order: without one the viewer lacks the
 * permission for, and without Books when "Hide Books in sidebar" is on.
 * Sidebar.tsx, MobileNav.tsx and the 1–9 shortcuts (useSidebarShortcuts)
 * all go through this, so the numbers always match what's on screen. */
export function visibleNavItems(items: NavItem[], me: AuthMe, showBooks: boolean): NavItem[] {
  return items.filter(
    (item) =>
      (showBooks || item.to !== '/books') &&
      (!item.permission || hasPermission(me, item.permission)),
  )
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Library', icon: IconLibrary },
  // Composer/arranger is a real Person entity (People Library/Person
  // Details), not just a plain string on Piece/Book, so this route is
  // /people rather than /composers.
  { to: '/people', label: 'People', icon: IconUser },
  { to: '/books', label: 'Books', icon: IconBooks },
  { to: '/upload', label: 'Upload', icon: IconCloudUpload, permission: 'upload' },
]

// Personal/filtered views of the library, not browsing surfaces in their
// own right — split below the divider from the primary nav above.
export const SECONDARY_NAV_ITEMS: NavItem[] = [
  { to: '/favorites', label: 'Favorites', icon: IconHeart },
  // Same icon as the "Want to Learn" practice-status pill
  // (PracticeStatusIcon) — this view is a filter on exactly that status.
  { to: '/want-to-learn', label: 'Want to Learn', icon: IconCircleDashed },
  // Same icon as the "Learning" practice-status pill (PracticeStatusIcon)
  // — this nav item is literally about practicing pieces, so it borrows
  // that icon rather than a generic progress one.
  { to: '/practicing', label: 'Currently Practicing', icon: IconCircleHalf2 },
  // Same icon as the "Learned" practice-status pill (PracticeStatusIcon).
  { to: '/learned', label: 'Learned', icon: IconCircleCheckFilled },
]
