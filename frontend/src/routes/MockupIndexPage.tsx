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
    to: '/mockup/people-library',
    name: 'People Library',
    note: 'Composer/arranger overhaul, Phase 3 of 6 — real toolbar/grid/list/Filter Drawer shell (same system as Piece/Books Library) with the locked oval Person card and the "Show all composers" default (>2-piece) filter. Genuinely interactive against 17 fixture people.',
  },
  {
    to: '/mockup/person-details',
    name: 'Person Details',
    note: 'Composer/arranger overhaul, Phase 4 of 6 — header card (oval portrait + camera-badge Upload Portrait flow with device/Wikipedia search + drag/zoom adjust, bio, direct book-credit chips) and a works grid/list mirroring Book Details’ own PieceList, plus a Split People modal reusing the real TagComboBox as its ordered replacement picker. Genuinely interactive against one fixture person (Chopin).',
  },
  {
    to: '/mockup/edit-person-modal',
    name: 'Edit Person Modal',
    note: 'Composer/arranger overhaul, Phase 5 of 6 — Name/Biography/Birth year/Death year, deliberately minimal (no portrait field — that stays on the camera badge, Phase 4). Wikipedia autofill button mimics the real ImslpAutofillButton\'s states/behavior via a mock lookup.',
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
    to: '/mockup/upload-piece-about',
    name: 'Upload Piece — About This Piece',
    note: 'Single-piece Upload flow\'s "details" step redesign — Option B ("Essentials + More Details") of a 3-way comparison: Title/Composer/Arranger/Key(s)/Sheet Type always visible, everything else (opus, year, publisher, IMSLP, instruments, description) and the source-book link behind two collapsible sections using the same trigger pattern as EditPieceModal.tsx\'s own Copyright/Book Details.',
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
  {
    to: '/mockup/citation-logic',
    name: 'Citation Logic',
    note: 'Not a screen mockup — a decision-flow reference for buildCitation (internal/handlers/citation.go), kept in sync under the same mockup-parity rule whenever the real branching logic changes. Every example citation is copied verbatim from a passing citation_test.go case.',
  },
  {
    to: '/mockup/device-info',
    name: 'Device Info',
    note: 'Not a screen mockup — a live diagnostic reference (window/screen size, orientation, devicePixelRatio, current Tailwind breakpoint tier, active nav mode) for the responsive-layout pass across phone/tablet/ultrawide/e-ink widths. See memory project_responsive_device_plan.',
  },
  {
    to: '/mockup/first-launch',
    name: 'First-Time Launch Flow',
    note: 'Multi-user support, Phase 2 of the plan (memory project_multiuser_build.md) — Welcome → Library Folder → Security, with a "Preview as Docker/Native" toggle since OIDC and the folder picker both branch on runtime mode. Genuinely interactive against local state; no real backend exists for this yet.',
  },
  {
    to: '/mockup/sidebar-user-menu',
    name: 'Sidebar User Menu',
    note: 'Multi-user support, Phase 7 of the plan — replaces the static "Local Library" footer pill (desktop rail + mobile drawer) with a real account menu, the approved Option 2 ("Identity card, dark popup") from the Phase 4 artifact. Switch identity state (None/Password/OIDC Admin/OIDC Member), collapse the rail, or open the mobile drawer to see the menu adapt.',
  },
  {
    to: '/mockup/user-settings',
    name: 'User Settings',
    note: 'Multi-user support, Phase 8 of the plan — the approved Option 2 ("separate cards per section") from the Phase 5 artifact: Account (display name, identity line, Change Password), Appearance (Theme, Dark disabled/"Soon"), Library (Hide Books in sidebar, Paginated views), Your Tags and Practice Status (per-user create/delete/merge, same pattern as Admin Settings\' Lookup Tables). Switch identity state to see the Account card adapt.',
  },
  {
    to: '/mockup/admin-settings',
    name: 'Admin Settings',
    note: 'Multi-user support, Phase 9 of the plan — the approved Option B ("single scrolling page, jump-nav") from the Phase 6 artifact, each section switched to its own bordered card to match User Settings\' Option 2 look (same max-width too): Library Settings (every field independently env-var-shadowed; Security is now read-only, env-var-only, no in-app change control — see the Auth Change Flow mockup for how a change gets handled instead), Library counts, Version (identifies the build by commit SHA against GitHub release/pre-release tags, falling back to "Dev build, from commit <SHA> on <date>"), Users (expandable permission grid with a hover/tap description per permission, last-admin lock, per-row delete with a window.confirm() gate), Lookup Tables (inline-editable Sheet Types/Instruments with usage instructions, a "+" to create a new entry, and a per-row delete that opens a real modal to merge into another entry or delete outright). Switch identity state to see the user list change.',
  },
  {
    to: '/mockup/auth-change-flow',
    name: 'Auth Change Flow',
    note: 'Multi-user support, Phase 16 of the plan — a boot-time gate that replaces Admin Settings\' removed in-app Security-change capability: the app detects its AUTH_METHOD no longer matches what it last ran under and walks the admin through the adjustment, mirroring the first-launch flow\'s own full-page-takeover weight. Reuses the choose-surviving-admin/confirm-delete content Admin Settings briefly held before it was pulled out. Switch the "Simulate detected change" scenario to preview every content path: an OIDC upgrade (informational only), a new-password requirement, a light single-account downgrade, and the full destructive multi-account downgrade.',
  },
  {
    to: '/mockup/login-screen',
    name: 'Login Screen',
    note: 'Multi-user support — the boot-time login wall for singlepass/OIDC installs, built after the fact (no mockup existed when the real page was first built). Added so the Auth Change Flow mockup has something real to preview as the hand-off screen a completed transition lands on. Switch preview state to see the password and OIDC branches, each with and without an error.',
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
