import { Link } from 'react-router-dom'
import { WIDE_CONTENT_MAX_W } from '../lib/layout'
import { useMockupTitle } from '../lib/useMockupTitle'

// Quick and dirty — just a way to find the mockups without memorizing URLs.
// Add a row to the fitting section whenever a new one gets built. These pages are kept around
// on purpose (design references, future experimentation), not deleted once
// whatever they were mocking gets built for real.
interface Mockup {
  to: string
  name: string
  /** What the page shows and what to try on it: at most 50 words. */
  note: string
  /** What's open for testing on it, each item at most 20 words, shown as a
   * bulleted list under a bold "Currently testing:" (not counted in the note's 50).
   * Remove an item once it no longer needs testing, and the field with the
   * last one. */
  testing?: string[]
}

const SECTIONS: { title: string; mockups: Mockup[] }[] = [
  {
    title: 'App Styling',
    mockups: [
      {
        to: '/mockup/style-sampler',
        name: 'Style Sampler',
        note: "The app's visual style at a glance: every color token and where it's used, hard-coded colors, an example window, every type size and weight in use, and every button and field style. Read live from index.css and the source, so it never needs updating.",
      },
      {
        to: '/mockup/states',
        name: 'Empty, Error & Loading States',
        note: 'Every empty, error and loading state in the app on one page, with Empty / Error / Loading and Light / Dark switches. Each is a hand-kept copy of the real markup, labeled with where the real one lives.',
      },
      {
        to: '/mockup/shortcut-help',
        name: 'Shortcut Help',
        note: "Hold / or ? for about a second to see a corner card of the page's keyboard shortcuts; let go to hide it. Pick a page and the viewer's permissions: keys they can't use are left off.",
      },
      {
        to: '/mockup/mobile-nav-drawer',
        name: 'Mobile Nav — Left Drawer',
        note: 'Replaces the sidebar’s permanent mobile icon rail with a top bar + slide-in drawer below 768px. Not nested in AppShell — renders the real Sidebar for desktop, a new top bar + drawer for mobile.',
      },
      {
        to: '/mockup/sidebar-user-menu',
        name: 'Sidebar User Menu',
        note: 'Multi-user support — replaces the static "Local Library" footer pill (desktop rail + mobile drawer) with a real account menu ("Identity card, dark popup" style). Switch identity state (None/Password/OIDC Admin/OIDC Member), collapse the rail, or open the mobile drawer to see the menu adapt.',
      },
      {
        to: '/mockup/sidebar-setlists',
        name: 'Sidebar Setlists',
        note: 'The sidebar with its Upcoming Sets list (sample setlists, soonest first) and ⋯ menu, plus the Practice List entry above Want to Learn, which opens the Sheet Viewer. Try collapsing the rail, the phone drawer and the content corner sizes.',
      },
      {
        to: '/mockup/device-info',
        name: 'Device Info',
        note: 'Not a screen mockup — a live diagnostic reference (window/screen size, orientation, devicePixelRatio, current Tailwind breakpoint tier, active nav mode) for the responsive-layout pass across phone/tablet/ultrawide/e-ink widths.',
      },
    ],
  },
  {
    title: 'Libraries',
    mockups: [
      {
        to: '/mockup/piece-library',
        name: 'Piece Library — Sort/Filter',
        note: 'Filter Drawer (Option B of a 4-option comparison) added to the Piece Library toolbar — Filters button + slide-in drawer (Key/Instrument/Sheet Type/Tags/Status/Favorite), plus a new Sort control. Genuinely interactive against 10 fixture pieces.',
      },
      {
        to: '/mockup/books-library',
        name: 'Books Library — Sort/Filter',
        note: 'Grid/list match the real BookGridCard/BookListCard exactly, plus the same Filter Drawer + Sort control added to the Piece Library, adjusted for Books’ lighter facets (Sheet Type/Instrument only). Genuinely interactive against 8 fixture books.',
      },
      {
        to: '/mockup/people-library',
        name: 'People Library',
        note: 'Composer/arranger overhaul — real toolbar/grid/list/Filter Drawer shell (same system as Piece/Books Library) with the oval Person card and the "Show all composers" default (>2-piece) filter. Genuinely interactive against 17 fixture people.',
      },
      {
        to: '/mockup/setlists-library',
        name: 'Setlists Library',
        note: "The Setlists page: Active and Archived sections of compact cards. Each card's right-click menu works: Archive or Unarchive with a confirmation, Duplicate, Edit Setlist and Delete. New Setlist and Edit Setlist open the real Edit Setlist window.",
      },
      {
        to: '/mockup/add-to-setlist',
        name: 'Add to Setlist',
        note: "A Library card's right-click or long-press menu: the practice status strip at the top, Add to Setlist with its setlist picker, and Add to or Remove from Practice List.",
      },
    ],
  },
  {
    title: 'Details Pages',
    mockups: [
      {
        to: '/mockup/piece-details',
        name: 'Piece Details',
        note: 'Reference sample for the Piece Details page (§14) — kept as a standing design reference. Play opens the Sheet Viewer mockup; its caret adds the piece to (or removes it from) the Practice List.',
        testing: [
          'On a phone or tablet, the top toolbar and the Play / Download row are easy to tap.',
          "In Chrome's full screen, Esc closes an open window first, and only then leaves full screen.",
        ],
      },
      {
        to: '/mockup/edit-piece-modal',
        name: 'Edit Piece Modal',
        note: 'Piece Properties Edit Menu (§15) design mockup.',
      },
      {
        to: '/mockup/citation-logic',
        name: 'Citation Logic',
        note: 'Not a screen mockup — a decision-flow reference for buildCitation (internal/handlers/citation.go), kept in sync under the same mockup-parity rule whenever the real branching logic changes. Every example citation is copied verbatim from a passing citation_test.go case.',
      },
      {
        to: '/mockup/book-details',
        name: 'Book Details',
        note: 'Book Details page (header card + pieces grid/list) design mockup.',
        testing: ["On a phone or tablet, the top toolbar's buttons and Back are easy to tap."],
      },
      {
        to: '/mockup/edit-book-modal',
        name: 'Edit Book Modal',
        note: 'Book Properties Edit Menu (§16) design mockup, incl. the animated Save-progress button.',
      },
      {
        to: '/mockup/person-details',
        name: 'Person Details',
        note: "A person's page, for one sample composer: the header with portrait (upload, or search Wikipedia, then crop), bio and book credits, a grid or list of works, and the Split People window.",
        testing: ["On a phone or tablet, the top toolbar's buttons and Back are easy to tap."],
      },
      {
        to: '/mockup/edit-person-modal',
        name: 'Edit Person Modal',
        note: "Composer/arranger overhaul — Name/Biography/Birth year/Death year, deliberately minimal (no portrait field — that stays on the camera badge). Wikipedia autofill button mimics the real ImslpAutofillButton's states/behavior via a mock lookup.",
      },
      {
        to: '/mockup/setlist-details',
        name: 'Setlist Details',
        note: "The Setlist Details page: gig date, roles, custom entries (one with a note, one counted as music), each row's right-click menu and the Archive confirmation. Play Set opens the Sheet Viewer mockup on the set; its caret adds every piece to the Practice List.",
        testing: [
          'On a phone or tablet, the toolbar, the Play Set and Download row, and Edit Program are easy to tap.',
        ],
      },
      {
        to: '/mockup/edit-setlist',
        name: 'Edit Setlist',
        note: 'The Edit Setlist window: a Setlist Details tab (name, gig date, description) and a Program Order tab (add pieces or custom entries, drag to reorder, edit in place). Buttons open its New Setlist state or land on the Program tab. Nothing is saved until Save Setlist.',
      },
      {
        to: '/mockup/edit-entry',
        name: 'Edit Entry',
        note: "The window for one custom setlist entry (name, duration, Count as music, notes), opened from its right-click Edit Entry on Setlist Details. Edit Setlist's Program tab edits the same fields in place.",
      },
      {
        to: '/mockup/setlist-program-page',
        name: 'Download Set PDF',
        note: "The Set PDF's generated pages in order: Cover, Table of Contents, the stand-in page for a custom entry, and Colophon, drawn in real points. Switches for the previewed entry and the page size (Letter or A4) exist only here.",
      },
    ],
  },
  {
    title: 'Sheet Viewer',
    mockups: [
      {
        to: '/mockup/sheet-viewer',
        name: 'Sheet Viewer',
        note: 'The full-screen practice and performance mode on pages from a piece you pick: toolbar, tap zones and keys, clock, metronome, Info, Practice Notes, Display (two or more pages on bigger screens), the Practice List and Annotate. The Mockup panel sets where it opened from, the theme and a page-turn timer.',
        testing: [
          'The metronome (A5): sound and timing on the iPad, tap tempo, Shift+M, the swinging icon, Toolbar shows, and subdivisions with their dots.',
          'More pages in the real viewer on the iPad: spreads, sliding, links, Display, V, and the User Settings defaults.',
          'Turn speed in real practice on the iPad: report any slow turns, so the temporary turn-timing code can come out.',
          "In Chrome's full screen, Esc closes a panel, then arms Exit; F leaves full screen.",
          'Practice Notes: tap your notes to edit them; a link inside them still opens.',
          "Practice Notes' banner switch shows or hides the banner behind the open panel.",
        ],
      },
    ],
  },
  {
    title: 'Upload Flows',
    mockups: [
      {
        to: '/mockup/drop-to-upload',
        name: 'Drop to Upload',
        note: 'Drag-and-drop upload anywhere in the app (§13), design B: a "Drop to upload" overlay, then "Is this a piece or a book?" with the Upload page’s own cards. Refuses multiple files, non-PDFs, a second book while a draft exists, and viewers without upload. Drag a real PDF over the page.',
      },
      {
        to: '/mockup/upload-piece-about',
        name: 'Upload Piece — About This Piece',
        note: 'Single-piece Upload flow\'s "details" step — Title/Composer/Arranger/Year Written/IMSLP No. always visible, the rest behind "More details" and "From a book?". The IMSLP number from the filename autofills blank fields shortly after the screen appears, as the book upload does.',
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
    ],
  },
  {
    title: 'Admin & Settings',
    mockups: [
      {
        to: '/mockup/user-settings',
        name: 'User Settings',
        note: 'User Settings as cards: Account (name, identity, Change Password), Appearance, Library, Sheet Viewer, Your Tags and Practice Status (create, rename, delete with a merge). Switch the identity to see the Account card change.',
      },
      {
        to: '/mockup/admin-settings',
        name: 'Admin Settings',
        note: 'One scrolling page of cards: Library Settings (fields an environment variable can lock), library counts, Version, Users (permission grid, last admin locked, delete with a confirmation) and Lookup Tables (rename, add, delete with a merge). Switch the identity to change the user list.',
      },
      {
        to: '/mockup/first-launch',
        name: 'First-Time Launch Flow',
        note: 'Multi-user support — Welcome → Library Folder → Security, with a "Preview as Docker/Native" toggle since OIDC and the folder picker both branch on runtime mode. Fixture/preview state only, no real API calls (the real flow is FirstLaunchFlow.tsx).',
      },
      {
        to: '/mockup/auth-change-flow',
        name: 'Auth Change Flow',
        note: 'The start-up flow when the sign-in method (AUTH_METHOD) has changed since the last run. Switch "Simulate detected change" for each case: an OIDC upgrade, a new password needed, a single-account downgrade, and a multi-account downgrade (choose the surviving admin, confirm the deletions).',
      },
      {
        to: '/mockup/login-screen',
        name: 'Login Screen',
        note: 'The sign-in screen for password and OIDC installs, and where a finished Auth Change Flow lands. Switch the preview to see the password and OIDC versions, each with and without an error.',
      },
    ],
  },
]

export function MockupIndexPage() {
  useMockupTitle('Mockup Index')

  return (
    <div className={`flex flex-1 flex-col gap-6 p-6 md:p-8 ${WIDE_CONTENT_MAX_W}`}>
      <div>
        <h1 className="font-display text-xl font-medium text-ink">Mockups</h1>
        <p className="text-sm text-ink-soft">
          Design mockups and reference samples, unlinked from the main nav. Not every page has a
          mockup; they're mostly to avoid breaking the main ones while I experiment with
          "improvements."
        </p>
      </div>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        {SECTIONS.map((section) => (
          <section key={section.title} className="flex flex-col gap-2">
            <h2 className="font-display text-lg font-medium text-ink">{section.title}</h2>
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-paper-raised">
              {section.mockups.map((m) => (
                <li key={m.to}>
                  <Link to={m.to} className="block px-4 py-3 hover:bg-paper">
                    <p className="font-display font-medium text-ink">{m.name}</p>
                    <p className="text-sm text-ink-soft">{m.note}</p>
                    {m.testing && m.testing.length > 0 && (
                      <div className="mt-1 text-sm text-ink-soft">
                        <p className="font-bold text-ink">Currently testing:</p>
                        <ul className="list-disc pl-5">
                          {m.testing.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="text-xs text-ink-soft/60">{m.to}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
