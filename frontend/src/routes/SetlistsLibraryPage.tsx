import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IconPlus } from '@tabler/icons-react'
import { ApiError } from '../api/client'
import { addSetlistEntry, createSetlist, deleteSetlist, getSetlist, listSetlists, updateSetlist } from '../api/setlists'
import type { Setlist } from '../api/types'
import { ClickableCard } from '../components/ClickableCard'
import { ContextMenu, type ContextMenuItem } from '../components/ContextMenu'
import { EditSetlistModal } from '../components/EditSetlistModal'
import { Modal } from '../components/Modal'
import { CONTENT_MAX_W } from '../lib/layout'
import { formatRelativeWeeks } from '../lib/relativeWeeks'
import { usePageTitle } from '../lib/usePageTitle'

// The real Setlists Library page (§13, decision 12) — built against
// SetlistsLibraryMockup.tsx (the approved Phase 12 mockup: one unified
// page, "Active"/"Archived" as two headed sections reached by scrolling,
// no toggle, a compact auto-fill card grid). Replaces the ComingSoon stub
// that previously scaffolded this route.

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatAbsoluteDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

// Direct instruction — soonest gigDate first (ISO yyyy-mm-dd strings sort
// correctly as plain strings), ties broken alphabetically by name, and a
// setlist with no gigDate at all sorts after every dated one regardless of
// name.
function sortActiveSetlists(setlists: Setlist[]): Setlist[] {
  return [...setlists].sort((a, b) => {
    if (a.gigDate && b.gigDate) {
      return a.gigDate !== b.gigDate ? (a.gigDate < b.gigDate ? -1 : 1) : a.name.localeCompare(b.name)
    }
    if (a.gigDate) return -1
    if (b.gigDate) return 1
    return a.name.localeCompare(b.name)
  })
}

// Direct follow-up instruction, same round — Archived is chronological too,
// but reverse: most-recently-dated first (a setlist archived because its
// gigDate passed reads most naturally with the most recent one on top,
// same as any other history/archive list), not the same soonest-first
// direction Active uses. A manually-archived setlist with no gigDate at
// all has nothing to be "recent" about, so it sorts after every dated one
// here too, same as Active's own no-date-at-the-end rule.
function sortArchivedSetlists(setlists: Setlist[]): Setlist[] {
  return [...setlists].sort((a, b) => {
    if (a.gigDate && b.gigDate) {
      return a.gigDate !== b.gigDate ? (a.gigDate > b.gigDate ? -1 : 1) : a.name.localeCompare(b.name)
    }
    if (a.gigDate) return -1
    if (b.gigDate) return 1
    return a.name.localeCompare(b.name)
  })
}

type ArchiveDirection = 'archive' | 'unarchive' | null

// Whether Archive/Unarchive is even a meaningful action for this setlist —
// a setlist archived purely because its gigDate already passed has nothing
// for the toggle to undo. Only a still-upcoming setlist (active, or
// manually archived ahead of its own date) gets the action offered at all
// — mirrors SetlistPage.tsx's own Archive/Unarchive confirm-gated
// mechanism (decision 14) for consistency.
function archiveDirectionFor(setlist: Setlist): ArchiveDirection {
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
  setlist: Setlist
  onArchiveToggle: (setlist: Setlist) => void
  onDuplicate: (setlist: Setlist) => void
  onEdit: (setlist: Setlist) => void
  onDelete: (setlist: Setlist) => void
}) {
  const direction = archiveDirectionFor(setlist)
  const isUpcoming = direction !== null

  const items: ContextMenuItem[] = []
  if (direction) {
    items.push({ label: direction === 'archive' ? 'Archive' : 'Unarchive', onSelect: () => onArchiveToggle(setlist) })
  }
  items.push(
    { label: 'Edit Setlist', onSelect: () => onEdit(setlist) },
    { label: 'Duplicate', onSelect: () => onDuplicate(setlist) },
    { label: 'Delete Setlist', destructive: true, onSelect: () => onDelete(setlist) },
  )

  return (
    <ContextMenu hideTriggerButton items={items}>
      <ClickableCard
        to={`/setlists/${setlist.id}`}
        className={`flex flex-col rounded-lg border border-border bg-paper-raised p-4 text-left hover:border-accent ${
          setlist.effectiveArchived ? 'opacity-70' : ''
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
        {setlist.effectiveArchived && (
          <span className="mt-2 w-fit rounded bg-paper-sunken px-1.5 py-0.5 text-[0.6rem] font-semibold tracking-wide text-ink-soft uppercase">
            Archived
          </span>
        )}
      </ClickableCard>
    </ContextMenu>
  )
}

function SetlistGrid({
  setlists,
  onArchiveToggle,
  onDuplicate,
  onEdit,
  onDelete,
}: {
  setlists: Setlist[]
  onArchiveToggle: (setlist: Setlist) => void
  onDuplicate: (setlist: Setlist) => void
  onEdit: (setlist: Setlist) => void
  onDelete: (setlist: Setlist) => void
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

export function SetlistsLibraryPage() {
  usePageTitle('Setlists')
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const { data: setlists = [], isLoading } = useQuery({ queryKey: ['setlists'], queryFn: listSetlists })

  const [archiveTarget, setArchiveTarget] = useState<Setlist | null>(null)
  const [editTarget, setEditTarget] = useState<Setlist | null>(null)
  const [newSetlistOpen, setNewSetlistOpen] = useState(false)

  const active = sortActiveSetlists(setlists.filter((s) => !s.effectiveArchived))
  const archived = sortArchivedSetlists(setlists.filter((s) => s.effectiveArchived))

  // Archive toggle is a full-replace PATCH (internal/handlers/setlist.go's
  // own setlistUpdateRequest) — the summary list this page renders from
  // doesn't carry `description`, so this fetches the full detail first
  // rather than risking silently nulling it out.
  const archiveMutation = useMutation({
    mutationFn: async (target: Setlist) => {
      const full = await getSetlist(target.id)
      return updateSetlist(target.id, {
        name: target.name,
        gigDate: target.gigDate,
        description: full.description,
        archived: !target.archived,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setlists'] })
      setArchiveTarget(null)
    },
    onError: (err) => window.alert(err instanceof ApiError ? err.message : 'Could not archive this setlist.'),
  })

  const deleteMutation = useMutation({
    mutationFn: (target: Setlist) => deleteSetlist(target.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['setlists'] }),
    onError: (err) => window.alert(err instanceof ApiError ? err.message : 'Could not delete this setlist.'),
  })

  // Same duplicate-by-copying-every-entry flow as SetlistPage.tsx's own —
  // this list only has the lean summary shape, so the full detail
  // (entries + description) is fetched first.
  const duplicateMutation = useMutation({
    mutationFn: async (target: Setlist) => {
      const full = await getSetlist(target.id)
      const created = await createSetlist({ name: `${target.name} (Copy)`, gigDate: target.gigDate, description: full.description })
      for (const entry of full.entries) {
        if (entry.kind === 'piece' && entry.piece) {
          await addSetlistEntry(created.id, { pieceId: entry.piece.id, role: entry.role })
        } else {
          await addSetlistEntry(created.id, {
            customName: entry.customName,
            customDurationSeconds: entry.customDurationSeconds ?? null,
            customNotes: entry.customNotes ?? null,
            customCountsAsMusic: entry.customCountsAsMusic,
            role: entry.role,
          })
        }
      }
      return created
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['setlists'] })
      navigate(`/setlists/${created.id}`)
    },
    onError: (err) => window.alert(err instanceof ApiError ? err.message : 'Could not duplicate this setlist.'),
  })

  function confirmDelete(target: Setlist) {
    if (window.confirm(`Delete "${target.name}"? This can't be undone.`)) deleteMutation.mutate(target)
  }

  const archiveDirection = archiveTarget ? archiveDirectionFor(archiveTarget) : null

  return (
    <div className={`flex flex-1 flex-col gap-6 p-6 md:p-8 ${CONTENT_MAX_W}`}>
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

      {isLoading && <p className="text-ink-soft">Loading…</p>}

      {!isLoading && (
        <>
          <section id="active" className="flex flex-col gap-3">
            <h2 className="font-display text-lg font-medium text-ink">Active</h2>
            {active.length === 0 ? (
              <p className="text-sm text-ink-soft italic">No active setlists.</p>
            ) : (
              <SetlistGrid
                setlists={active}
                onArchiveToggle={setArchiveTarget}
                onDuplicate={(s) => duplicateMutation.mutate(s)}
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
                onArchiveToggle={setArchiveTarget}
                onDuplicate={(s) => duplicateMutation.mutate(s)}
                onEdit={setEditTarget}
                onDelete={confirmDelete}
              />
            )}
          </section>
        </>
      )}

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
              onClick={() => archiveTarget && archiveMutation.mutate(archiveTarget)}
              disabled={archiveMutation.isPending}
              className="cursor-pointer rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {archiveDirection === 'unarchive' ? 'Unarchive' : 'Archive'}
            </button>
          </div>
        </div>
      </Modal>

      <EditSetlistModal
        open={newSetlistOpen}
        onClose={() => setNewSetlistOpen(false)}
        mode="create"
        onCreated={(created) => navigate(`/setlists/${created.id}`)}
      />

      {editTarget && (
        <EditSetlistModal key={editTarget.id} open={editTarget !== null} onClose={() => setEditTarget(null)} mode="edit" setlistId={editTarget.id} />
      )}
    </div>
  )
}
