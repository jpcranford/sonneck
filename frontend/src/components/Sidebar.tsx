import { useState, type ComponentType } from 'react'
import { NavLink } from 'react-router-dom'
import {
  IconLibrary,
  IconBook,
  IconUser,
  IconUserFilled,
  IconCloudUpload,
  IconHeart,
  IconProgress,
  IconLayoutSidebarLeftCollapseFilled,
  IconLayoutSidebarLeftExpandFilled,
} from '@tabler/icons-react'

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Library', icon: IconLibrary },
  { to: '/composers', label: 'Composers', icon: IconUser },
  { to: '/books', label: 'Books', icon: IconBook },
  { to: '/upload', label: 'Upload', icon: IconCloudUpload },
]

// Personal/filtered views of the library, not browsing surfaces in their
// own right — split below the divider from the primary nav above.
const SECONDARY_NAV_ITEMS: NavItem[] = [
  { to: '/favorites', label: 'Favorites', icon: IconHeart },
  { to: '/practicing', label: 'Currently Practicing', icon: IconProgress },
]

// No setlist backend yet (design doc §13) — this stays empty until that lands,
// but the section itself is scaffolded now per the locked shell scope.
const SETLISTS: { id: string; name: string }[] = []

// Shared between the primary nav group and the secondary (Favorites/
// Currently Practicing) group below the divider — same link styling
// either side, just a different item list.
function NavItemsList({ items, collapsed }: { items: NavItem[]; collapsed: boolean }) {
  return (
    <nav className="flex flex-col gap-1 px-2">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          title={collapsed ? label : undefined}
          className={({ isActive }) =>
            `flex h-10 items-center gap-3 rounded-md px-2 font-display text-[0.95rem] ${
              collapsed ? 'justify-center' : ''
            } ${
              isActive ? 'bg-sidebar-panel text-sidebar-text' : 'text-sidebar-text hover:bg-white/5'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon
                size={22}
                className={isActive ? 'text-accent-on-dark opacity-100' : 'opacity-[0.85]'}
              />
              {!collapsed && <span className="truncate">{label}</span>}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

export function Sidebar() {
  // Defaults collapsed on narrow viewports — expanded (256px) eats most of a
  // phone screen otherwise. One-time check on mount, not a resize listener:
  // this is a v1 "cheap habit" per CLAUDE.md's device-aware conventions, not
  // a fully responsive redesign — desktop windows aren't typically resized
  // across this breakpoint mid-session.
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 768)

  return (
    <aside
      className={`flex h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar-bg transition-[width] duration-150 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      <div className="flex h-14 shrink-0 items-center justify-end px-3">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex size-[30px] shrink-0 items-center justify-center rounded-md border border-sidebar-border text-sidebar-text-dim hover:text-sidebar-text"
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

      <div className="mt-6 flex flex-1 flex-col overflow-y-auto px-2">
        {!collapsed && (
          <span className="px-2 text-xs tracking-wide text-sidebar-text-dim uppercase">
            Setlists
          </span>
        )}
        <div className={collapsed ? 'mt-1 flex flex-col items-center gap-1' : 'mt-1 flex flex-col'}>
          {/* No setlist backend yet (design doc §13, same as SETLISTS
              above) — styled as a real setlist row would be (same
              size/rounding/font/text color as the NavLinks below) rather
              than plain prose, so it reads as "a setlist entry, just not
              a real one yet" instead of an unrelated caption. Still a
              plain span, not a NavLink, so it has no hover/active state —
              that alone marks it as inert, without needing dimmer text
              too. Collapsed view gets the same single-letter-circle
              treatment as a real setlist would, using "C" for "Coming
              soon" the same way a real entry uses its own first letter. */}
          {SETLISTS.length === 0 &&
            (collapsed ? (
              <span
                title="Coming soon"
                className="flex size-10 items-center justify-center rounded-md font-display text-[0.95rem] text-sidebar-text"
              >
                C
              </span>
            ) : (
              <span className="truncate rounded-md px-2 py-1.5 font-display text-[0.95rem] text-sidebar-text">
                Coming soon
              </span>
            ))}
          {SETLISTS.map((setlist) =>
            collapsed ? (
              <NavLink
                key={setlist.id}
                to={`/setlists/${setlist.id}`}
                title={setlist.name}
                className={({ isActive }) =>
                  `flex size-10 items-center justify-center rounded-md font-display text-[0.95rem] ${
                    isActive
                      ? 'bg-sidebar-panel text-sidebar-text'
                      : 'text-sidebar-text hover:bg-white/5'
                  }`
                }
              >
                {setlist.name.charAt(0).toUpperCase()}
              </NavLink>
            ) : (
              <NavLink
                key={setlist.id}
                to={`/setlists/${setlist.id}`}
                className={({ isActive }) =>
                  `mt-1 truncate rounded-md px-2 py-1.5 font-display text-[0.95rem] first:mt-0 ${
                    isActive
                      ? 'bg-sidebar-panel text-sidebar-text'
                      : 'text-sidebar-text hover:bg-white/5'
                  }`
                }
              >
                {setlist.name}
              </NavLink>
            ),
          )}
        </div>
      </div>

      <div
        className={`m-2 flex items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-panel p-2 ${collapsed ? 'justify-center' : ''}`}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-sidebar-border bg-sidebar-bg text-sidebar-text-dim">
          <IconUserFilled size={16} />
        </span>
        {!collapsed && (
          <span className="truncate text-[0.95rem] text-sidebar-text">Local Library</span>
        )}
      </div>
    </aside>
  )
}
