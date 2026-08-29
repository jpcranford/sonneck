import { useState, type ComponentType } from 'react'
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
  IconMenu2,
  IconX,
} from '@tabler/icons-react'
import { Sidebar } from '../components/Sidebar'
import { useMockupTitle } from '../lib/useMockupTitle'

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
}

// Hand-copied from Sidebar.tsx's own NAV_ITEMS/SECONDARY_NAV_ITEMS — same
// "no shared component between a mockup and the real thing" convention as
// every other mockup in this codebase (see e.g. PieceDetailsSample.tsx's
// own comment). Only gets reconciled with Sidebar.tsx's real data if this
// design is approved and ported over for real.
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Library', icon: IconLibrary },
  { to: '/composers', label: 'Composers', icon: IconUser },
  { to: '/books', label: 'Books', icon: IconBooks },
  { to: '/upload', label: 'Upload', icon: IconCloudUpload },
]
const SECONDARY_NAV_ITEMS: NavItem[] = [
  { to: '/favorites', label: 'Favorites', icon: IconHeart },
  { to: '/want-to-learn', label: 'Want to Learn', icon: IconCircleDashed },
  { to: '/practicing', label: 'Currently Practicing', icon: IconCircleHalf2 },
  { to: '/learned', label: 'Learned', icon: IconCircleCheckFilled },
]
const SETLISTS: { id: string; name: string }[] = []

// Rows are h-11 (44px), not the real rail's h-10 — a deliberate bump for
// this drawer specifically. The rail's h-10 was sized for a permanently
// visible, mouse-and-occasional-thumb rail; a menu that ONLY exists as a
// tap target (open it, tap an item, it's gone) should hit Apple/Android's
// ~44px minimum touch-target guidance, and the drawer has the width to
// spare that the collapsed rail never did. Worth flagging for approval,
// not slipped in silently — see also the mobile parity audit's
// "undersized tap targets" finding this is partly addressing.
function DrawerNavList({ items }: { items: NavItem[] }) {
  return (
    <nav className="flex flex-col gap-1 px-2">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex h-11 items-center gap-3 rounded-md px-3 font-display text-[0.95rem] font-medium ${
              isActive ? 'bg-sidebar-panel text-sidebar-text' : 'text-sidebar-text hover:bg-white/5'
            }`
          }
        >
          <Icon size={22} className="text-sidebar-text" />
          <span className="truncate">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

// Mobile-only left drawer: the classic hamburger-drawer pattern, chosen
// over a top-fold panel, a bottom sheet, and a bottom tab bar. Replaces
// the permanently-docked icon-only rail Sidebar.tsx currently falls back
// to below 768px with a slim top bar + a slide-in drawer that's entirely
// absent from the screen until asked for.
//
// Desktop (md and up) is untouched on purpose — this renders the real
// <Sidebar /> component there, completely unmodified, rather than a
// second hand-copied desktop rail. Zero risk of this mockup drifting from
// production desktop behavior, and it means only the mobile path below is
// actually new design surface to review.
export function MobileNavDrawerMockup() {
  useMockupTitle('Mobile Nav — Left Drawer')
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden bg-paper text-ink">
      <div className="hidden md:block">
        <Sidebar />
      </div>

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
          Reference sample — <span className="font-medium text-ink">Mobile Nav, Option B (left drawer)</span>.
          Resize this window below 768px, or open it on a phone, to see the mobile top bar +
          drawer. Desktop is the real Sidebar component, unchanged.
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

        <DrawerNavList items={NAV_ITEMS} />
        <div className="mx-3 my-3 border-t border-sidebar-border" />
        <DrawerNavList items={SECONDARY_NAV_ITEMS} />

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
    </div>
  )
}
