import { useCallback, useRef, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { IconLoader2 } from '@tabler/icons-react'
import { Sidebar } from './Sidebar'
import { MobileNavDrawer, MobileNavTopBar } from './MobileNav'
import { SonneckMark } from './SonneckMark'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { usePullToRefresh } from '../hooks/usePullToRefresh'

export function AppShell() {
  // Owned here, not inside MobileNav itself, because the top bar and the
  // drawer/scrim render in two different places in this tree (see
  // MobileNav.tsx's own comment for why) and need to share one state.
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Pull-to-refresh — mobile/tablet widths only, not desktop (a touch
  // gesture makes no sense gated purely on chrome, which stays desktop/
  // tablet-shared at `md`). 1024px, inclusive, matches the responsive
  // plan's own locked device-target table (project_responsive_device_plan.md)
  // exactly — iPad 6th gen landscape is 1024×768 and is explicitly called
  // "Tablet" there, so the cutover needs to include 1024, not exclude it
  // the way Tailwind's own `lg:` (min-width: 1024px) media query would.
  const isMobileOrTablet = useMediaQuery('(max-width: 1024px)')
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  // Refetches every currently-mounted query rather than a hard page
  // reload — cheap, keeps scroll position/local UI state, and is exactly
  // what "refresh" means for a TanStack-Query-driven app like this one.
  const refreshActiveQueries = useCallback(() => queryClient.refetchQueries({ type: 'active' }), [queryClient])
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
    <div className="flex h-dvh overflow-hidden bg-paper text-ink">
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
      <div
        id="app-scroll-container"
        ref={scrollContainerRef}
        className="flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain"
      >
        <MobileNavTopBar onOpen={() => setMobileNavOpen(true)} />
        {/* Pull-to-refresh indicator — placed AFTER MobileNavTopBar, not
            before it: that bar is `sticky top-0`, standard mobile-app
            practice is for it to stay pinned in place while the indicator
            reveals in the content area below it, not get pushed down by
            the indicator's own growing height. A real sibling of main/
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
              className={phase === 'refreshing' ? 'animate-spin text-accent' : phase === 'ready' ? 'text-accent' : 'text-ink-soft'}
              style={
                phase === 'refreshing'
                  ? undefined
                  : { transform: `rotate(${Math.min((pullDistance / threshold) * 180, 180)}deg)` }
              }
            />
          </div>
        )}
        <main className="flex flex-1 flex-col">
          <Outlet />
        </main>
        {/* flex-col + items-center, not justify-center on a wrapped text
            box: a wrapped text child sizes to its own available width, not
            its rendered line width, so bounding-box centering alone
            doesn't visually center ragged wrapped text against a
            fixed-position icon. This layout has no such box to fight —
            centering is exact regardless of content width.
            Color #847d75 is a solid pre-blend of ink-soft at 75% over this
            footer's own paper background, not a translucent opacity
            utility — the S mark's overlapping strokes would re-blend
            unevenly under real translucency (CLAUDE.md > Frontend's icon
            pre-blend rule). Lives on the <a> itself with the mark/text
            inheriting it, so hover:text-ink below applies to both at once.
            SonneckMark is Gwendolyn 700 (bold) — see that component's own
            comment for the full reasoning. */}
        <footer className="flex shrink-0 flex-col items-center px-6 pt-0 pb-9">
          {/* NOTE: the above's pb-8 is the space between s mark and bottom of page. The below's mb-6 is the space between s mark and line. Kept at 2:3 ratio for now 'cause it looks nice. */}
          <span aria-hidden="true" className="mb-6 h-px w-10 bg-border" />
          <a
            href="https://github.com/jpcranford/sonneck"
            target="_blank"
            rel="noreferrer"
            className="flex cursor-pointer flex-col items-center gap-3.5 text-[#847d75] hover:text-ink"
          >
            {/* No whitespace-nowrap here on purpose, even though the design
                intent is "one line" — the sentence's natural width (~288px)
                comfortably fits one line on any normal desktop/tablet width,
                but is wider than the available content area on a narrow
                phone (e.g. ~263px on a 375px-wide screen once the sidebar
                rail and padding are subtracted). This container scrolls
                with overflow-x-hidden (see this file's own comment on that
                further up), so a forced nowrap would silently clip the text
                on narrow screens rather than scroll or wrap — leaving
                default wrapping in place lets it degrade to two lines only
                when genuinely too narrow, which is the safer failure mode.
                text-center is required here, not redundant with the
                column's own items-center: once this span wraps, its box
                sizes to the *available* width (CSS's fit-content formula:
                max(min-content, available) when max-content > available),
                not to its own longest rendered line — so items-center
                (which only centers that box within the column) leaves the
                ragged lines flush-left inside a box that's already full
                width — text-align:center on the span itself is the direct
                fix, since there's no icon position here that needs to
                stay synced with a ragged box. */}
            {/* <span className="text-center font-display text-[0.78rem] italic">
              Powered by Sonneck, an open-source music library
            </span> */}
            <SonneckMark className="size-8 shrink-0" />
          </a>
        </footer>
      </div>
      <MobileNavDrawer open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
    </div>
  )
}
