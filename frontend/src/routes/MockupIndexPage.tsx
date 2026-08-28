import { Link } from 'react-router-dom'
import { useMockupTitle } from '../lib/useMockupTitle'

// Quick and dirty — just a way to find the mockups without memorizing URLs.
// Add a row here whenever a new one gets built. These pages are kept around
// on purpose (design references, future experimentation), not deleted once
// whatever they were mocking gets built for real.
const MOCKUPS = [
  {
    to: '/mockup/piece-details',
    name: 'Piece Details',
    note: 'Reference sample for the Piece Details page (§14) — kept as a standing design reference.',
  },
  {
    to: '/mockup/edit-piece-modal',
    name: 'Edit Piece Modal',
    note: 'Piece Properties Edit Menu (§15) design mockup.',
  },
  {
    to: '/mockup/piece-library',
    name: 'Piece Library — Sort/Filter',
    note: 'Filter Drawer (Option B of a 4-option comparison, picked 2026-08-27) added to the Piece Library toolbar — Filters button + slide-in drawer (Key/Instrument/Sheet Type/Tags/Status/Favorite), plus a new Sort control. Genuinely interactive against 10 fixture pieces.',
  },
  {
    to: '/mockup/books-library',
    name: 'Books Library — Sort/Filter',
    note: 'Grid/list match the real BookGridCard/BookListCard exactly, plus the same Filter Drawer + Sort control added to the Piece Library, adjusted for Books’ lighter facets (Sheet Type/Instrument only). Genuinely interactive against 8 fixture books.',
  },
  {
    to: '/mockup/book-details',
    name: 'Book Details',
    note: 'Book Details page (header card + pieces grid/list) design mockup.',
  },
  {
    to: '/mockup/edit-book-modal',
    name: 'Edit Book Modal',
    note: 'Book Properties Edit Menu (§16) design mockup, incl. the animated Save-progress button.',
  },
  {
    to: '/mockup/upload-book-about',
    name: 'Upload — About This Book',
    note: 'Book Upload Wizard (§5), screen 3 of 6 — book-metadata entry with the sticky cover column, plus a printed-vs-PDF page number offset field under the cover cycler.',
  },
  {
    to: '/mockup/upload-book-split',
    name: 'Upload — Split the Book',
    note: 'Book Upload Wizard (§5), screen 4 of 6 — interactive page grid, tap to mark/skip/share, drag to range-select.',
  },
  {
    to: '/mockup/upload-book-titles',
    name: 'Upload — Name Each Piece',
    note: 'Book Upload Wizard (§5), screen 5 of 6 — Title/Composer table with live validation and a page preview overlay.',
  },
  {
    to: '/mockup/upload-book-confirm',
    name: 'Upload — Ready to Import',
    note: 'Book Upload Wizard (§5), screen 6 of 6 — read-only review, real stripe-animation import, and the success screen.',
  },
  {
    to: '/mockup/mobile-nav-drawer',
    name: 'Mobile Nav — Left Drawer',
    note: 'Replaces the sidebar’s permanent mobile icon rail with a top bar + slide-in drawer below 768px. Not nested in AppShell — renders the real Sidebar for desktop, a new top bar + drawer for mobile.',
  },
]

export function MockupIndexPage() {
  useMockupTitle('Mockup Index')

  return (
    <div className="flex flex-1 flex-col gap-4 p-6 md:p-8">
      <div>
        <h1 className="font-display text-xl font-medium text-ink">Mockups</h1>
        <p className="text-sm text-ink-soft">
          Design mockups and reference samples, unlinked from the main nav. Not every page has a mockup; they're mostly to avoid breaking the main ones while I experiment with "improvements."
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-paper-raised">
        {MOCKUPS.map((m) => (
          <li key={m.to}>
            <Link to={m.to} className="block px-4 py-3 hover:bg-paper">
              <p className="font-display font-medium text-ink">{m.name}</p>
              <p className="text-sm text-ink-soft">{m.note}</p>
              <p className="text-xs text-ink-soft/60">{m.to}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
