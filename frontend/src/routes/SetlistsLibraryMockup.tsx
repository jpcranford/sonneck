import { useState } from 'react'
import { Link } from 'react-router-dom'
import { IconArrowLeft, IconPlus } from '@tabler/icons-react'
import { ClickableCard } from '../components/ClickableCard'
import { ContextMenu, type ContextMenuItem } from '../components/ContextMenu'
import { Modal } from '../components/Modal'
import { CONTENT_MAX_W } from '../lib/layout'
import { formatRelativeWeeks } from '../lib/relativeWeeks'
import { ALL_MOCK_SETLISTS, isEffectivelyArchived, type MockSetlist } from '../lib/setlistsMockupFixture'
import { useMockupTitle } from '../lib/useMockupTitle'
import { EditSetlistModal } from './EditSetlistMockup'

// Setlists design pass, Phase 12 — the setlists browse page (§13), built
// against Phase 4's approved artifact: Option C, one unified `/setlists`
// route with "Active"/"Archived" as two headed sections reached purely by
// scrolling, no toggle and no separate route (decision 12).
//
// Named "Setlists Library" (file/route/component, was "Setlist Archive"),
// not "Archive" — direct correction: this page is not solely an archive,
// it's the general browse-everything-you-have surface (Active is most of
// it), matching this app's own established "[Thing] Library" naming for a
// browse-all-records page (Piece/Books/People Library) — and the exact
// name already anticipated for the eventual real page, Phase 15's own
// `SetlistsLibraryPage.tsx`.
//
// A real correction against the Phase 4 artifact itself, caught on review
// (https://claude.ai/artifact/QoFEcqEqDY6Q2qKnfCzAbs): Option C's own
// cards are a **compact grid** (`grid-template-columns: repeat(auto-fill,
// minmax(210px, 1fr))`), not the horizontal list rows this file first
// shipped with — fixed below to match. Two further details pulled directly
// from that same artifact rather than re-derived from the decision text
// alone: an upcoming setlist's date row shows *both* the absolute and
// relative date together ("October 4, 2026 • in 3 weeks" — matching
// SetlistDetailsMockup.tsx's own header, which already does this), a
// past-dated one shows the bare absolute date alone (no "N weeks ago" —
// the artifact's own two archived examples do this); and *every* card in
// the Archived section carries the "Archived" badge unconditionally, not
// only the manually-archived-while-still-upcoming case this file
// originally special-cased it for.
//
// Nested inside the real <AppShell/>, same convention as
// SetlistDetailsMockup.tsx/PieceDetailsSample.tsx/AddToSetlistMockup.tsx.
//
// The shared ALL_MOCK_SETLISTS fixture (lib/setlistsMockupFixture.ts)
// gained real fields for this page specifically — entryCount/
// totalDurationSeconds/totalPages, and the explicit `archived` flag
// (decision 3's manual half) — plus a 9th entry with no gigDate at all
// (CLAUDE.md's own "verify empty states" standing rule: a setlist can
// exist with nothing scheduled yet, a real nullable case, not a corner
// case to special-case away). Copied into local state on mount so
// Archive/Unarchive and Delete below can genuinely mutate it — unlike
// Setlist Details' own Duplicate/Delete confirms (both no-ops there, since
// a single-setlist detail page has nowhere to visibly reflect the result),
// this page IS a list, so a real toggle/removal has an obvious effect to
// demonstrate.

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Full month name, matching SetlistDetailsMockup.tsx's own header exactly
// (not the Phase 4 artifact's own abbreviated "Oct 4, 2026" sketch) — this
// feature's own real precedent, once one exists, wins over an earlier
// comparison artifact's rougher styling.
function formatAbsoluteDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

type ArchiveDirection = 'archive' | 'unarchive' | null

// Whether Archive/Unarchive is even a meaningful action for this setlist —
// a setlist archived purely because its gigDate already passed has nothing
// for the toggle to undo (the event already happened); only a still-
// upcoming setlist (active, or manually archived ahead of its own date)
// gets the action offered at all. Mirrors decision 14's confirm-gated
// mechanism (a real Modal, not an instant toggle) for consistency with
// Setlist Details' own Archive/Unarchive action. Also doubles as "is this
// setlist upcoming" for the date row below — a relative date only renders
// alongside the absolute one when there's still something to be relative
// *to*.
function archiveDirectionFor(setlist: MockSetlist): ArchiveDirection {
  const upcoming = !setlist.gigDate || new Date(setlist.gigDate).getTime() >= Date.now()
  if (!upcoming) return null
  return setlist.archived ? 'unarchive' : 'archive'
}

function SetlistCard({
  setlist,
  onArchiveToggle,
  onDuplicate,
  onEdit,
  onDelete,
}: {
  setlist: MockSetlist
  onArchiveToggle: (setlist: MockSetlist) => void
  onDuplicate: (setlist: MockSetlist) => void
  onEdit: (setlist: MockSetlist) => void
  onDelete: (setlist: MockSetlist) => void
}) {
  const effectivelyArchived = isEffectivelyArchived(setlist)
  const direction = archiveDirectionFor(setlist)
  const isUpcoming = direction !== null

  const items: ContextMenuItem[] = []
  if (direction) {
    items.push({
      label: direction === 'archive' ? 'Archive' : 'Unarchive',
      onSelect: () => onArchiveToggle(setlist),
    })
  }
  items.push(
    { label: 'Edit Setlist', onSelect: () => onEdit(setlist) },
    { label: 'Duplicate', onSelect: () => onDuplicate(setlist) },
    { label: 'Delete Setlist', destructive: true, onSelect: () => onDelete(setlist) },
  )

  return (
    <ContextMenu hideTriggerButton items={items}>
      <ClickableCard
        to="/mockup/setlist-details"
        className={`flex flex-col rounded-lg border border-border bg-paper-raised p-4 text-left hover:border-accent ${
          effectivelyArchived ? 'opacity-70' : ''
        }`}
      >
        <span className="font-display text-base font-medium text-ink">{setlist.name}</span>
        <span className="mt-1 text-xs text-ink-soft">
          {setlist.gigDate ? (
            <>
              {formatAbsoluteDate(setlist.gigDate)}
              {isUpcoming && (
                <>
                  {' '}
                  <span aria-hidden="true">•</span> {formatRelativeWeeks(setlist.gigDate, { abbreviated: false })}
                </>
              )}
            </>
          ) : (
            <span className="italic">No gig date set</span>
          )}
        </span>
        <span className="mt-2 text-xs tracking-wide text-ink-soft uppercase">
          {setlist.entryCount} {setlist.entryCount === 1 ? 'entry' : 'entries'} <span aria-hidden="true">•</span>{' '}
          {setlist.totalPages} {setlist.totalPages === 1 ? 'page' : 'pages'}
          {setlist.totalDurationSeconds != null && (
            <>
              {' '}
              <span aria-hidden="true">•</span>{' '}
              <span className="font-mono text-xs tracking-normal normal-case tabular-nums">
                {formatDuration(setlist.totalDurationSeconds)}
              </span>
            </>
          )}
        </span>
        {effectivelyArchived && (
          <span className="mt-2 w-fit rounded bg-paper-sunken px-1.5 py-0.5 text-[0.6rem] font-semibold tracking-wide text-ink-soft uppercase">
            Archived
          </span>
        )}
      </ClickableCard>
    </ContextMenu>
  )
}

// Matches the Phase 4 artifact's own `.setlist-grid` exactly: a compact
// grid, not a list — `repeat(auto-fill, minmax(210px, 1fr))` so cards
// shrink to fit a narrow container down to one column, and multiply out to
// however many fit at 210px+ each, rather than a fixed column count.
function SetlistGrid({
  setlists,
  onArchiveToggle,
  onDuplicate,
  onEdit,
  onDelete,
}: {
  setlists: MockSetlist[]
  onArchiveToggle: (setlist: MockSetlist) => void
  onDuplicate: (setlist: MockSetlist) => void
  onEdit: (setlist: MockSetlist) => void
  onDelete: (setlist: MockSetlist) => void
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
      {setlists.map((setlist) => (
        <SetlistCard
          key={setlist.id}
          setlist={setlist}
          onArchiveToggle={onArchiveToggle}
          onDuplicate={onDuplicate}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  )
}

export function SetlistsLibraryMockup() {
  useMockupTitle('Setlists Library')

  const [setlists, setSetlists] = useState<MockSetlist[]>(ALL_MOCK_SETLISTS)
  const [archiveTarget, setArchiveTarget] = useState<MockSetlist | null>(null)
  const [duplicateTarget, setDuplicateTarget] = useState<MockSetlist | null>(null)
  const [duplicateTitle, setDuplicateTitle] = useState('')
  const [duplicateGigDate, setDuplicateGigDate] = useState('')
  const [editTarget, setEditTarget] = useState<MockSetlist | null>(null)
  const [newSetlistOpen, setNewSetlistOpen] = useState(false)

  const active = setlists.filter((s) => !isEffectivelyArchived(s))
  const archived = setlists.filter((s) => isEffectivelyArchived(s))

  function openArchiveModal(setlist: MockSetlist) {
    setArchiveTarget(setlist)
  }

  function confirmArchiveToggle() {
    if (!archiveTarget) return
    const id = archiveTarget.id
    setSetlists((current) => current.map((s) => (s.id === id ? { ...s, archived: !s.archived } : s)))
    setArchiveTarget(null)
  }

  function openDuplicateModal(setlist: MockSetlist) {
    setDuplicateTarget(setlist)
    setDuplicateTitle('')
    setDuplicateGigDate('')
  }

  // Fixture-only mockup, same posture as Setlist Details' own Duplicate
  // confirm — there's no second setlist to actually create here. Real
  // "create the copy, route to its own new Setlist Details page" behavior
  // is a build-phase concern.
  function confirmDuplicate() {
    setDuplicateTarget(null)
  }

  function confirmDelete(setlist: MockSetlist) {
    if (!window.confirm(`Delete "${setlist.name}"? This can't be undone.`)) return
    setSetlists((current) => current.filter((s) => s.id !== setlist.id))
  }

  const archiveDirection = archiveTarget ? archiveDirectionFor(archiveTarget) : null

  return (
    <div className={`flex flex-1 flex-col gap-6 p-6 md:p-8 ${CONTENT_MAX_W}`}>
      <Link to="/mockup" className="inline-flex w-fit items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
        <IconArrowLeft size={20} />
        Setlists
      </Link>

      <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
        Reference sample — <span className="font-medium text-ink">Setlists Library</span> (design doc §13, Phase 12,
        was "Setlist Archive" — renamed, since Active is most of what's here, not just an archive) — built against
        Phase 4's approved artifact (Option C: one unified page, sectioned by scroll, no toggle, no separate route),
        a compact card grid per that artifact's own chosen layout. Every card's own right-click menu is real
        (decision 19's own "Duplicate" forward note, plus Archive/Unarchive — which genuinely moves a card between
        sections — and a real Delete). "New Setlist"/"Edit Setlist" open the same real{' '}
        <span className="font-mono">EditSetlistModal</span> Setlist Details already uses, in its create/edit states
        — saving is a no-op close there, same posture as everywhere else this modal is demoed. Cards link to the one
        Setlist Details mockup that actually exists, regardless of which card you click.
      </div>

      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-xl font-medium text-ink">Setlists</h1>
        <button
          type="button"
          onClick={() => setNewSetlistOpen(true)}
          className="flex cursor-pointer items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-display text-sm text-white hover:bg-accent/90"
        >
          <IconPlus size={14} />
          New Setlist
        </button>
      </div>

      <section id="active" className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-medium text-ink">Active</h2>
        {active.length === 0 ? (
          <p className="text-sm text-ink-soft italic">No active setlists.</p>
        ) : (
          <SetlistGrid
            setlists={active}
            onArchiveToggle={openArchiveModal}
            onDuplicate={openDuplicateModal}
            onEdit={setEditTarget}
            onDelete={confirmDelete}
          />
        )}
      </section>

      <section id="archived" className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-medium text-ink">Archived</h2>
        {archived.length === 0 ? (
          <p className="text-sm text-ink-soft italic">No archived setlists.</p>
        ) : (
          <SetlistGrid
            setlists={archived}
            onArchiveToggle={openArchiveModal}
            onDuplicate={openDuplicateModal}
            onEdit={setEditTarget}
            onDelete={confirmDelete}
          />
        )}
      </section>

      {/* Archive/Unarchive confirm — a real Modal, not a native confirm(),
          matching decision 14's own reasoning exactly (reversible, not
          destructive — this app's native-confirm treatment is reserved for
          hard deletes). Copy and button label both mirror
          SetlistDetailsMockup.tsx's own identical modal verbatim. */}
      <Modal open={archiveTarget !== null} onClose={() => setArchiveTarget(null)} labelledBy="archive-setlist-title">
        <div className="flex flex-col gap-4">
          <div>
            <h2 id="archive-setlist-title" className="font-display text-xl font-medium text-ink">
              {archiveDirection === 'unarchive' ? 'Unarchive this setlist?' : 'Archive this setlist?'}
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              {archiveDirection === 'unarchive'
                ? `"${archiveTarget?.name}" will move back into your active list.`
                : `"${archiveTarget?.name}" will move out of your active list. You can unarchive it any time.`}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setArchiveTarget(null)}
              className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmArchiveToggle}
              className="cursor-pointer rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90"
            >
              {archiveDirection === 'unarchive' ? 'Unarchive' : 'Archive'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Duplicate — same shape as SetlistDetailsMockup.tsx's own Duplicate
          modal verbatim, just parameterized by whichever card's own "⋯"
          menu opened it instead of a single fixed setlist. */}
      <Modal open={duplicateTarget !== null} onClose={() => setDuplicateTarget(null)} labelledBy="duplicate-setlist-title">
        <div className="flex flex-col gap-4">
          <div>
            <h2 id="duplicate-setlist-title" className="font-display text-xl font-medium text-ink">
              Duplicate this setlist
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              Copies every entry in "{duplicateTarget?.name}" into a new setlist. Both fields below are optional.
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
              placeholder={`${duplicateTarget?.name ?? ''} (Copy)`}
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
              onClick={() => setDuplicateTarget(null)}
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

      {/* New Setlist — decision 3a: the same EditSetlistModal doubles as
          the create-state modal, unmodified. */}
      <EditSetlistModal
        open={newSetlistOpen}
        onClose={() => setNewSetlistOpen(false)}
        mode="create"
        onSave={() => {}}
      />

      {/* Edit Setlist — same modal, edit state, pre-filled from whichever
          card's own "⋯" menu opened it. Keyed by the target's id so
          switching from editing one card to another doesn't carry stale
          field values across, same reasoning EditSetlistMockup.tsx's own
          page-wrapper demo already documents for its mode switch. */}
      {editTarget && (
        <EditSetlistModal
          key={editTarget.id}
          open={editTarget !== null}
          onClose={() => setEditTarget(null)}
          mode="edit"
          initialName={editTarget.name}
          initialGigDate={editTarget.gigDate}
          onSave={() => {}}
        />
      )}
    </div>
  )
}
