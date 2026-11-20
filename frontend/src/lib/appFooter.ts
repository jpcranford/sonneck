// Paths that draw the footer mark (components/AppFooter.tsx) themselves
// rather than after the page: the Practice Dashboard (and its mockup) keeps
// it at the end of its shelves column, so its pinned right-hand column runs
// the page's full height instead of riding up over a footer below the page.
// Its own module, not exported beside the component, so the component's
// file keeps Fast Refresh (react-refresh/only-export-components).
export const PAGES_WITH_OWN_FOOTER = ['/practice', '/mockup/practice-dashboard']
