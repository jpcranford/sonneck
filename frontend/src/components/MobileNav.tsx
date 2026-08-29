import { NavLink } from 'react-router-dom'
import { IconMenu2, IconUserFilled, IconX } from '@tabler/icons-react'
import { NAV_ITEMS, SECONDARY_NAV_ITEMS, SETLISTS, type NavItem } from '../lib/navItems'

// Mobile-only top bar + left drawer — the classic hamburger-drawer
// pattern, chosen over a top-fold panel, a bottom sheet, and a bottom tab
// bar. Replaces the permanently-docked icon-only rail Sidebar.tsx used to
// fall back to below 768px with a slim top bar + a slide-in drawer that's
// entirely absent from the screen until asked for. Shares Sidebar.tsx's
// real NAV_ITEMS/SECONDARY_NAV_ITEMS/SETLISTS data directly.
//
// Deliberately logo-less — went through the full wordmark, then
// mark-plus-text, then mark-only, before landing here. The wordmark hit a
// real small-size rendering defect in the k glyph at the time (see
// SonneckWordmark.tsx's own comment; since resolved by a hand-traced bold
// replacing the old filter-based one) and was dropped for that reason;
// going logo-less entirely rather than falling back to the S mark was a
// separate simplification call on top of that, not a workaround for it.
// Worth reconsidering now that the defect's fixed, but that's a fresh
// design call, not something this comment update decides on its own.
//
// Split into two components, not one, because the mockup's own layout
// puts them in two different places in the tree: the top bar is a normal
// (non-sticky) child of the scrollable content column — it scrolls away
// with the page, matching the mockup's own behavior, which was approved
// as-is — while the scrim + drawer are fixed-position overlays anchored
// to the whole viewport. AppShell.tsx owns the shared `open` state and
// renders MobileNavTopBar inside its scroll container and
// MobileNavDrawer as a top-level sibling, next to the (desktop-only,
// `hidden md:block`) Sidebar.

export function MobileNavTopBar({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-sidebar-border bg-sidebar-bg px-3 md:hidden">
      <button
        type="button"
        onClick={onOpen}
        aria-label="Open menu"
        className="flex size-9 shrink-0 items-center justify-center rounded-md text-sidebar-text hover:bg-white/10"
      >
        <IconMenu2 size={22} />
      </button>
    </div>
  )
}

// Rows are h-11 (44px), not the desktop rail's h-10 — a deliberate bump
// for this drawer specifically. The rail's h-10 was sized for a
// permanently visible, mouse-and-occasional-thumb rail; a menu that ONLY
// exists as a tap target (open it, tap an item, it's gone) should hit
// Apple/Android's ~44px minimum touch-target guidance, and the drawer has
// the width to spare that the collapsed rail never did (see the mobile
// parity audit's "undersized tap targets" finding, which this partly
// addresses).
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
          {/* relative top-[0.6px]: same eye-calibrated fix as Sidebar.tsx's
              own NavItemsList — see that file's comment. */}
          <span className="relative top-[0.6px] truncate">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

export function MobileNavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      <div
        aria-hidden={!open}
        className={`fixed inset-0 z-40 bg-ink/40 transition-opacity duration-200 md:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-sidebar-bg transition-transform duration-200 md:hidden ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-14 shrink-0 items-center justify-end px-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex size-9 shrink-0 items-center justify-center rounded-md text-sidebar-text-dim hover:text-sidebar-text"
          >
            <IconX size={20} />
          </button>
        </div>

        <DrawerNavList items={NAV_ITEMS} onNavigate={onClose} />
        <div className="mx-3 my-3 border-t border-sidebar-border" />
        <DrawerNavList items={SECONDARY_NAV_ITEMS} onNavigate={onClose} />

        <div className="mt-6 flex flex-1 flex-col overflow-y-auto px-2">
          <span className="px-3 text-xs tracking-wide text-sidebar-text-dim uppercase">Setlists</span>
          <div className="mt-1 flex flex-col">
            {SETLISTS.length === 0 && (
              <span className="truncate rounded-md px-3 py-2 font-display text-[0.95rem] font-medium text-sidebar-text">
                Coming soon
              </span>
            )}
          </div>
        </div>

        <div className="m-2 flex items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-panel p-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-sidebar-border bg-sidebar-bg text-sidebar-text">
            <IconUserFilled size={16} />
          </span>
          <span className="truncate text-[0.95rem] text-sidebar-text">Local Library</span>
        </div>
      </aside>
    </>
  )
}
