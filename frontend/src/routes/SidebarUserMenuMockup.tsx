import { useEffect, useRef, useState, type ComponentType } from 'react'
import { NavLink } from 'react-router-dom'
import {
  IconLibrary,
  IconBooks,
  IconUser,
  IconUserFilled,
  IconCloudUpload,
  IconHeart,
  IconCircleHalf2,
  IconCircleDashed,
  IconCircleCheckFilled,
  IconLayoutSidebarLeftCollapseFilled,
  IconLayoutSidebarLeftExpandFilled,
  IconMenu2,
  IconX,
  IconSelector,
  IconSettings,
  IconShieldLock,
  IconLogout,
} from '@tabler/icons-react'
import { useMockupTitle } from '../lib/useMockupTitle'

// Sidebar User Menu — multi-user support, Phase 7 of the plan (memory
// project_multiuser_build.md). Replaces the static, inert "Local Library"
// footer pill in both Sidebar.tsx (desktop) and MobileNav.tsx (mobile) with
// a real account menu — approved design is Option 2 from the Phase 4
// artifact ("Identity card, dark popup", identity-dark), which won over a
// plain light ContextMenu-style popup and a light-popup identity-card
// variant.
//
// Hand-copied from Sidebar.tsx/MobileNav.tsx (nav items, collapse/drawer
// mechanics) rather than importing them directly — standard mockup
// convention (frozen, hand-maintained visual reference), and unavoidable
// here anyway since this mockup's whole point is a change to those files'
// own footer markup. Only gets reconciled with the real components if this
// build is approved (Phase 11).
//
// Not nested inside <AppShell/> in App.tsx, same reasoning as
// mobile-nav-drawer and first-launch: this replaces AppShell's own sidebar
// footer, so nesting it inside the real shell would show two competing
// footers.

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Library', icon: IconLibrary },
  { to: '/people', label: 'People', icon: IconUser },
  { to: '/books', label: 'Books', icon: IconBooks },
  { to: '/upload', label: 'Upload', icon: IconCloudUpload },
]
const SECONDARY_NAV_ITEMS: NavItem[] = [
  { to: '/favorites', label: 'Favorites', icon: IconHeart },
  { to: '/want-to-learn', label: 'Want to Learn', icon: IconCircleDashed },
  { to: '/practicing', label: 'Currently Practicing', icon: IconCircleHalf2 },
  { to: '/learned', label: 'Learned', icon: IconCircleCheckFilled },
]

type IdentityKey = 'none' | 'singlepass' | 'oidc-admin' | 'oidc-member'

interface Identity {
  label: string
  name: string
  sub: string
  isAdmin: boolean
  showLogout: boolean
}

// Four states from the approved artifact's own comparison — None/singlepass
// share the same implicit shared admin account (per the locked plan:
// singlepass is one shared account behind a password, not distinct named
// accounts); the two OIDC rows show the admin-vs-member permission split
// once real distinct accounts exist.
const IDENTITIES: Record<IdentityKey, Identity> = {
  none: { label: 'No login', name: 'Admin', sub: 'No login required', isAdmin: true, showLogout: false },
  singlepass: { label: 'Password', name: 'Admin', sub: 'Shared password', isAdmin: true, showLogout: true },
  'oidc-admin': {
    label: 'OIDC — Admin',
    name: 'Jamie Chen',
    sub: 'jamie@example.com',
    isAdmin: true,
    showLogout: true,
  },
  'oidc-member': {
    label: 'OIDC — Member',
    name: 'Alex Rivera',
    sub: 'alex@example.com',
    isAdmin: false,
    showLogout: true,
  },
}

function IdentityStateToggle({
  state,
  onChange,
}: {
  state: IdentityKey
  onChange: (state: IdentityKey) => void
}) {
  return (
    // top-16 below md, not top-3 — this preview-only control would otherwise
    // sit right over the mobile top bar's hamburger button at narrow
    // widths (its own content wraps to several lines there, tall enough to
    // reach into the top bar's row and steal its click). md:top-3 once the
    // sidebar rail replaces that top bar and there's no hamburger to cover.
    <div className="fixed top-16 right-3 z-30 flex max-w-[min(92vw,560px)] flex-wrap items-center gap-2 rounded-md border border-dashed border-border bg-paper-raised px-2.5 py-1.5 text-xs text-ink-soft shadow-sm md:top-3">
      <span>Identity state</span>
      <div className="flex flex-wrap overflow-hidden rounded border border-border">
        {(Object.keys(IDENTITIES) as IdentityKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`cursor-pointer px-2 py-1 ${
              state === key ? 'bg-accent text-white' : 'bg-paper hover:bg-paper-sunken'
            }`}
          >
            {IDENTITIES[key].label}
          </button>
        ))}
      </div>
    </div>
  )
}

// Shared between the desktop rail and the mobile drawer footer — same
// trigger + popup either side, mobile just gets a wider drawer to sit in
// (per the artifact's own footer note: "visually identical to the Expanded
// state at a slightly wider drawer width").
function UserMenuButton({ identity, collapsed }: { identity: Identity; collapsed: boolean }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Closes on outside click/Escape, same dismiss convention as
  // ContextMenu.tsx. Also closes whenever the identity or collapsed state
  // changes out from under it, so switching the preview controls above
  // never leaves a stale-content popup open.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])
  useEffect(() => {
    setOpen(false)
  }, [identity, collapsed])

  return (
    <div ref={wrapRef} className={`relative m-2 ${collapsed ? 'flex justify-center' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={collapsed ? identity.name : undefined}
        className={`flex w-full cursor-pointer items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-panel p-2 transition-colors hover:border-sidebar-text-dim ${
          open ? 'border-sidebar-text-dim bg-sidebar-bg' : ''
        } ${collapsed ? 'justify-center' : ''}`}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-sidebar-border bg-sidebar-bg text-sidebar-text">
          <IconUserFilled size={16} />
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate text-left text-[0.95rem] text-sidebar-text">
              {identity.name}
            </span>
            <IconSelector size={15} className="shrink-0 text-sidebar-text-dim" />
          </>
        )}
      </button>

      {/* Dark identity-card popup — the approved option. Opens upward
          (bottom-full) since the trigger sits at the bottom of both the
          rail and the drawer; left-0 keeps it flush with the trigger's own
          left edge in both the collapsed (narrow rail) and expanded
          states, matching the artifact. No overflow:hidden on any ancestor
          between here and the outer viewport-sized container, so nothing
          clips it (see AppShell.tsx's own gotcha comment on this — the
          real Phase 4 bug was a *tightly-sized* demo frame, not a
          full-viewport container like this one). */}
      <div
        role="menu"
        className={`absolute bottom-full left-0 z-20 mb-2 w-60 origin-bottom-left overflow-hidden rounded-lg border border-sidebar-border bg-sidebar-panel shadow-xl transition-[opacity,transform] duration-100 ${
          open ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0'
        }`}
      >
        <div className="flex items-center gap-2.5 px-3.5 py-3">
          <span className="flex size-[34px] shrink-0 items-center justify-center rounded-full border border-sidebar-border bg-sidebar-bg text-sidebar-text">
            <IconUserFilled size={17} />
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-[0.92rem] font-medium text-sidebar-text">
              <span className="truncate">{identity.name}</span>
              {identity.isAdmin && (
                <span className="shrink-0 rounded-full bg-accent px-1.5 py-px text-[0.62rem] font-bold tracking-wide text-white uppercase">
                  Admin
                </span>
              )}
            </p>
            <p className="truncate text-[0.76rem] text-sidebar-text-dim">{identity.sub}</p>
          </div>
        </div>
        <div className="h-px bg-sidebar-border" />
        <div className="p-1.5">
          <button
            type="button"
            onClick={() => setOpen(false)}
            role="menuitem"
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[0.85rem] text-sidebar-text hover:bg-white/5"
          >
            <IconSettings size={16} className="opacity-85" />
            User Settings
          </button>
          {identity.isAdmin && (
            <button
              type="button"
              onClick={() => setOpen(false)}
              role="menuitem"
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[0.85rem] text-sidebar-text hover:bg-white/5"
            >
              <IconShieldLock size={16} className="opacity-85" />
              Admin Settings
            </button>
          )}
        </div>
        {identity.showLogout && (
          <>
            <div className="h-px bg-sidebar-border" />
            <div className="p-1.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                role="menuitem"
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[0.85rem] text-[#e2a29a] hover:bg-[rgba(226,162,154,0.12)]"
              >
                <IconLogout size={16} className="opacity-85" />
                Log Out
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function RailNavList({ items, collapsed }: { items: NavItem[]; collapsed: boolean }) {
  return (
    <nav className="flex flex-col gap-1 px-2">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          title={collapsed ? label : undefined}
          className={({ isActive }) =>
            `flex h-10 items-center gap-3 rounded-md px-2 font-display text-[0.95rem] font-medium ${
              collapsed ? 'justify-center' : ''
            } ${isActive ? 'bg-sidebar-panel text-sidebar-text' : 'text-sidebar-text hover:bg-white/5'}`
          }
        >
          <Icon size={22} className="text-sidebar-text" />
          {!collapsed && <span className="relative top-[0.6px] truncate">{label}</span>}
        </NavLink>
      ))}
    </nav>
  )
}

function DrawerNavList({ items, onNavigate }: { items: NavItem[]; onNavigate: () => void }) {
  return (
    <nav className="flex flex-col gap-1 px-2">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex h-11 items-center gap-3 rounded-md px-3 font-display text-[0.95rem] font-medium ${
              isActive ? 'bg-sidebar-panel text-sidebar-text' : 'text-sidebar-text hover:bg-white/5'
            }`
          }
        >
          <Icon size={22} className="text-sidebar-text" />
          <span className="relative top-[0.6px] truncate">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

function SetlistsSlot({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="mt-6 flex flex-1 flex-col overflow-y-auto px-2">
      {!collapsed && (
        <span className="px-2 text-xs tracking-wide text-sidebar-text-dim uppercase">Setlists</span>
      )}
      {collapsed ? (
        <span
          title="Coming soon"
          className="mt-1 flex size-10 items-center justify-center rounded-md font-display text-[0.95rem] font-medium text-sidebar-text"
        >
          C
        </span>
      ) : (
        <span className="mt-1 truncate rounded-md px-2 py-1.5 font-display text-[0.95rem] font-medium text-sidebar-text">
          Coming soon
        </span>
      )}
    </div>
  )
}

export function SidebarUserMenuMockup() {
  useMockupTitle('Sidebar User Menu')
  const [identityKey, setIdentityKey] = useState<IdentityKey>('none')
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const identity = IDENTITIES[identityKey]

  return (
    <div className="flex h-dvh overflow-hidden bg-paper text-ink">
      <IdentityStateToggle state={identityKey} onChange={setIdentityKey} />

      {/* Desktop rail — hidden md:flex reproduces AppShell's own `hidden
          md:block` wrapper + Sidebar.tsx's internal flex-col in one class
          list, since this mockup isn't nested inside the real AppShell. */}
      <aside
        className={`hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar-bg transition-[width] duration-150 md:flex ${
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

        <RailNavList items={NAV_ITEMS} collapsed={collapsed} />
        <div className="mx-3 my-3 border-t border-sidebar-border" />
        <RailNavList items={SECONDARY_NAV_ITEMS} collapsed={collapsed} />
        <SetlistsSlot collapsed={collapsed} />

        <UserMenuButton identity={identity} collapsed={collapsed} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-sidebar-border bg-sidebar-bg px-3 md:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="flex size-9 shrink-0 items-center justify-center rounded-md text-sidebar-text hover:bg-white/10"
          >
            <IconMenu2 size={22} />
          </button>
        </div>

        <div className="m-4 rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
          Reference sample —{' '}
          <span className="font-medium text-ink">Sidebar User Menu, Option 2 (identity card, dark popup)</span>.
          Replaces the static "Local Library" footer pill with a real account menu. Switch the identity state
          above, try collapsing the rail (the button at the top of the sidebar), and resize below 768px (or use
          a phone) to see the mobile drawer's own footer — same trigger and popup, just a wider drawer to sit
          in.
        </div>

        <main className="flex flex-1 flex-col gap-3 px-4 pb-8">
          <h1 className="font-display text-xl font-medium text-ink">Library</h1>
          <p className="text-sm text-ink-soft">128 pieces</p>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-lg border border-border bg-paper-sunken" />
          ))}
        </main>
      </div>

      <div
        aria-hidden={!drawerOpen}
        className={`fixed inset-0 z-40 bg-ink/40 transition-opacity duration-200 md:hidden ${
          drawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={() => setDrawerOpen(false)}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-sidebar-bg transition-transform duration-200 md:hidden ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-14 shrink-0 items-center justify-end px-3">
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close menu"
            className="flex size-9 shrink-0 items-center justify-center rounded-md text-sidebar-text-dim hover:text-sidebar-text"
          >
            <IconX size={20} />
          </button>
        </div>

        <DrawerNavList items={NAV_ITEMS} onNavigate={() => setDrawerOpen(false)} />
        <div className="mx-3 my-3 border-t border-sidebar-border" />
        <DrawerNavList items={SECONDARY_NAV_ITEMS} onNavigate={() => setDrawerOpen(false)} />

        <div className="mt-6 flex flex-1 flex-col overflow-y-auto px-2">
          <span className="px-3 text-xs tracking-wide text-sidebar-text-dim uppercase">Setlists</span>
          <div className="mt-1 flex flex-col">
            <span className="truncate rounded-md px-3 py-2 font-display text-[0.95rem] font-medium text-sidebar-text">
              Coming soon
            </span>
          </div>
        </div>

        <UserMenuButton identity={identity} collapsed={false} />
      </aside>
    </div>
  )
}
