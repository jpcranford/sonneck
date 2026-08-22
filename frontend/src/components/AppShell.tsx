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
            favicon 🪶). Went through Option E (wrapped text + mark below),
            Option D (the wordmark logo — reverted, felt "too much" even
            after lightening its color twice), Option C (inline mark +
            whisper-thin rule — reverted 2026-08-22 after two rounds of
            "tighten the spacing" still didn't read right; root cause was
            structural, not a spacing number: the wrapped-text box was
            always wider than its own ragged rendered lines, so no gap
            value could make a wrapped-row layout truly centered — see the
            git history for that whole saga), now Option E's "one-line"
            variant: the sentence NOT forced to wrap (no max-width on it at
            all — one line, however wide that ends up being) with the mark
            centered below it. A plain flex-col with align-items:center
            centers both children exactly, regardless of content width,
            because there's no wrapped/ragged text box to fight — this
            sidesteps the whole class of centering bug Option C kept
            running into.
            Color #847d75 — a solid pre-blend of ink-soft at 75% over this
            footer's actual background (--color-paper #fbfaf8), landing
            deliberately between the artifact's plain ink-soft (judged too
            heavy once seen live) and the even-lighter #a49e98 tried for
            Option D (judged too faint). Solid hex, not a translucent
            text-ink-soft/75 utility — the S mark's overlapping strokes
            would re-blend unevenly under real translucency
            (feedback-icon-color-preblend). Lives on the <a> itself with
            the mark/text inheriting it, so hover:text-ink below actually
            applies to both at once.
            SonneckMark is Gwendolyn 700 (bold) — see that component's own
            comment for the full reasoning; no weight prop to pass since
            the old per-size stroke-width faking is gone. */}
        <footer className="flex shrink-0 flex-col items-center px-6 pt-8 pb-10">
          {/* Understated separator from the routed content above — short
              on purpose (not the width of the credit line below it), just
              enough of a mark to read as "footer starts here" without
              being a full border-t rule across the whole width. Same
              --color-border token as every other subtle divider in the
              app (e.g. the toolbar dividers on Piece/Book Details), not a
              new color invented for this.
              Spacing below it is this span's own mb-5, not the footer's
              flex gap (removed from the footer element itself, now that
              it would otherwise stack with this margin) — mb-5 reads as
              visually equal to the gap-3.5 between text and logo further
              down, even though that's fewer raw pixels: a 1px hairline
              sitting flush against the credit text's own line-box reads
              tighter than the same pixel gap does against the logo mark,
              which has no line-box leading eating into it. Tuned by eye
              via zoomed screenshots, not left at the identical class
              value the two gaps started from. */}
          <span aria-hidden="true" className="mb-5 h-px w-10 bg-border" />
          <a
            href="https://github.com/jpcranford/sonneck"
            target="_blank"
            rel="noreferrer"
            className="flex flex-col items-center gap-3.5 text-[#847d75] hover:text-ink"
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
                width. Same failure mode already diagnosed for the old
                Option C icon+text row (frontend-footer-redesign memory),
                just missing here because this span has no sibling to stay
                paired against — text-align:center on the span itself is
                the direct fix, simpler than Option C's saga since there's
                no icon position to keep synced with a ragged box. */}
            <span className="text-center font-display text-[0.78rem] italic">
              Powered by Sonneck, an open-source music library
            </span>
            <SonneckMark className="size-8 shrink-0" />
          </a>
        </footer>
      </div>
    </div>
  )
}
