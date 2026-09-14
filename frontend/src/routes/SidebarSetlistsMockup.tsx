import { useEffect, useRef, useState, type ComponentType } from 'react'
import { NavLink } from 'react-router-dom'
import {
  IconLibrary,
  IconBooks,
  IconUser,
  IconCloudUpload,
  IconHeart,
  IconCircleHalf2,
  IconCircleDashed,
  IconCircleCheckFilled,
  IconLayoutSidebarLeftCollapseFilled,
  IconLayoutSidebarLeftExpandFilled,
  IconMenu2,
  IconX,
  IconDots,
} from '@tabler/icons-react'
import { useMockupTitle } from '../lib/useMockupTitle'
import { formatRelativeWeeks } from '../lib/relativeWeeks'
import { ALL_MOCK_SETLISTS, getUpcomingSetlists, type MockSetlist } from '../lib/setlistsMockupFixture'

// Setlists design pass — replaces the inert "Coming soon" placeholder
// (Sidebar.tsx/MobileNav.tsx's own SETLISTS.length === 0 branch) with the
// real design locked in across the Setlists artifact review: a divider
// above the section (same rhythm as the divider between the primary and
// secondary nav groups above it), the "Upcoming Sets" heading (a direct
// correction — an earlier pass had this foldable and labeled "Setlists";
// both dropped), up to ~5 soonest upcoming setlists sorted by gig date
// (relative-date rows, abbreviated "wks" form — the fuller "weeks"
// spelling is the Setlist Archive page's own, more spacious version of the
// same underlying formatRelativeWeeks helper), and a "⋯" menu on the
// section header for "View All Setlists"/"Archive" — both still-unbuilt
// destinations (Phase 10), so the menu items are inert here on purpose.
//
// Hand-copied from Sidebar.tsx/MobileNav.tsx (nav items, collapse/drawer
// mechanics), same standing mockup convention every other sidebar-area
// mockup here already follows (SidebarUserMenuMockup.tsx) — not nested
// inside <AppShell/> for the same reason: this replaces the real shell's
// own Setlists section, so nesting it inside the real shell would show two
// competing sections.
//
// Fixture setlists are real Date objects computed relative to "now" at
// render time (not hardcoded relative-date strings) so the relative labels
// stay honest no matter when this mockup is actually viewed.

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

// Shared fixture (lib/setlistsMockupFixture.ts) — same "my setlists"
// universe the Add to Setlist popover searches across, so its own quick
// list (computed with the same getUpcomingSetlists call) is honestly the
// same data this section shows, not just visually similar. Cap at ~5
// soonest upcoming (decision 10) — everything past this point is reached
// via the "⋯" menu's "View All Setlists" item instead.
const VISIBLE_SETLISTS = getUpcomingSetlists(ALL_MOCK_SETLISTS, 5)

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

// The "⋯" menu — same dismiss convention as ContextMenu.tsx (outside
// click/Escape closes it). Both items are inert (no onClick navigation):
// neither /setlists (View All) nor the Archive section within it exists
// yet (Phase 10), so there's nowhere real to send a click — a disabled
// look would be wrong here too, since these aren't permission-gated, just
// not built yet, so they render as plain unstyled buttons that simply do
// nothing when clicked, same "reachable, not yet wired" posture as the
// real SetlistPage.tsx stub itself.
function SetlistsMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="More setlist options"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex size-5 cursor-pointer items-center justify-center rounded text-sidebar-text-dim hover:text-sidebar-text"
      >
        <IconDots size={14} />
      </button>
      {open && (
        <div className="absolute top-6 right-0 z-10 w-44 overflow-hidden rounded-md border border-sidebar-border bg-sidebar-panel py-1 shadow-lg">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="block w-full cursor-pointer px-3 py-1.5 text-left text-[0.82rem] text-sidebar-text hover:bg-white/5"
          >
            View All Setlists
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="block w-full cursor-pointer px-3 py-1.5 text-left text-[0.82rem] text-sidebar-text hover:bg-white/5"
          >
            Archive
          </button>
        </div>
      )}
    </div>
  )
}

// Shared between the desktop rail and the mobile drawer — same row shape
// and "⋯" menu either side (mobile just has more room, no
// collapsed/single-letter-circle variant to worry about). `setlists` is
// passed in rather than read off the module-level fixture directly, so the
// page-level "no upcoming sets" preview switcher below can swap it for an
// empty array live.
function SetlistsSection({ collapsed, setlists }: { collapsed: boolean; setlists: MockSetlist[] }) {
  if (collapsed) {
    // Collapsed rail: no room for a label/chevron/menu row at all — just
    // the same single-letter-circle treatment every other collapsed nav
    // item already gets, one per setlist, still capped at 5. Nothing
    // renders in the empty-preview state (no room for a message at this
    // width either), same as any other icon-only rail section with
    // nothing to show.
    return (
      <div className="mt-6 flex flex-1 flex-col items-center gap-1 overflow-y-auto px-2">
        {setlists.map((setlist) => (
          <NavLink
            key={setlist.id}
            to={`/setlists/${setlist.id}`}
            title={setlist.name}
            className={({ isActive }) =>
              `flex size-10 items-center justify-center rounded-md font-display text-[0.95rem] font-medium ${
                isActive ? 'bg-sidebar-panel text-sidebar-text' : 'text-sidebar-text hover:bg-white/5'
              }`
            }
          >
            {setlist.name.charAt(0).toUpperCase()}
          </NavLink>
        ))}
      </div>
    )
  }

  return (
    <div className="mt-6 flex flex-1 flex-col overflow-y-auto px-2">
      <div className="flex items-center justify-between px-2 py-0.5 text-xs tracking-wide text-sidebar-text-dim uppercase">
        <span>Upcoming Sets</span>
        <SetlistsMenu />
      </div>
      {setlists.length === 0 ? (
        <p className="mt-1 px-2 py-1.5 text-sm text-sidebar-text-dim/60 italic">No upcoming sets</p>
      ) : (
        <div className="mt-1 flex flex-col">
          {setlists.map((setlist) => (
            <NavLink
              key={setlist.id}
              to={`/setlists/${setlist.id}`}
              className={({ isActive }) =>
                `mt-1 flex items-center justify-between gap-2 truncate rounded-md px-2 py-1.5 font-display text-[0.95rem] font-medium first:mt-0 ${
                  isActive ? 'bg-sidebar-panel text-sidebar-text' : 'text-sidebar-text hover:bg-white/5'
                }`
              }
            >
              <span className="truncate">{setlist.name}</span>
              <span className="shrink-0 font-sans text-xs font-normal text-sidebar-text-dim">
                {formatRelativeWeeks(setlist.gigDate)}
              </span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

export function SidebarSetlistsMockup() {
  useMockupTitle('Sidebar Setlists')
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Preview switcher for the "no upcoming sets" empty state — nothing
  // equivalent exists in the real page (there, the list is just whatever
  // GET /api/setlists actually returns); this lets both real states be
  // seen live without editing the fixture by hand.
  const [previewEmpty, setPreviewEmpty] = useState(false)
  const previewSetlists = previewEmpty ? [] : VISIBLE_SETLISTS

  return (
    <div className="flex h-dvh overflow-hidden bg-paper text-ink">
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
        <SetlistsSection collapsed={collapsed} setlists={previewSetlists} />

        <div className="m-2 h-11 shrink-0 rounded-lg border border-sidebar-border bg-sidebar-panel" />
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

        <div className="m-4 flex flex-col gap-2 rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
          <p>
            Reference sample — <span className="font-medium text-ink">Sidebar Setlists section</span>. Replaces the
            inert "Coming soon" placeholder with an "Upcoming Sets" heading, the 5 soonest upcoming fixture setlists
            (real gig dates computed relative to today), and a "⋯" menu for the still-unbuilt View All/Archive
            destinations (Phase 10) — both inert here on purpose. Try collapsing the rail, or resizing below 768px
            (or use a phone) for the mobile drawer.
          </p>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-medium text-ink-soft">Preview:</span>
            <button
              type="button"
              onClick={() => setPreviewEmpty(false)}
              className={`cursor-pointer rounded-full border px-2.5 py-1 ${
                !previewEmpty ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-soft hover:text-ink'
              }`}
            >
              Has upcoming sets
            </button>
            <button
              type="button"
              onClick={() => setPreviewEmpty(true)}
              className={`cursor-pointer rounded-full border px-2.5 py-1 ${
                previewEmpty ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-soft hover:text-ink'
              }`}
            >
              No upcoming sets
            </button>
          </div>
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
        <SetlistsSection collapsed={false} setlists={previewSetlists} />

        <div className="m-2 h-11 shrink-0 rounded-lg border border-sidebar-border bg-sidebar-panel" />
      </aside>
    </div>
  )
}
