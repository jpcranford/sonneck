import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  IconArchive,
  IconArrowLeft,
  IconCalendar,
  IconChevronDownFilled,
  IconCopy,
  IconDownload,
  IconEditFilled,
  IconListDetails,
  IconPlayerPlay,
  IconTrash,
} from '@tabler/icons-react'
import { ContextMenu, type ContextMenuItem } from '../components/ContextMenu'
import { InfoTooltip } from '../components/InfoTooltip'
import { MarkdownText } from '../components/MarkdownText'
import { Modal } from '../components/Modal'
import { CONTENT_MAX_W } from '../lib/layout'
import { ALL_MOCK_SETLISTS } from '../lib/setlistsMockupFixture'
import { formatRelativeWeeks } from '../lib/relativeWeeks'
import { useMockupTitle } from '../lib/useMockupTitle'
import { EditSetlistModal } from './EditSetlistMockup'

// Setlists design pass, Phase 6 — the real Setlist Details page (§13),
// built against the approved Phase 2 layout (Option B, "Stats dashboard")
// and Phase 3 rough-in artifacts, both re-read in full before writing this
// file rather than working from memory of them:
//   https://claude.ai/code/artifact/f719cdf2-84ce-46dc-ad2c-e0e8fb0d0fc0
//   https://claude.ai/code/artifact/f222054f-53be-442a-9a89-173a051c795f
//
// Nested inside the real <AppShell/> (App.tsx's normal AppShell-nested
// mockup block, alongside PieceDetailsSample.tsx/AddToSetlistMockup.tsx) —
// this page's own content needs the real sidebar/topbar around it, unlike
// SidebarSetlistsMockup.tsx, which replaces that shell.
//
// Two deliberate departures from what the Phase 2 artifact's markup still
// shows, both because the plan moved on past that snapshot before this
// phase started:
// - No standalone "Delete setlist" header button — decision 1's own later
//   correction ("further correction, same round") moved whole-setlist
//   deletion into the still-unbuilt Edit Setlist modal (Phase 7), the same
//   place reordering already lives. The artifact's header row still shows
//   one; this file doesn't.
// - The gig date renders as a relative label ("in 3 weeks"), not the
//   artifact's spelled-out "October 4, 2026" — decision 10 explicitly
//   extends the sidebar's own relative-date treatment to this page too
//   ("wherever a gig date is shown there"). The absolute date is kept as a
//   native `title` tooltip on that same row so it's not lost, not shown.
//
// The header date icon is a plain `IconCalendar` (passive display), not a
// repeat of any of the three already-locked calendar icons — `IconCalendarPlus`
// happens to be what the Phase 2 artifact's own date row used, but that
// reads as an accidental copy-paste from its "Add Entries" button rather
// than a real decision (Phase 2 was a layout-only pass; icon choice was
// never that phase's question). Reusing it here for a non-actionable
// display would blur the "three distinct calendar icons, three distinct
// jobs" precedent this feature otherwise holds to.
//
// The Program section originally rendered as a literal <table> at desktop
// widths, with a separate compact-list rendering below `md:` — replaced,
// direct instruction, with ONE unified list (no <table> at any width) after
// a 9-option comparison Artifact ("Program Section Redesigns":
// https://claude.ai/code/artifact/a5dbb57d-995d-4e6c-86c4-9df3efc882f5)
// explored ways to make the section read less like a spreadsheet. Option F
// won — a direct desktop scale-up of the mobile list's own already-shipped
// row shape, chosen specifically so the whole page uses one consistent
// idiom across every width instead of two unrelated ones. The row markup
// below needed no width-dependent changes to work at desktop scale: it's
// already a flex layout that simply has more room to breathe once the
// container is wider, truncating only when content genuinely doesn't fit.
//
// "Duplicate setlist" (header icon button, IconCopy) — direct instruction,
// added after this phase was first marked done. Opens a real modal (Title/
// Gig date, both optional) rather than an InfoTooltip-inert placeholder,
// same posture as Archive: the modal itself is genuinely interactive even
// though there's no backend yet. Unlike Archive, there's no local state for
// it to toggle — this fixture only ever renders the one setlist — so submit
// just closes the modal; real "create the copy and route to its own new
// Setlist Details page" behavior is a build-phase concern. A forward note
// is in the plan to add the same action to the Setlist Library's own
// right-click menu once that page gets mocked up (Phase 12).

// durationSeconds is optional on both entry kinds — Piece.duration is a
// plain, nullable, directly user-entered field (CLAUDE.md's own "Computed
// fields" deviation), not something every piece is guaranteed to have; a
// custom entry's own duration (setlist_entries.custom_duration_seconds) is
// nullable in the schema for the same reason, e.g. a freeform "Welcome &
// Announcements" row someone never bothered timing.
interface SetlistPieceEntry {
  id: string
  kind: 'piece'
  role?: string
  title: string
  composer: string
  keys: string[]
  durationSeconds?: number
  pages: number
}

interface SetlistCustomEntry {
  id: string
  kind: 'custom'
  title: string
  durationSeconds?: number
  note?: string
  countsAsMusic?: boolean
}

type SetlistEntry = SetlistPieceEntry | SetlistCustomEntry

// Seven rows, not the Phase 2 artifact's original six — "Congregational
// Response" is added specifically to demonstrate decision 8's own resolved
// illustration in full: a custom entry with its "Count as music" toggle on
// (from the not-yet-built Edit Setlist modal) takes a real number right
// alongside the pieces around it, not just the common dash case the other
// two custom rows show. Order matches that resolved example exactly.
const INITIAL_ENTRIES: SetlistEntry[] = [
  {
    id: 'e1',
    kind: 'piece',
    role: 'Prelude',
    title: 'Prelude in C Major, BWV 846',
    composer: 'J.S. Bach',
    keys: ['C major'],
    durationSeconds: 150,
    pages: 2,
  },
  {
    id: 'e2',
    kind: 'custom',
    title: 'Welcome & Announcements',
    durationSeconds: 180,
    note: 'Reminder: mention the bake sale sign-up sheet before the offering.',
  },
  {
    id: 'e3',
    kind: 'piece',
    role: 'Processional',
    title: 'Jesu, Joy of Man’s Desiring',
    composer: 'J.S. Bach',
    keys: ['G major', 'D major'],
    durationSeconds: 225,
    pages: 3,
  },
  {
    id: 'e4',
    kind: 'piece',
    role: 'Offertory',
    title: 'Ave Maria',
    composer: 'Franz Schubert',
    keys: ['B♭ major'],
    durationSeconds: 255,
    pages: 4,
  },
  {
    id: 'e5',
    kind: 'piece',
    role: 'Closing Hymn',
    title: 'How Great Thou Art',
    composer: 'Carl Boberg, arr. Stuart K. Hine',
    keys: ['E♭ major', 'F major'],
    durationSeconds: 180,
    pages: 1,
  },
  {
    id: 'e6',
    kind: 'custom',
    title: 'Congregational Response',
    durationSeconds: 120,
    countsAsMusic: true,
  },
  {
    id: 'e7',
    kind: 'custom',
    title: 'Postlude Improvisation',
    durationSeconds: 300,
  },
]

const DESCRIPTION =
  "Our regular Sunday service, followed by a fellowship reception in the parish hall. *Please note*: the organ's swell pedal is still being serviced, so dynamics will lean quieter than usual this week."

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Deliberate deviation from the app's standing p./pp. abbreviation here,
// direct instruction — this Program list spells "page"/"pages" out in full
// rather than abbreviating.
function formatPages(pages: number): string {
  return pages === 1 ? '1 page' : `${pages} pages`
}

function formatAbsoluteDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

// Running count of "counts as music" entries (decision 8) — a piece entry
// always counts, a custom entry only when its own toggle is on. Purely a
// function of the current entry list/order, never a stored field.
function computeDisplayNumbers(entries: SetlistEntry[]): (number | null)[] {
  let n = 0
  return entries.map((entry) => {
    const counts = entry.kind === 'piece' || entry.countsAsMusic
    if (!counts) return null
    n += 1
    return n
  })
}

// Each entry's own right-click menu (decision 11: "Edit Piece"/"Remove from
// Setlist" for a piece entry, "Edit Entry"/"Remove from Setlist" for a
// custom one — no divider either way, matching PieceContextMenu.tsx's own
// real precedent).
function getEntryMenuItems(entry: SetlistEntry, onRemove: (id: string) => void): ContextMenuItem[] {
  return [
    entry.kind === 'piece' ? { label: 'Edit Piece', onSelect: () => {} } : { label: 'Edit Entry', onSelect: () => {} },
    { label: 'Remove from Setlist', destructive: true, onSelect: () => onRemove(entry.id) },
  ]
}

function KeySequence({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((key, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && (
            <span className="font-normal opacity-[0.55]" aria-hidden="true">
              ›
            </span>
          )}
          {/* text-center: at narrow widths a key name can wrap onto two
              lines ("E♭" / "major") — without this the wrapped lines
              default to left-align, so a short top word doesn't sit
              centered over the wider word below it. Same fix as
              PiecePage.tsx's own key-sequence rendering. */}
          <span className="text-center">{key}</span>
        </span>
      ))}
    </span>
  )
}

function HeaderIconButton({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-9 cursor-pointer items-center justify-center rounded-md border border-border bg-paper-raised text-ink-soft hover:border-accent hover:text-ink"
    >
      {icon}
    </button>
  )
}

export function SetlistDetailsMockup() {
  useMockupTitle('Setlist Details')

  const setlist = ALL_MOCK_SETLISTS.find((s) => s.id === '1')!
  const [entries, setEntries] = useState<SetlistEntry[]>(INITIAL_ENTRIES)
  const [archived, setArchived] = useState(false)
  const [archiveModalOpen, setArchiveModalOpen] = useState(false)
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false)
  const [duplicateTitle, setDuplicateTitle] = useState('')
  const [duplicateGigDate, setDuplicateGigDate] = useState('')
  const [editSetlistOpen, setEditSetlistOpen] = useState(false)
  // Which tab EditSetlistModal lands on the next time it opens — 'details'
  // for the "Edit setlist" button/"E" shortcut, 'program' for the Program
  // section's own "Edit Program" button (the full-fold decision: both
  // trigger buttons on this page open the exact same modal instance now,
  // never a separate Edit Program modal). EditSetlistModal's own
  // `initialTab` prop re-syncs to this value on every open, not just once,
  // so the same modal instance correctly lands on a different tab
  // depending on which button was clicked last.
  const [editSetlistTab, setEditSetlistTab] = useState<'details' | 'program'>('details')

  function openEditSetlist(tab: 'details' | 'program') {
    setEditSetlistTab(tab)
    setEditSetlistOpen(true)
  }

  // Download Set PDF's own "+ Annotations" dropdown — same toggle-only
  // state PiecePage.tsx's own `downloadOpen` uses (no outside-click
  // dismiss there either, confirmed by reading that file directly).
  const [downloadOpen, setDownloadOpen] = useState(false)

  const displayNumbers = useMemo(() => computeDisplayNumbers(entries), [entries])
  // Only entries with a known duration contribute — omit the duration
  // segment of the Program list's own sum row below when that leaves
  // nothing to sum, rather than showing a misleadingly confident "0:00".
  const hasAnyDuration = entries.some((e) => e.durationSeconds != null)
  const totalDurationSeconds = entries.reduce((sum, e) => sum + (e.durationSeconds ?? 0), 0)
  const totalPages = entries.reduce((sum, e) => sum + (e.kind === 'piece' ? e.pages : 0), 0)

  function removeEntry(id: string) {
    setEntries((current) => current.filter((e) => e.id !== id))
  }

  // "E" opens Edit Setlist — the same page-level shortcut pattern
  // PiecePage.tsx/BookDetailsPage.tsx/PersonDetailsPage.tsx already use
  // (each a hand-copied `useEffect`+`document.addEventListener`, not a
  // shared hook — matched here rather than introducing one), minus their
  // own `canEdit` permission check, since this fixture has no real
  // permission state to gate against (nothing else on this page is
  // permission-gated either). Same guards otherwise: skip on a held
  // repeat/Ctrl/Meta/Alt, skip while a text-entry element has focus, skip
  // while the modal is already open.
  useEffect(() => {
    if (editSetlistOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return
      }
      if (event.key.toLowerCase() === 'e') {
        event.preventDefault()
        openEditSetlist('details')
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [editSetlistOpen])

  function confirmArchiveToggle() {
    setArchived((a) => !a)
    setArchiveModalOpen(false)
  }

  function openDuplicateModal() {
    setDuplicateTitle('')
    setDuplicateGigDate('')
    setDuplicateModalOpen(true)
  }

  // Fixture-only mockup — there's no second setlist to actually create/
  // navigate to here. Real submit behavior (create the copy, route to its
  // own new Setlist Details page) is a build-phase concern.
  function confirmDuplicate() {
    setDuplicateModalOpen(false)
  }

  // Same real, hard-delete-with-confirm pattern as PiecePage.tsx/
  // BookDetailsPage.tsx's own icon-only Delete button — a native
  // window.confirm(), not a custom Modal, matching this app's standing
  // convention that a genuinely destructive whole-record delete lives on
  // the entity's own Details page (or its library right-click menu), never
  // inside its Edit modal (confirmed by reading PieceContextMenu.tsx/
  // BookContextMenu.tsx directly). A direct correction, this round — the
  // Edit Setlist modal (decision 1) originally put whole-setlist delete in
  // its own footer instead; moved here to actually match the rest of the
  // app. Real delete-then-navigate-back-to-the-Setlist-Library behavior is
  // a build-phase concern — this fixture only ever renders the one
  // setlist, so there's nowhere else to navigate to yet (same posture
  // confirmDuplicate above already takes).
  function handleDelete() {
    window.confirm(`Delete "${setlist.name}"? This can't be undone.`)
  }

  return (
    <div className={`${CONTENT_MAX_W} flex flex-1 flex-col gap-6 px-6 py-6 md:px-8 md:py-8`}>
      <Link to="/mockup" className="inline-flex w-fit items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
        <IconArrowLeft size={20} />
        Setlists
      </Link>

      <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
        Reference sample — <span className="font-medium text-ink">Setlist Details</span> (design doc §13, Phase 6).
        Built against the approved Option B ("Stats dashboard") layout and Phase 3's rough-in decisions. Play Set (moved
        below the description, direct instruction) is inert — its own dependency, the Sheet Viewer's core playback,
        isn't built yet; Download Set PDF, right next to it, is a literal port of PieceDetailsSample.tsx's own
        Download PDF split-button/"+ Annotations" dropdown, relabeled for the whole set. Edit setlist, Edit Program,
        Archive, Duplicate, and Delete are genuinely interactive — Edit setlist and Edit Program both open
        EditSetlistMockup.tsx's own real modal, landed on its "Setlist Details"/"Program Order" tab respectively (the
        full-fold decision — there's no separate Edit Program modal anymore), Edit setlist also reachable via the
        "E" key (same shortcut PiecePage.tsx/BookDetailsPage.tsx/PersonDetailsPage.tsx already use), and Delete
        reuses the identical window.confirm() pattern those two pages' own icon-only Delete buttons already use —
        each row can also be removed via its own right-click menu (no standalone button — too easy to hit by
        accident).
        {archived && (
          <span className="ml-2 rounded-full bg-ink px-2 py-0.5 text-xs font-medium text-paper">Archived</span>
        )}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-medium text-ink">{setlist.name}</h1>
          <div className="mt-1 flex items-center gap-1.5 text-sm text-ink-soft">
            <IconCalendar size={16} />
            {formatAbsoluteDate(setlist.gigDate)}
            <span aria-hidden="true">•</span>
            {formatRelativeWeeks(setlist.gigDate, { abbreviated: false })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Delete setlist, icon-only, leftmost in the group, permanently
              red — same treatment as PiecePage.tsx's/BookDetailsPage.tsx's
              own Delete Piece/Delete Book buttons (size-9 bordered square,
              text-red-700, hover:border-red-700). */}
          <button
            type="button"
            onClick={handleDelete}
            aria-label="Delete setlist"
            title="Delete setlist"
            className="flex size-9 cursor-pointer items-center justify-center rounded-md border border-border bg-paper-raised text-red-700 hover:border-red-700"
          >
            <IconTrash size={18} />
          </button>
          <span aria-hidden="true" className="h-6 w-px bg-border" />
          {/* Real now that Phase 10's EditSetlistModal exists — the "E"
              keyboard shortcut above opens this same modal, landed on its
              "Setlist Details" tab. */}
          <HeaderIconButton
            icon={<IconEditFilled size={16} />}
            label="Edit setlist"
            onClick={() => openEditSetlist('details')}
          />
          <HeaderIconButton icon={<IconCopy size={16} />} label="Duplicate setlist" onClick={openDuplicateModal} />
          <HeaderIconButton
            icon={<IconArchive size={16} />}
            label={archived ? 'Unarchive setlist' : 'Archive setlist'}
            onClick={() => setArchiveModalOpen(true)}
          />
        </div>
      </div>

      {/* Play Set / Download Set PDF — moved out of the name/date header row
          (direct instruction) into their own row directly below the
          description, since they're the set's own primary actions, not
          record-management actions like Edit/Duplicate/Archive/Delete
          above. Play kept its accent-solid treatment and `InfoTooltip`
          "coming soon" posture (same as before, just relabeled "Play Set"
          and moved) — genuinely still blocked on the Sheet Viewer's own
          core playback existing first; direct instruction: it'll play the
          set's pieces one after another once built, with placeholder pages
          standing in for custom entries (which have no real pages of their
          own to show). Download Set PDF is a literal port of
          PieceDetailsSample.tsx's own Download PDF split-button + "+
          Annotations" dropdown (re-read directly before building this,
          not assumed) — same bordered/paper-raised pill, same
          clickable-but-inert main action (this mockup has no real
          concatenation endpoint to link to, matching how the real one has
          no real PDF merge either — nothing in this codebase does), same
          single disabled dropdown item with the identical "Coming with
          annotations (§13)" note, just relabeled for the whole set rather
          than one piece. */}
      <div className="flex flex-wrap items-center gap-2">
        <InfoTooltip
          message="Coming soon — will play through the set's pieces one after another via the future Sheet Viewer, with placeholder pages standing in for custom entries. Built once the Sheet Viewer's own core playback exists."
          ariaLabel="Play Set (coming soon with the Sheet Viewer)"
          showPointerCursor={false}
          triggerClassName="flex items-center gap-2 rounded-md bg-accent px-4 py-2 font-display text-sm text-white opacity-50"
        >
          <IconPlayerPlay size={16} />
          Play Set
        </InfoTooltip>

        <div className="relative">
          <div className="flex overflow-hidden rounded-md border border-border">
            <button
              type="button"
              className="flex cursor-pointer items-center gap-2 bg-paper-raised px-4 py-2 font-display text-sm text-ink hover:bg-accent-soft"
            >
              <IconDownload size={16} />
              Download Set PDF
            </button>
            <button
              type="button"
              onClick={() => setDownloadOpen((o) => !o)}
              aria-label="More download options"
              className="flex cursor-pointer items-center justify-center border-l border-border bg-paper-raised px-2 text-ink hover:bg-accent-soft"
            >
              <IconChevronDownFilled size={16} />
            </button>
          </div>
          {downloadOpen && (
            <div className="absolute top-full left-0 z-10 mt-1 w-64 overflow-hidden rounded-md border border-border bg-paper-raised py-1 text-left shadow-lg">
              <button
                type="button"
                disabled
                className="block w-full cursor-not-allowed px-3 py-2 text-left text-sm text-ink-soft/50"
              >
                Download Set PDF + Annotations
                <span className="block text-xs italic">Coming with annotations (§13)</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Description + summary fields — locked to BookDetailsPage.tsx's own
          top-card treatment (that file's `book.description`/`fields`
          blocks), reused verbatim rather than this page's earlier labeled
          "Description" span: an unlabeled description at max-w-[60ch]
          text-[0.88rem] text-ink-soft, then a flex-wrap dt/dd row of
          all-caps label/value fields, same exact classes. Values here are
          the same Entries/Approx. Duration/Total pages the Program list's
          own sum row (decision 20) already carries — this doesn't touch
          that row, both now show the same totals. Chosen from a live
          2-option switcher (Current vs. this), since deleted. */}
      <div>
        <div className="max-w-[60ch] text-[0.88rem] text-ink-soft">
          <MarkdownText>{DESCRIPTION}</MarkdownText>
        </div>
        <div className="mt-3.5 flex flex-wrap gap-x-8 gap-y-3">
          <div className="min-w-0 break-words">
            <dt className="mb-0.5 text-[0.7rem] tracking-wide text-ink-soft uppercase">Entries</dt>
            <dd className="text-[0.88rem] text-ink">{entries.length}</dd>
          </div>
          {hasAnyDuration && (
            <div className="min-w-0 break-words">
              <dt className="mb-0.5 text-[0.7rem] tracking-wide text-ink-soft uppercase">Approx. Duration</dt>
              <dd className="text-[0.88rem] text-ink">{formatDuration(totalDurationSeconds)}</dd>
            </div>
          )}
          <div className="min-w-0 break-words">
            <dt className="mb-0.5 text-[0.7rem] tracking-wide text-ink-soft uppercase">Total pages</dt>
            <dd className="text-[0.88rem] text-ink">{totalPages}</dd>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-medium text-ink">Program</h3>
        {/* Real now that the full fold (decision 23) is live — opens the
            same EditSetlistModal as the header's own "Edit setlist" button,
            landed on its "Program Order" tab instead of "Setlist Details."
            Relabeled from "Add Entries" (its own name while this depended
            on a still-unbuilt separate Edit Program modal) to "Edit
            Program," matching that tab's own name, since the real action
            now covers reorder/edit/remove too, not just adding — a real
            forward note left in the plan when this was first built as
            inert, now resolved. `IconListDetails`, not `IconCalendarPlus`
            (that icon is reserved for genuinely "add to a setlist" actions
            elsewhere — the grid/list context-menu item, the Setlist
            Library's own bulk add — not this one, which is broader). */}
        <button
          type="button"
          onClick={() => openEditSetlist('program')}
          className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-sm text-ink hover:border-accent"
        >
          <IconListDetails size={16} />
          Edit Program
        </button>
      </div>

      {/* Program list (Option F, "Compact list (mobile-based)") — one
          unified rendering at every width, no <table> anywhere. Role label
          on its own small-caps line above the title, then a title row
          (number, title, duration) and a secondary line for
          composer/key/pages or a custom entry's note. No standalone "counts
          as music" tag — the number itself already implies it. No
          standalone Remove button either — too easy to hit by accident;
          reached via the row's own right-click menu instead. */}
      <div className="flex flex-col">
        {entries.map((entry, i) => {
          const number = displayNumbers[i]
          return (
            <div key={entry.id} className="border-b border-border py-2.5 last:border-none">
              <ContextMenu hideTriggerButton items={getEntryMenuItems(entry, removeEntry)}>
                {/* ml-10 below (×3) must match the number column's own width
                    + gap (w-8 + gap-2 = 2rem + 0.5rem = 2.5rem = ml-10) so
                    the role label/secondary line/note line up with the
                    title itself, not the number. (Was ml-6/w-4 before the
                    number column was widened/enlarged — keep these two in
                    lockstep, a previous mismatch here was a real
                    live-reported bug.) */}
                {entry.kind === 'piece' && entry.role && (
                  <span className="ml-10 block text-[0.65rem] font-medium tracking-wide text-ink-soft uppercase [font-variant:small-caps]">
                    {entry.role}
                  </span>
                )}
                <div className="flex items-baseline gap-2">
                  <span className="w-8 shrink-0 text-center font-sans text-base tabular-nums text-ink-soft">
                    {number ?? '—'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span
                      className={`block break-words ${
                        entry.kind === 'piece'
                          ? 'font-display text-lg font-medium text-ink'
                          : 'font-sans text-base font-normal text-ink-soft italic'
                      }`}
                    >
                      {entry.title}
                    </span>
                  </div>
                  {entry.durationSeconds != null && (
                    <span className="shrink-0 font-mono text-sm tabular-nums text-ink-soft">
                      {formatDuration(entry.durationSeconds)}
                    </span>
                  )}
                </div>
                {entry.kind === 'piece' ? (
                  <div className="ml-10 break-words text-sm text-ink-soft">
                    {entry.composer} <span aria-hidden="true">•</span> <KeySequence keys={entry.keys} />{' '}
                    <span aria-hidden="true">•</span> {formatPages(entry.pages)}
                  </div>
                ) : (
                  entry.note && (
                    <div className="mt-1 ml-10 rounded border border-border bg-paper-sunken px-2 py-1 text-sm leading-snug text-ink-soft">
                      {entry.note}
                    </div>
                  )
                )}
              </ContextMenu>
            </div>
          )
        })}

        {/* Sum row — replaces the earlier standalone Entries/Approx.
            Duration/Total pages stat-card grid (which used to sit above
            this whole section) with a single de-emphasized caption ending
            the Program list itself. Chosen from a 5-option live-switcher
            comparison (nested vs. detached placement, row-mirrored vs.
            centered/uppercase label styling, a tinted-bar treatment) —
            kept nested as this list's own last child (no separating
            border) so it reads as a caption on the list rather than a
            stat card or another row; the previous last entry's own
            `last:border-none` no longer applies since this is now the
            container's real last child, so that row keeps its border and
            doubles as the separator above this caption. Duration is
            omitted entirely (not shown as a misleading "0:00") when no
            entry in the whole list has one set — see hasAnyDuration. */}
        <div className="pt-3 text-center text-xs tracking-wide text-ink-soft uppercase">
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'} <span aria-hidden="true">•</span>{' '}
          {totalPages} {totalPages === 1 ? 'page' : 'pages'}
          {hasAnyDuration && (
            <>
              {' '}
              <span aria-hidden="true">•</span>{' '}
              <span className="font-mono text-xs tracking-normal normal-case tabular-nums">
                {formatDuration(totalDurationSeconds)}
              </span>
            </>
          )}
        </div>
      </div>

      <Modal open={archiveModalOpen} onClose={() => setArchiveModalOpen(false)} labelledBy="archive-setlist-title">
        <div className="flex flex-col gap-4">
          <div>
            <h2 id="archive-setlist-title" className="font-display text-xl font-medium text-ink">
              {archived ? 'Unarchive this setlist?' : 'Archive this setlist?'}
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              {archived
                ? `"${setlist.name}" will move back into your active list.`
                : `"${setlist.name}" will move out of your active list. You can unarchive it any time.`}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setArchiveModalOpen(false)}
              className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmArchiveToggle}
              className="cursor-pointer rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90"
            >
              {archived ? 'Unarchive' : 'Archive'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={duplicateModalOpen} onClose={() => setDuplicateModalOpen(false)} labelledBy="duplicate-setlist-title">
        <div className="flex flex-col gap-4">
          <div>
            <h2 id="duplicate-setlist-title" className="font-display text-xl font-medium text-ink">
              Duplicate this setlist
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              Copies every entry in "{setlist.name}" into a new setlist. Both fields below are optional.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="duplicate-title" className="text-sm text-ink-soft">
              Title
            </label>
            <input
              id="duplicate-title"
              type="text"
              value={duplicateTitle}
              onChange={(event) => setDuplicateTitle(event.target.value)}
              placeholder={`${setlist.name} (Copy)`}
              className="rounded-md border border-border bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="duplicate-gig-date" className="text-sm text-ink-soft">
              Gig date
            </label>
            <input
              id="duplicate-gig-date"
              type="date"
              value={duplicateGigDate}
              onChange={(event) => setDuplicateGigDate(event.target.value)}
              className="rounded-md border border-border bg-paper px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
            />
            <span className="text-xs text-ink-soft">Leave blank to duplicate without a gig date.</span>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDuplicateModalOpen(false)}
              className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDuplicate}
              className="cursor-pointer rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90"
            >
              Duplicate
            </button>
          </div>
        </div>
      </Modal>

      {/* EditSetlistMockup.tsx's own exported modal, reused directly rather
          than re-implemented here (same "exported for reuse" precedent as
          AddToSetlistPicker/EditProgramModal) — this page's own name/gig
          date/description fields are already that modal's "Setlist
          Details" tab. onSave is a no-op close, same posture as this
          page's own Duplicate confirm: real save-and-reflect-on-this-page
          behavior is a build-phase concern, not this fixture's. */}
      <EditSetlistModal
        open={editSetlistOpen}
        onClose={() => setEditSetlistOpen(false)}
        mode="edit"
        initialTab={editSetlistTab}
        initialName={setlist.name}
        initialGigDate={setlist.gigDate}
        initialDescription={DESCRIPTION}
        onSave={() => {}}
      />
    </div>
  )
}
