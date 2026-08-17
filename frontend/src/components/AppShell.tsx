import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-paper text-ink">
      <Sidebar />
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
          the Piece View: InfoTooltip's bubble (e.g. the public-domain
          badge, positioned at the right edge of the info column) is
          centered on its trigger and can extend past this container's
          right edge while still invisible (opacity-0 until hovered) —
          invisible elements still contribute to scrollWidth, so this read
          as "extra space to the right that can be horizontally scrolled
          to" with nothing visibly there. This app has no design that
          calls for horizontal scrolling anywhere in the main content
          column, so hidden is correct here, not auto. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
        <main className="flex flex-1 flex-col">
          <Outlet />
        </main>
        <footer className="shrink-0 px-4 py-3 text-center">
          <a
            href="https://github.com/jpcranford/sonneck"
            target="_blank"
            rel="noreferrer"
            className="font-display text-[0.8rem] text-ink-soft italic hover:text-ink"
          >
            Powered by Sonneck, an open-source music library
          </a>
        </footer>
      </div>
    </div>
  )
}
