import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { getUserSettings } from '../api/userSettings'
import { useAuth } from '../lib/AuthContext'
import { NAV_ITEMS, SECONDARY_NAV_ITEMS, visibleNavItems } from '../lib/navItems'
import { useShortcuts } from '../lib/shortcuts'

/** 1–9 go to the sidebar's items in their order on screen — so Books
 * hidden in User Settings, or Upload without the upload permission, moves
 * everything after it up one — and the next
 * number after them opens the Setlists library (Upcoming Sets' rows get
 * none). Rendered once, in AppShell. */
export function useSidebarShortcuts() {
  const navigate = useNavigate()
  const me = useAuth()
  const { data: settings } = useQuery({ queryKey: ['user-settings'], queryFn: getUserSettings })
  const items = visibleNavItems(
    [...NAV_ITEMS, ...SECONDARY_NAV_ITEMS],
    me,
    settings?.showBooksInSidebar ?? true,
  )
  const targets = [...items, { to: '/setlists', label: 'Setlists' }].slice(0, 9)
  useShortcuts(
    targets.map((target, i) => ({
      key: String(i + 1),
      label: target.label,
      run: () => navigate(target.to),
    })),
    { sidebar: true },
  )
}
