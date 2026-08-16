import { useState, type ComponentType } from 'react'
import { NavLink } from 'react-router-dom'
import {
  IconBooks,
  IconUserFilled,
  IconCloudUpload,
  IconHeartFilled,
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
  { to: '/', label: 'Library', icon: IconBooks },
  { to: '/composers', label: 'Composers', icon: IconUserFilled },
  { to: '/upload', label: 'Upload', icon: IconCloudUpload },
  { to: '/favorites', label: 'Favorites', icon: IconHeartFilled },
  { to: '/practicing', label: 'Currently Practicing', icon: IconProgress },
]

// No setlist backend yet (design doc §13) — this stays empty until that lands,
// but the section itself is scaffolded now per the locked shell scope.
const SETLISTS: { id: string; name: string }[] = []

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className={`flex h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar-bg transition-[width] duration-150 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      <div
        className={`flex h-14 shrink-0 items-center px-3 ${collapsed ? 'justify-center' : 'justify-between'}`}
      >
        {!collapsed && <span className="font-display text-lg text-sidebar-text">Sonneck</span>}
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

      <nav className="flex flex-col gap-1 px-2">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              `flex h-10 items-center gap-3 rounded-md px-2 font-display text-sm ${
                collapsed ? 'justify-center' : ''
              } ${
                isActive
                  ? 'bg-sidebar-panel text-sidebar-text'
                  : 'text-sidebar-text-dim hover:bg-sidebar-panel hover:text-sidebar-text'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={22} className={isActive ? 'text-accent-on-dark' : ''} />
                {!collapsed && <span className="truncate">{label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mx-3 my-3 border-t border-sidebar-border" />

      <div className="flex flex-1 flex-col overflow-y-auto px-2">
        {!collapsed && (
          <span className="px-2 text-xs tracking-wide text-sidebar-text-dim uppercase">
            Setlists
          </span>
        )}
        <div className={collapsed ? 'mt-1 flex flex-col items-center gap-1' : 'mt-1 flex flex-col'}>
          {SETLISTS.map((setlist) =>
            collapsed ? (
              <NavLink
                key={setlist.id}
                to={`/setlists/${setlist.id}`}
                title={setlist.name}
                className={({ isActive }) =>
                  `flex size-10 items-center justify-center rounded-md font-display text-sm ${
                    isActive
                      ? 'bg-sidebar-panel text-sidebar-text'
                      : 'text-sidebar-text-dim hover:bg-sidebar-panel hover:text-sidebar-text'
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
                  `mt-1 truncate rounded-md px-2 py-1.5 font-display text-sm first:mt-0 ${
                    isActive
                      ? 'bg-sidebar-panel text-sidebar-text'
                      : 'text-sidebar-text-dim hover:bg-sidebar-panel hover:text-sidebar-text'
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
          <span className="truncate text-sm text-sidebar-text-dim">Local Library</span>
        )}
      </div>
    </aside>
  )
}
