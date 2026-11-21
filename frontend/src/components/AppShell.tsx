import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { IconLoader2 } from '@tabler/icons-react'
import { Sidebar } from './Sidebar'
import { DropToUpload } from './DropToUpload'
import { MobileNavDrawer, MobileNavTopBar } from './MobileNav'
import { AppFooter } from './AppFooter'
import { PAGES_WITH_OWN_FOOTER } from '../lib/appFooter'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { getUserSettings, updateUserSettings, type UserSettings } from '../api/userSettings'
import { PageToolbarSlotContext } from '../lib/pageToolbarSlot'
import { useDarkScoresSync, useThemePreference, useThemeSync } from '../lib/theme'
import { useSidebarShortcuts } from '../hooks/useSidebarShortcuts'
import { useFullscreenShortcut } from '../hooks/useFullscreenShortcut'
import { useScrollRestoration } from '../hooks/useScrollRestoration'
import { ShortcutHelp } from './ShortcutHelp'

// The native app opens its window on the account's saved theme color before
// the page loads (cmd/sonneck-desktop/theme.go), so there the device's
// choice is copied to the account. A native install is its own device, so
// the two never disagree for long; browsers leave the account's copy alone.
function useNativeLaunchTheme(settings: UserSettings | undefined) {
  const queryClient = useQueryClient()
  const preference = useThemePreference()
  useEffect(() => {
    if (!window.runtime || !settings || settings.themePreference === preference) return
    updateUserSettings({ ...settings, themePreference: preference })
      .then((updated) => queryClient.setQueryData(['user-settings'], updated))
      .catch(() => {
        // Only the next launch's window color is affected.
      })
  }, [preference, settings, queryClient])
}

export function AppShell() {
  const location = useLocation()
  useSidebarShortcuts()
  useFullscreenShortcut()
  // Owned here, not inside MobileNav itself, because the top bar and the
  // drawer/scrim render in two different places in this tree (see
  // MobileNav.tsx's own comment for why) and need to share one state.
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  // The page toolbar slot below the top bar (lib/pageToolbarSlot.ts);
  // state, not a ref, so the toolbar re-renders into it once it mounts.
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null)

  // This device's light/dark/system choice, applied app-wide; Dark Mode
  // Scores is the account's.
  const { data: settings } = useQuery({ queryKey: ['user-settings'], queryFn: getUserSettings })
  useThemeSync()
  useDarkScoresSync(settings?.darkModeScores)
  useNativeLaunchTheme(settings)

  // Pull-to-refresh — mobile/tablet widths only, not desktop (a touch
  // gesture makes no sense gated purely on chrome, which stays desktop/
  // tablet-shared at `md`). 1024px, inclusive, matches the responsive
  // plan's own locked device-target table (project_responsive_device_plan.md)
  // exactly — iPad 6th gen landscape is 1024×768 and is explicitly called
  // "Tablet" there, so the cutover needs to include 1024, not exclude it
  // the way Tailwind's own `lg:` (min-width: 1024px) media query would.
  const isMobileOrTablet = useMediaQuery('(max-width: 1024px)')
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // New pages start at the top; Back/Forward returns to where you were.
  useScrollRestoration(scrollContainerRef)
  const queryClient = useQueryClient()
  // Refetches every currently-mounted query rather than a hard page
  // reload — cheap, keeps scroll position/local UI state, and is exactly
  // what "refresh" means for a TanStack-Query-driven app like this one.
  const refreshActiveQueries = useCallback(
    () => queryClient.refetchQueries({ type: 'active' }),
    [queryClient],
  )
  const { pullDistance, phase, threshold } = usePullToRefresh({
    containerRef: scrollContainerRef,
    onRefresh: refreshActiveQueries,
    enabled: isMobileOrTablet,
  })

  return (
    // h-dvh, not h-screen (100vh) — 100vh stays pinned to a fixed
    // worst-case viewport height and doesn't track Safari's own dynamic
    // address-bar/toolbar animation, which keeps changing the *actually*
    // visible height while the user scrolls. This shell's own *nested*
    // scroll container (#app-scroll-container below, not this outer div)
    // is exactly the kind of element iOS Safari can reset scrollTop to 0
    // on when that mismatch gets reconciled mid-swipe, snapping the whole
    // page back to the top mid-scroll. 100dvh tracks the real,
    // currently-visible viewport instead of a fixed one, removing the
    // mismatch this bug depends on.
    <PageToolbarSlotContext.Provider value={toolbarSlot}>
      {/* Beside the sidebar (md: and up) the frame behind the content is
          the sidebar's color, and the content column rounds its two
          corners against it (16px, picked on /mockup/sidebar-setlists) —
          a sheet set into the frame, which draws the eye to the page. The
          rounding replaces the sidebar's old border-r hairline. */}
      <div className="flex h-dvh overflow-hidden bg-paper text-ink md:bg-sidebar-bg">
        {/* App-wide drag-and-drop upload (design doc §13) — window-level
          listeners plus its overlay and dialogs, rendered once here. */}
        <DropToUpload />
        {/* Desktop only — MobileNav (top bar + drawer, its own `md:hidden`
          guards) covers everything below the md breakpoint instead. */}
        <div className="hidden md:block">
          <Sidebar />
        </div>
        {/* This div, not <main>, is the scroll container — footer scrolls
          along with the routed content as one unit (reaches it at the end
          of a long list), while the sidebar (a flex sibling, not inside
          this scrolling div) stays pinned to the full viewport height
          instead of ending after one screen's worth of scroll like it did
          when the whole page (not this div) used to scroll as a block. */}
        {/* overflow-x-hidden explicitly, not left implicit: per the CSS spec,
          setting overflow-y to a non-visible value (auto, here) silently
          computes a bare/unset overflow-x to auto too, not visible — this
          container was quietly horizontally scrollable as a result, with
          nothing intentionally using that space. Real instance found on
          the Piece Details page: InfoTooltip's bubble (e.g. the public-domain
          badge, positioned at the right edge of the info column) is
          centered on its trigger and can extend past this container's
          right edge while still invisible (opacity-0 until hovered) —
          invisible elements still contribute to scrollWidth, so this read
          as "extra space to the right that can be horizontally scrolled
          to" with nothing visibly there. This app has no design that
          calls for horizontal scrolling anywhere in the main content
          column, so hidden is correct here, not auto. */}
        {/* The narrow-screen top bar sits above the scroll container, not
          sticky inside it: iOS's rubber-band bounce at the top drags a
          sticky element down with the content, so a fast fling to the top
          pulled the bar away from the screen's edge. Outside it, only the
          page bounces, under a bar that never moves. The library pages'
          toolbar joins it in the slot below. */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-paper md:rounded-l-2xl md:pl-1">
          <MobileNavTopBar onOpen={() => setMobileNavOpen(true)} />
          {/* A page's own toolbar renders here (components/PageToolbarSlot.tsx),
            above the scroll container for the same reason as the top bar.
            z-20 so its dropdowns open over the page below. */}
          <div ref={setToolbarSlot} className="relative z-20 shrink-0" />
          <div
            id="app-scroll-container"
            ref={scrollContainerRef}
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain"
          >
            {/* Pull-to-refresh indicator — at the top of the scroll container,
            so it reveals below the top bar rather than pushing the bar
            down. A real sibling of main/
            footer inside this same scrolling div, not a fixed overlay —
            its height (0 normally) IS the pull distance, so growing it
            pushes `main` down via ordinary layout instead of needing a
            transform + portal. Works because we're only ever visible
            while scrollTop is already 0 (usePullToRefresh's own guard) —
            the container's own top edge and the viewport's top edge are
            the same point at that moment, and (below `md:`) sit directly
            under the toolbar's own fixed height. No transition while
            actively dragging ('pulling'/'ready' only ever happen mid-
            gesture) — only on release, snapping back to 0 or settling at
            the fixed refreshing height. */}
            {isMobileOrTablet && (
              <div
                aria-hidden="true"
                className={`flex shrink-0 items-center justify-center overflow-hidden ${
                  phase === 'pulling' || phase === 'ready' ? '' : 'transition-[height] duration-200'
                }`}
                style={{ height: pullDistance }}
              >
                <IconLoader2
                  size={22}
                  className={
                    phase === 'refreshing'
                      ? 'animate-spin text-accent'
                      : phase === 'ready'
                        ? 'text-accent'
                        : 'text-ink-soft'
                  }
                  style={
                    phase === 'refreshing'
                      ? undefined
                      : {
                          transform: `rotate(${Math.min((pullDistance / threshold) * 180, 180)}deg)`,
                        }
                  }
                />
              </div>
            )}
            <main className="flex flex-1 flex-col">
              <Outlet />
            </main>
            {!PAGES_WITH_OWN_FOOTER.includes(location.pathname) && <AppFooter />}
          </div>
        </div>
        <MobileNavDrawer open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
        {/* Hold / or ? for this page's keyboard shortcuts. */}
        <ShortcutHelp />
      </div>
    </PageToolbarSlotContext.Provider>
  )
}
