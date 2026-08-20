import { Link } from 'react-router-dom'
import { useMockupTitle } from '../lib/useMockupTitle'

// Quick and dirty — just a way to find the mockups without memorizing URLs.
// Add a row here whenever a new one gets built. These pages are kept around
// on purpose (design references, future experimentation), not deleted once
// whatever they were mocking gets built for real.
const MOCKUPS = [
  {
    to: '/mockup/piece-view',
    name: 'Piece View',
    note: 'Reference sample for the Piece View (§14) — kept as a standing design reference.',
  },
  {
    to: '/mockup/edit-piece-modal',
    name: 'Edit Piece Modal',
    note: 'Piece Properties Edit Menu (§15) design mockup.',
  },
  {
    to: '/mockup/books-library',
    name: 'Books Library',
    note: 'Books library grid/list view design mockup.',
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
              <p className="font-display text-ink">{m.name}</p>
              <p className="text-sm text-ink-soft">{m.note}</p>
              <p className="text-xs text-ink-soft/60">{m.to}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
