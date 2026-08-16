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
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
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
            Powered by Sonneck, an open-source music score library
          </a>
        </footer>
      </div>
    </div>
  )
}
