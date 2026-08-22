import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { SonneckMark } from './SonneckMark'

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
          the Piece Details page: InfoTooltip's bubble (e.g. the public-domain
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
        {/* Swapped from a left-aligned, border-topped bar to an understated
            centered block (2026-08-21, direct instruction) — chosen from a
            6-option comparison (https://claude.ai/code/artifact/51d2a939-267c-4d66-a597-f6038ddcc830,
            favicon 🪶). Went through Option E, then Option D (the wordmark
            logo — reverted, felt "too much" even after lightening its
            color twice), now Option C ("Inline mark + whisper-thin rule"):
            a 32px hairline above a centered icon+text lockup — the S mark
            (32px, "Light") vertically centered against the two wrapped
            text lines beside it, the whole cluster centered as one unit
            under the rule. No full-width border-top — just this one short
            32px hairline plus generous whitespace (pt-10/pb-[38px], gap-3.5
            between the rule and the lockup below it) does the separating
            now.
            Color: neither the artifact's plain ink-soft (judged too heavy
            once seen live) nor the even-lighter #a49e98 tried for Option D
            (judged too faint the other direction) — #847d75 below is a
            solid pre-blend of ink-soft at 75% over this footer's actual
            background (--color-paper #fbfaf8), landing deliberately between
            those two rather than reusing either. Solid hex, not a
            translucent text-ink-soft/75 utility, for the same reason as
            the #a49e98 case before it: the S mark's stroke+fill layering
            would re-blend unevenly at its own overlaps under real
            translucency. color lives on the <a> itself with the mark/text
            inheriting it (fill="currentColor" / plain color inheritance)
            rather than each hardcoding its own color like the artifact
            does — that's what makes hover:text-ink below actually take
            effect on both at once, which the artifact's own CSS doesn't
            (its child elements set color directly, so the hover rule on
            its <a> is a no-op there — not worth carrying that bug into the
            real build). */}
        <footer className="flex shrink-0 flex-col items-center gap-3.5 px-6 pt-10 pb-[38px]">
          <span aria-hidden="true" className="h-px w-8 bg-border" />
          <a
            href="https://github.com/jpcranford/sonneck"
            target="_blank"
            rel="noreferrer"
            className="flex max-w-[240px] items-center gap-4 text-[#847d75] hover:text-ink"
          >
            <SonneckMark weight="light" className="size-8 shrink-0" />
            <span className="font-display text-left text-[0.78rem] italic leading-[1.55]">
              Powered by Sonneck, an open-source music library
            </span>
          </a>
        </footer>
      </div>
    </div>
  )
}
