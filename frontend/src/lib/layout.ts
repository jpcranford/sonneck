// Shared content-width ceilings — AppShell.tsx's <main> has no width limit
// of its own (design doc left this
// unconstrained on purpose, since different pages want different caps), so
// without one of these a page just stretches to fill whatever's left after
// the sidebar — fine on a laptop, absurd on an ultrawide monitor. Plain
// class-string constants, not a wrapper component: every page that needs
// one already has its own root <div> with its own padding/gap scheme
// (Piece Details' `px-6 py-6 md:px-8 md:py-8` vs. the plain `p-6 md:p-8`
// most other pages use), so these compose into an existing className
// rather than imposing one opinionated wrapper's worth of spacing on every
// caller.

// The fallback ceiling — what a page gets if it doesn't need anything else.
// Equal to Piece Details' own pre-existing max-w-6xl, now formalized as the
// app-wide default rather than a one-off value only that page happened to
// pick.
export const CONTENT_MAX_W = 'mx-auto w-full max-w-6xl'

// Wider tier for grid/browsing views (Library/Books/People) — 1800px is a
// starting value, not a final one: on a 3440px ultrawide (this app's own
// target profile, minus the 256px sidebar leaves ~3184px), it caps an
// auto-fill `minmax(200px,1fr)` card grid at ~8 columns instead of an
// uncapped ~14, while still leaving real breathing room either side rather
// than a near-empty void. Expect to revise once it's actually applied and
// screenshotted against real content.
export const WIDE_CONTENT_MAX_W = 'mx-auto w-full max-w-[1800px]'

// Piece Details' page thumbnail. In one column (below lg:) it's at most
// half the usable screen (the window, less the phone top bar below md:),
// frame border included.
// In two columns its column always fits, without scrolling, the page, the
// 12px gap, the button row (its measured height, set as --row-h on the
// preview column; 38px is one line) and a peek of Your notes below it (the
// gap, the label and the note's first line, 63px measured, plus a little
// room: 4.5rem), under the page padding and toolbar above (94px measured,
// 6rem).
export const PIECE_PAGE_MAX_H =
  'max-h-[calc((100dvh-3.5rem)/2-2px)] md:max-h-[calc(100dvh/2-2px)] lg:max-h-[calc(100dvh-6rem-var(--row-h,38px)-0.75rem-4.5rem)]'
