import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { getUserSettings } from '../api/userSettings'
import { hasPermission, useAuth } from '../lib/AuthContext'
import { NAV_ITEMS, SECONDARY_NAV_ITEMS } from '../lib/navItems'
import { useShortcuts } from '../lib/shortcuts'

/** 1–9 go to the sidebar's items in their order on screen — so Books
 * hidden in User Settings moves everything after it up one — and the next
 * number after them opens the Setlists library (Upcoming Sets' rows get
 * none). Rendered once, in AppShell. */
export function useSidebarShortcuts() {
  const navigate = useNavigate()
  const me = useAuth()
  const { data: settings } = useQuery({ queryKey: ['user-settings'], queryFn: getUserSettings })
  const showBooks = settings?.showBooksInSidebar ?? true
  const items = [...NAV_ITEMS, ...SECONDARY_NAV_ITEMS].filter(
    (item) => showBooks || item.to !== '/books',
  )
  const targets = [
    ...items.map((item) => ({
      to: item.to,
      label: item.label,
      enabled: !item.permission || hasPermission(me, item.permission),
    })),
    { to: '/setlists', label: 'Setlists', enabled: true },
  ].slice(0, 9)
  useShortcuts(
    targets.map((target, i) => ({
      key: String(i + 1),
      label: target.label,
      enabled: target.enabled,
      run: () => navigate(target.to),
    })),
    { sidebar: true },
  )
}
