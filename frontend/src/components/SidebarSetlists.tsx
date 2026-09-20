import { useEffect, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { IconDots } from '@tabler/icons-react'
import { formatRelativeWeeks } from '../lib/relativeWeeks'
import type { Setlist } from '../api/types'

// Real port of SidebarSetlistsMockup.tsx's own SetlistsSection/SetlistsMenu
// (Setlists design pass, Phase 5 mockup approved; this is Phase 14's real
// build) — replaces Sidebar.tsx's/MobileNav.tsx's own inert "Coming soon"
// placeholder. Shared between both real files (desktop rail + mobile
// drawer) rather than duplicated, same "one component, two call sites"
// precedent as UserMenuButton.

// The "⋯" menu — same outside-click/Escape dismiss convention as
// ContextMenu.tsx. Points at the real (if still-a-stub) /setlists index
// route — SetlistsLibraryPage.tsx isn't built for real until Phase 15, but
// the route itself is real and reachable now (scaffold-and-hide), so a
// shipped nav item never links into a /mockup/* URL.
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
        // normal-case — this menu is nested inside the section heading's
        // own uppercase-styled row ("Upcoming Sets" + this trigger button
        // share one flex container), and text-transform inherits through
        // CSS regardless of this popup's own absolute positioning; without
        // it, "View All Setlists"/"Archive" render as "VIEW ALL
        // SETLISTS"/"ARCHIVE" despite the source text already being
        // correctly Title Case. w-max max-w-[13rem] (not a flat w-44) —
        // shrinks to the widest item's own single-line width, capped at a
        // real ceiling rather than a guess; this menu only ever renders
        // inside the Sidebar's own 256px rail or the MobileNav drawer (max
        // 288px/85vw), both fixed, known-narrow containers, so a plain CSS
        // cap is enough (no JS viewport measurement needed, unlike
        // AddToSetlistPicker's own general-purpose floating popover). No
        // whitespace-nowrap — once content would exceed the cap, normal
        // CSS text wrapping takes over on its own, so a longer future item
        // wraps onto a second line instead of overflowing the sidebar or
        // getting clipped by it. Both fixes approved in
        // SidebarSetlistsMockup.tsx first (mockup-first standing rule)
        // before landing here.
        <div className="absolute top-6 right-0 z-10 w-max max-w-[13rem] overflow-hidden rounded-md border border-sidebar-border bg-sidebar-panel py-1 shadow-lg normal-case">
          <Link
            to="/setlists"
            onClick={() => setOpen(false)}
            className="block w-full cursor-pointer px-3 py-1.5 text-left text-[0.82rem] text-sidebar-text hover:bg-white/5"
          >
            View All Setlists
          </Link>
          <Link
            to="/setlists#archived"
            onClick={() => setOpen(false)}
            className="block w-full cursor-pointer px-3 py-1.5 text-left text-[0.82rem] text-sidebar-text hover:bg-white/5"
          >
            Archive
          </Link>
        </div>
      )}
    </div>
  )
}

// `setlists` is always getUpcomingSetlists' own result (or []), never the
// raw list — gigDate is guaranteed present here.
export function SetlistsSection({
  collapsed,
  setlists,
}: {
  collapsed: boolean
  setlists: (Setlist & { gigDate: string })[]
}) {
  if (collapsed) {
    // Collapsed rail: no room for a label/menu row — just the same
    // single-letter-circle treatment every other collapsed nav item gets.
    // Nothing renders in the empty state either, same as any other
    // icon-only rail section with nothing to show.
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
