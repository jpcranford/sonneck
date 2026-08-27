// The app's real scroll container isn't `window` — AppShell.tsx scrolls a
// specific inner div instead (its own comment explains why: the sidebar
// needs to stay pinned to full viewport height rather than scrolling away
// with the rest of the page). `window.scrollTo` is a silent no-op here, not
// an error — easy to reach for by habit and only notice it did nothing via
// a live check, not a type-check. Anything that needs to reset scroll
// position (e.g. a multi-step flow advancing to its next step) should go
// through this instead of assuming window is the scroller.
export function scrollAppContentToTop() {
  document.getElementById('app-scroll-container')?.scrollTo({ top: 0 })
}
