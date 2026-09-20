import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  IconLayoutSidebarLeftCollapseFilled,
  IconLayoutSidebarLeftExpandFilled,
} from '@tabler/icons-react'
import { NAV_ITEMS, SECONDARY_NAV_ITEMS, type NavItem } from '../lib/navItems'
import { useAuth } from '../lib/AuthContext'
import { getUserSettings } from '../api/userSettings'
import { listSetlists, getUpcomingSetlists } from '../api/setlists'
import { UserMenuButton } from './UserMenuButton'
import { SetlistsSection } from './SidebarSetlists'

// Shared between the primary nav group and the secondary (Favorites/
// Currently Practicing) group below the divider — same link styling
// either side, just a different item list.
function NavItemsList({ items, collapsed }: { items: NavItem[]; collapsed: boolean }) {
  const me = useAuth()
  // "Hide Books in sidebar" (User Settings' Library card) — a personal
  // display preference, not a permission gate, so this hides the item
  // outright rather than fading it like a `permission`-blocked one below.
  // Defaults to shown while the query is still loading, matching the
  // real column's own DEFAULT 1 (shown) — never flashes hidden then shown.
  const { data: settings } = useQuery({ queryKey: ['user-settings'], queryFn: getUserSettings })
  const showBooks = settings?.showBooksInSidebar ?? true
  const visibleItems = showBooks ? items : items.filter((item) => item.to !== '/books')
  return (
    <nav className="flex flex-col gap-1 px-2">
      {visibleItems.map(({ to, label, icon: Icon, permission }) => {
        const blocked = permission && !me.permissions.includes(permission)
        const content = (
          <>
            {/* Icon always matches the adjacent label's own color
                (text-sidebar-text, same in both nav states — only the
                background changes on active) rather than a dimmed
                pre-blend or an accent tint of its own; a visibly different
                icon color next to same-colored text reads as a mismatch,
                not a deliberate highlight. No longer needs the isActive
                render-prop now that the icon doesn't vary by nav state
                either. */}
            <Icon size={22} className="text-sidebar-text" />
            {/* relative top-[0.6px]: picked by eye against the real render
                (fonts, hover background) via a throwaway calibration tool
                (SidebarAlignDebug.tsx, since removed) — a prior attempt
                based on a headless-Chromium pixel measurement nudged the
                wrong direction/amount, since font hinting differs by
                rendering engine and a measurement in one browser isn't a
                reliable stand-in for another. Icons needed no offset. */}
            {!collapsed && (
              <span className="relative top-[0.6px] truncate">{label}</span>
            )}
          </>
        )
        if (blocked) {
          // A real <span>, not a disabled NavLink — react-router's Link
          // has no disabled concept, and there's no navigation worth
          // preserving for cmd/ctrl-click when the destination just
          // redirects straight back out (UploadPage.tsx's own route
          // guard) anyway. Faded via a real `opacity` on this one
          // container, not a translucent text color — the icon inside
          // (IconCloudUpload) is three separate overlapping <path>s
          // sharing one stroke color, and CLAUDE.md's own icon-color rule
          // is specific about why that combination needs a group-opacity
          // composite instead: a translucent color applied directly would
          // re-blend unevenly wherever those paths meet.
          return (
            <span
              key={to}
              title={collapsed ? label : "You don't have permission to upload"}
              className={`flex h-10 cursor-not-allowed items-center gap-3 rounded-md px-2 font-display text-[0.95rem] font-medium text-sidebar-text opacity-40 ${
                collapsed ? 'justify-center' : ''
              }`}
            >
              {content}
            </span>
          )
        }
        return (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              `flex h-10 items-center gap-3 rounded-md px-2 font-display text-[0.95rem] font-medium ${
                collapsed ? 'justify-center' : ''
              } ${
                isActive ? 'bg-sidebar-panel text-sidebar-text' : 'text-sidebar-text hover:bg-white/5'
              }`
            }
          >
            {content}
          </NavLink>
        )
      })}
    </nav>
  )
}

export function Sidebar() {
  // Always starts expanded — this component is desktop-only (AppShell
  // renders it inside a `hidden md:block` wrapper, with MobileNav
  // handling everything below the md breakpoint instead), so there's no
  // longer a narrow-viewport case to default away from. The collapse
  // toggle below is a separate, persistent desktop preference, unrelated
  // to this.
  const [collapsed, setCollapsed] = useState(false)
  // Real as of the Setlists backend build — same TanStack-Query-backed
  // pattern as the "Hide Books in sidebar" setting above. Defaults to []
  // while loading, same posture as an empty result: no flash, no
  // placeholder text.
  const { data: setlists = [] } = useQuery({ queryKey: ['setlists'], queryFn: listSetlists })
  const upcomingSetlists = getUpcomingSetlists(setlists, 5)

  return (
    // h-dvh, not h-screen — same AppShell.tsx gotcha (100vh doesn't track
    // a dynamic browser-chrome viewport). This component is desktop/tablet
    // only (rendered inside AppShell's `hidden md:block`), so the aggressive
    // iPhone Safari toolbar-hide behavior that originally surfaced this bug
    // doesn't apply here, but iPad Safari can still resize its chrome, and
    // this is exactly the "any future shell-like component" case that fix
    // was meant to cover.
    <aside
      className={`flex h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar-bg transition-[width] duration-150 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      <div className="flex h-14 shrink-0 items-center justify-end px-3">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex size-[30px] shrink-0 cursor-pointer items-center justify-center rounded-md border border-sidebar-border text-sidebar-text-dim hover:text-sidebar-text"
        >
          {collapsed ? (
            <IconLayoutSidebarLeftExpandFilled size={16} />
          ) : (
            <IconLayoutSidebarLeftCollapseFilled size={16} />
          )}
        </button>
      </div>

      <NavItemsList items={NAV_ITEMS} collapsed={collapsed} />

      <div className="mx-3 my-3 border-t border-sidebar-border" />

      <NavItemsList items={SECONDARY_NAV_ITEMS} collapsed={collapsed} />

      <SetlistsSection collapsed={collapsed} setlists={upcomingSetlists} />

      <UserMenuButton collapsed={collapsed} />
    </aside>
  )
}
