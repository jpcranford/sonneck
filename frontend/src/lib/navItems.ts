import type { ComponentType } from 'react'
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
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Library', icon: IconLibrary },
  { to: '/composers', label: 'Composers', icon: IconUser },
  { to: '/books', label: 'Books', icon: IconBooks },
  { to: '/upload', label: 'Upload', icon: IconCloudUpload },
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

// No setlist backend yet (design doc §13) — this stays empty until that
// lands, but the section itself is scaffolded now per the locked shell
// scope.
export const SETLISTS: { id: string; name: string }[] = []
