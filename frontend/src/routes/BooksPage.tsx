import { ComingSoon } from '../components/ComingSoon'

// Reachable from the sidebar now (shell scope) — no books-library view
// built yet. Books themselves already exist as a data model (design doc
// §3); this is the browsing surface for them, separate from the
// piece-level Library view.
export function BooksPage() {
  return <ComingSoon title="Books" />
}
