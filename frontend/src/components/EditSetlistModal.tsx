import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IconCalendarFilled, IconGripVertical, IconPencil, IconPlus, IconSearch, IconX, IconXFilled } from '@tabler/icons-react'
import { ApiError } from '../api/client'
import { searchPieces } from '../api/pieces'
import {
  addSetlistEntry,
  createSetlist,
  getSetlist,
  removeSetlistEntry,
  reorderSetlistEntries,
  updateSetlist,
  updateSetlistEntry,
} from '../api/setlists'
import type { Piece, SetlistDetail, SetlistEntry } from '../api/types'
import { personCreditPart } from '../lib/joinNames'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { InfoTooltip } from './InfoTooltip'
import { MarkdownText } from './MarkdownText'
import { Modal } from './Modal'
import { Toggle } from './Toggle'

// Real port of EditSetlistMockup.tsx's own exported EditSetlistModal
// (Setlists design pass, Phase 10 mockup approved, decision 23's full
// fold; this is Phase 15's real build) — a single modal with two tabs
// ("Setlist Details" / "Program Order"), doubling as the New Setlist
// create state (decision 3a). Exported for reuse across SetlistPage.tsx
// (both its "Edit setlist"/"E" shortcut and its Program section's own
// "Edit Program" button open this same instance, landed on a different
// tab) and SetlistsLibraryPage.tsx (its own "New Setlist"/"Edit Setlist"
// actions).
//
// Whole-setlist delete does NOT live here (decision 1's own final call,
// confirmed against PieceContextMenu.tsx/BookContextMenu.tsx/PiecePage.tsx/
// BookDetailsPage.tsx) — it's an icon-only button on SetlistPage.tsx's own
// header, a native window.confirm(), never inside this modal.
//
// One deliberate real-build simplification beyond what the mockup showed:
// in create mode, the Program Order tab still exists (so the tab strip
// itself doesn't change shape between modes) but shows a plain notice
// instead of the add/reorder UI — a setlist has to actually exist server-
// side (a real id) before POST .../entries has anywhere to post to. The
// mockup's own create-mode Program tab worked from pure local state with
// no such constraint; this asymmetry doesn't exist there.
//
// The Setlist Details tab's own name/gigDate/description are plain local
// form state, saved only when the footer's Save button is pressed (Cancel
// discards them) — the same convention every other Edit modal in this app
// follows. The Program Order tab is the opposite: every action (add a
// piece, add/edit a custom entry, remove, reorder) calls its own backend
// endpoint immediately and updates the shared ['setlist', id] query cache
// on success, the same "live list management" posture TagComboBox/
// AddToSetlistPicker already take elsewhere in this app — there's nothing
// for the footer Save/Cancel pair to commit or discard on that tab, since
// nothing on it is ever left unsaved.

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function parseDurationInput(value: string): number | undefined {
  const match = value.trim().match(/^(\d+):(\d{2})$/)
  if (!match) return undefined
  return Number(match[1]) * 60 + Number(match[2])
}

function pieceKeysLabel(piece: Piece | SetlistEntry['piece']): string {
  return (piece?.keys ?? []).map((k) => k.name).join(' › ')
}

type SetlistModalTab = 'details' | 'program'

interface EditSetlistModalProps {
  open: boolean
  onClose: () => void
  // 'create' is decision 3a's "doubles as the New Setlist modal" state —
  // blank fields, no Program tab content yet.
  mode: 'create' | 'edit'
  // Required when mode === 'edit'.
  setlistId?: number
  // Which tab this modal lands on the next time it opens — re-applied via
  // the sync effect below on every open, not just once at mount, since
  // this component's own instance persists across open/close (the caller
  // toggles `open`, doesn't conditionally render <EditSetlistModal>
  // itself) — same posture Modal.tsx's own mounted/visible sync takes for
  // the identical reason.
  initialTab?: SetlistModalTab
  // Fired once a create-mode Save actually creates the setlist — lets the
  // caller navigate to its new Setlist Details page. Not used in edit
  // mode.
  onCreated?: (setlist: SetlistDetail) => void
}

type AddRowMode = 'buttons' | 'search' | 'custom'

export function EditSetlistModal({ open, onClose, mode, setlistId, initialTab = 'details', onCreated }: EditSetlistModalProps) {
  const queryClient = useQueryClient()

  const [activeTab, setActiveTab] = useState<SetlistModalTab>(initialTab)
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: this component's instance persists across open/close, so the caller's requested tab has to be re-applied on every open, not just once at mount.
    setActiveTab(initialTab)
  }, [open, initialTab])

  const { data: setlistDetail } = useQuery({
    queryKey: ['setlist', setlistId],
    queryFn: () => getSetlist(setlistId!),
    enabled: mode === 'edit' && setlistId != null,
  })

  const [name, setName] = useState('')
  const [gigDate, setGigDate] = useState('')
  const [description, setDescription] = useState('')

  // Re-syncs the Details fields exactly once per open — not on every
  // setlistDetail change while open, which would otherwise silently
  // clobber an in-progress name/gigDate/description edit the moment a
  // Program-tab action (add/remove/reorder) writes fresh data into the
  // same ['setlist', id] cache entry this query shares.
  const detailsSyncedRef = useRef(false)
  useEffect(() => {
    if (!open) {
      detailsSyncedRef.current = false
      return
    }
    if (detailsSyncedRef.current) return
    if (mode === 'create') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: syncs local form state to an external controlled prop (this component's instance persists across open/close), same posture Modal.tsx's own mounted/visible sync takes. Guarded by detailsSyncedRef so it only runs once per open, not on every unrelated re-render.
      setName('')
      setGigDate('')
      setDescription('')
      detailsSyncedRef.current = true
      return
    }
    if (setlistDetail) {
      setName(setlistDetail.name)
      setGigDate(setlistDetail.gigDate ?? '')
      setDescription(setlistDetail.description ?? '')
      detailsSyncedRef.current = true
    }
  }, [open, mode, setlistDetail])

  // Local, draggable copy of the Program's entries — mirrors the query's
  // own entries whenever a drag isn't in progress; a drag mutates this
  // directly for instant visual feedback and only calls the reorder
  // endpoint once, on drop.
  const [entries, setEntries] = useState<SetlistEntry[]>([])
  const [draggingId, setDraggingId] = useState<number | null>(null)
  useEffect(() => {
    if (draggingId !== null) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: mirrors the ['setlist', id] query's own entries into local, freely-mutable drag state whenever a drag isn't actively reordering it.
    setEntries(setlistDetail?.entries ?? [])
  }, [setlistDetail, draggingId])

  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [dragWidth, setDragWidth] = useState(0)
  const scrollContainerRef = useRef<HTMLElement | null>(null)
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)

  const [addRowMode, setAddRowMode] = useState<AddRowMode>('buttons')
  const [pieceQuery, setPieceQuery] = useState('')
  const debouncedPieceQuery = useDebouncedValue(pieceQuery)
  const [searchHighlight, setSearchHighlight] = useState(-1)
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null)
  const [customName, setCustomName] = useState('')
  const [customDuration, setCustomDuration] = useState('')
  const [customDescription, setCustomDescription] = useState('')
  const [customCountsAsMusic, setCustomCountsAsMusic] = useState(false)
  const pieceSearchInputRef = useRef<HTMLInputElement>(null)
  const customNameInputRef = useRef<HTMLInputElement>(null)
  const expandedRef = useRef<HTMLElement | null>(null)
  const setExpandedRef = useCallback((node: HTMLElement | null) => {
    expandedRef.current = node
  }, [])

  const { data: pieceResults = [] } = useQuery({
    queryKey: ['pieces', 'setlist-search', debouncedPieceQuery],
    queryFn: () =>
      debouncedPieceQuery.trim()
        ? searchPieces({ query: debouncedPieceQuery, limit: 20 })
        : searchPieces({ sort: 'dateAdded', dir: 'desc', limit: 5 }),
    enabled: addRowMode === 'search',
  })

  const libraryPieceIdsInProgram = useMemo(() => {
    const ids = new Set<number>()
    for (const entry of entries) {
      if (entry.kind === 'piece' && entry.piece) ids.add(entry.piece.id)
    }
    return ids
  }, [entries])

  // Every mutation below writes the full updated SetlistResponse straight
  // into the shared ['setlist', id] cache on success (every entry endpoint
  // except remove returns it) — SetlistPage.tsx's own query reads the same
  // key, so its Program list picks up the change immediately with no
  // separate invalidate/refetch round trip.
  function applyUpdatedSetlist(updated: SetlistDetail) {
    queryClient.setQueryData(['setlist', setlistId], updated)
  }

  const addPieceMutation = useMutation({
    mutationFn: (pieceId: number) => addSetlistEntry(setlistId!, { pieceId }),
    onSuccess: applyUpdatedSetlist,
    onError: (error) => window.alert(error instanceof ApiError ? error.message : 'Could not add that piece.'),
  })

  const addOrEditCustomMutation = useMutation({
    mutationFn: () => {
      const body = {
        customName: customName.trim(),
        customDurationSeconds: parseDurationInput(customDuration) ?? null,
        customNotes: customDescription.trim() || null,
        customCountsAsMusic,
      }
      if (editingEntryId != null) {
        const existing = entries.find((e) => e.id === editingEntryId)
        return updateSetlistEntry(setlistId!, editingEntryId, { role: existing?.role ?? null, ...body })
      }
      return addSetlistEntry(setlistId!, body)
    },
    onSuccess: applyUpdatedSetlist,
    onError: (error) => window.alert(error instanceof ApiError ? error.message : 'Could not save that entry.'),
  })

  const removeMutation = useMutation({
    mutationFn: (entryId: number) => removeSetlistEntry(setlistId!, entryId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['setlist', setlistId] }),
    onError: (error) => window.alert(error instanceof ApiError ? error.message : 'Could not remove that entry.'),
  })

  const reorderMutation = useMutation({
    mutationFn: (entryIds: number[]) => reorderSetlistEntries(setlistId!, entryIds),
    onSuccess: applyUpdatedSetlist,
    onError: (error) => window.alert(error instanceof ApiError ? error.message : 'Could not save the new order.'),
  })

  function removeEntry(id: number) {
    removeMutation.mutate(id)
  }

  function openPieceSearch() {
    setEditingEntryId(null)
    setPieceQuery('')
    setSearchHighlight(-1)
    setAddRowMode('search')
  }

  function closeAddRow() {
    setAddRowMode('buttons')
  }

  // Selecting a result always appends a new instance (decision 4 —
  // duplicates allowed on purpose). The search stays open afterward so
  // several pieces can be added in a row — only the query/highlight reset.
  function selectPiece(piece: Piece) {
    addPieceMutation.mutate(piece.id)
    setPieceQuery('')
    setSearchHighlight(-1)
    pieceSearchInputRef.current?.focus()
  }

  function onPieceSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSearchHighlight((h) => (pieceResults.length === 0 ? -1 : (h + 1) % pieceResults.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSearchHighlight((h) => (pieceResults.length === 0 ? -1 : (h - 1 + pieceResults.length) % pieceResults.length))
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      const target = pieceResults[searchHighlight]
      if (target) selectPiece(target)
    } else if (event.key === 'Escape') {
      closeAddRow()
    }
  }

  function openAddCustomForm() {
    setEditingEntryId(null)
    setCustomName('')
    setCustomDuration('')
    setCustomDescription('')
    setCustomCountsAsMusic(false)
    setAddRowMode('custom')
  }

  function openEditCustomForm(entry: SetlistEntry) {
    if (addRowMode !== 'buttons') closeAddRow()
    setEditingEntryId(entry.id)
    setCustomName(entry.customName ?? '')
    setCustomDuration(entry.customDurationSeconds != null ? formatDuration(entry.customDurationSeconds) : '')
    setCustomDescription(entry.customNotes ?? '')
    setCustomCountsAsMusic(entry.customCountsAsMusic)
  }

  function closeCustomForm() {
    setEditingEntryId(null)
    setCustomName('')
    setCustomDuration('')
    setCustomDescription('')
    setCustomCountsAsMusic(false)
    if (addRowMode === 'custom') closeAddRow()
  }

  function selectAddMode(target: 'search' | 'custom') {
    if (addRowMode === target) {
      if (target === 'custom') closeCustomForm()
      else closeAddRow()
      return
    }
    if (target === 'search') openPieceSearch()
    else openAddCustomForm()
  }

  function submitCustomForm() {
    if (!customName.trim()) return
    const wasEditing = editingEntryId != null
    addOrEditCustomMutation.mutate(undefined, {
      onSuccess: () => {
        if (wasEditing) {
          closeCustomForm()
        } else {
          setCustomName('')
          setCustomDuration('')
          setCustomDescription('')
          setCustomCountsAsMusic(false)
          customNameInputRef.current?.focus()
        }
      },
    })
  }

  // Pointer-based reorder — works for mouse and touch alike. Capture is
  // set on `listRef` (the outer, never-reordered container), not on the
  // card being dragged — a card that reorders during its own drag loses
  // pointer capture the instant React relocates its DOM node, which would
  // otherwise strand `draggingId` set (CLAUDE.md's own standing gotcha).
  const listRef = useRef<HTMLDivElement>(null)

  function isDragBlocker(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest('.no-drag') != null
  }

  const reorderAtPoint = useCallback((fromId: number, clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY)
    const rowEl = el?.closest('[data-entry-id]') as HTMLElement | null
    const overId = rowEl?.dataset.entryId ? Number(rowEl.dataset.entryId) : null
    if (overId == null || overId === fromId) return
    setEntries((current) => {
      const fromIndex = current.findIndex((e) => e.id === fromId)
      const toIndex = current.findIndex((e) => e.id === overId)
      if (fromIndex === -1 || toIndex === -1) return current
      const next = [...current]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }, [])

  function onCardPointerDown(event: ReactPointerEvent<HTMLDivElement>, id: number) {
    if (isDragBlocker(event.target)) return
    const rect = event.currentTarget.getBoundingClientRect()
    setDragOffset({ x: event.clientX - rect.left, y: event.clientY - rect.top })
    setDragWidth(rect.width)
    scrollContainerRef.current = listRef.current?.closest('.overflow-y-auto') as HTMLElement | null
    lastPointerRef.current = { x: event.clientX, y: event.clientY }
    listRef.current?.setPointerCapture(event.pointerId)
    setDraggingId(id)
    setGhostPos({ x: event.clientX, y: event.clientY })
  }

  useEffect(() => {
    if (!draggingId) return
    document.body.style.cursor = 'grabbing'
    return () => {
      document.body.style.cursor = ''
    }
  }, [draggingId])

  function onListPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingId) return
    setGhostPos({ x: event.clientX, y: event.clientY })
    lastPointerRef.current = { x: event.clientX, y: event.clientY }
    reorderAtPoint(draggingId, event.clientX, event.clientY)
  }

  // Auto-scroll while the ghost sits near the list's own scrolled top/
  // bottom edge — a rAF loop re-checks the last-known pointer position on
  // every frame, not just on pointermove, so the list keeps reordering
  // correctly under a stationary pointer as new rows scroll into reach.
  useEffect(() => {
    if (!draggingId) return
    const activeDraggingId = draggingId
    const EDGE_ZONE = 56
    const MAX_SPEED = 14
    let rafId: number

    function tick() {
      const container = scrollContainerRef.current
      const pointer = lastPointerRef.current
      if (container && pointer) {
        const rect = container.getBoundingClientRect()
        let speed = 0
        if (pointer.y < rect.top + EDGE_ZONE) {
          speed = -MAX_SPEED * (1 - Math.max(0, pointer.y - rect.top) / EDGE_ZONE)
        } else if (pointer.y > rect.bottom - EDGE_ZONE) {
          speed = MAX_SPEED * (1 - Math.max(0, rect.bottom - pointer.y) / EDGE_ZONE)
        }
        if (speed !== 0) {
          container.scrollTop += speed
          reorderAtPoint(activeDraggingId, pointer.x, pointer.y)
        }
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [draggingId, reorderAtPoint])

  // Drop — commits the local order to the backend in one call, only if it
  // actually changed from what's currently persisted.
  function endDrag() {
    const id = draggingId
    setDraggingId(null)
    setGhostPos(null)
    scrollContainerRef.current = null
    lastPointerRef.current = null
    if (id == null) return
    const persistedIds = (setlistDetail?.entries ?? []).map((e) => e.id)
    const currentIds = entries.map((e) => e.id)
    if (persistedIds.length === currentIds.length && persistedIds.every((v, i) => v === currentIds[i])) return
    reorderMutation.mutate(currentIds)
  }

  const createMutation = useMutation({
    mutationFn: () => createSetlist({ name: name.trim(), gigDate: gigDate || null, description: description.trim() || null }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['setlists'] })
      onCreated?.(created)
      onClose()
    },
    onError: (error) => window.alert(error instanceof ApiError ? error.message : 'Could not create this setlist.'),
  })

  const updateDetailsMutation = useMutation({
    mutationFn: () =>
      updateSetlist(setlistId!, {
        name: name.trim(),
        gigDate: gigDate || null,
        description: description.trim() || null,
        archived: setlistDetail?.archived ?? false,
      }),
    onSuccess: (updated) => {
      applyUpdatedSetlist(updated)
      queryClient.invalidateQueries({ queryKey: ['setlists'] })
      onClose()
    },
    onError: (error) => window.alert(error instanceof ApiError ? error.message : 'Could not save this setlist.'),
  })

  function handleCancel() {
    closeAddRow()
    closeCustomForm()
    onClose()
  }

  function handleSave() {
    if (!name.trim()) return
    if (mode === 'create') {
      createMutation.mutate()
    } else {
      updateDetailsMutation.mutate()
    }
  }

  const saving = createMutation.isPending || updateDetailsMutation.isPending

  function handleFormKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault()
      if (name.trim()) handleSave()
    }
  }

  // Scrolls whichever block just opened (piece search / custom-entry add /
  // an existing entry's inline edit) fully into view, with a small peek
  // past its own bottom edge.
  useEffect(() => {
    if (addRowMode === 'buttons' && editingEntryId === null) return
    const target = expandedRef.current
    const container = target?.closest('.overflow-y-auto') as HTMLElement | null
    if (!target || !container) return
    const targetRect = target.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const EXTRA_PEEK = 16
    if (targetRect.bottom > containerRect.bottom) {
      container.scrollTop += targetRect.bottom - containerRect.bottom + EXTRA_PEEK
    } else if (targetRect.top < containerRect.top) {
      container.scrollTop -= containerRect.top - targetRect.top
    }
  }, [addRowMode, editingEntryId])

  const draggingEntry = draggingId != null ? entries.find((e) => e.id === draggingId) : undefined

  function renderCustomEntryForm(key: string, wrapperClassName: string) {
    return (
      <form
        key={key}
        ref={setExpandedRef}
        onSubmit={(event) => {
          event.preventDefault()
          submitCustomForm()
        }}
        className={wrapperClassName}
      >
        <button
          type="button"
          onClick={closeCustomForm}
          aria-label="Cancel custom entry"
          className="absolute top-2 right-2 cursor-pointer rounded p-1 text-ink-soft hover:bg-paper-sunken hover:text-ink"
        >
          <IconX size={13} />
        </button>
        <label htmlFor="f-custom-name" className="text-sm text-ink-soft">
          Name
        </label>
        <input
          ref={customNameInputRef}
          id="f-custom-name"
          type="text"
          autoFocus
          value={customName}
          onChange={(event) => setCustomName(event.target.value)}
          placeholder="Welcome &amp; Announcements"
          className="mt-1 mb-2 w-full rounded-md border border-border bg-paper-raised px-3 py-1.5 text-sm text-ink"
        />
        <div className="mb-2 flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor="f-custom-duration" className="text-sm text-ink-soft">
              Duration
            </label>
            <input
              id="f-custom-duration"
              type="text"
              value={customDuration}
              onChange={(event) => setCustomDuration(event.target.value)}
              placeholder="3:00"
              className="mt-1 w-full rounded-md border border-border bg-paper-raised px-3 py-1.5 text-sm text-ink"
            />
          </div>
          <div className="flex flex-1 py-1.5">
            <Toggle checked={customCountsAsMusic} onChange={setCustomCountsAsMusic} label="Count as music" />
          </div>
        </div>
        <label htmlFor="f-custom-description" className="text-sm text-ink-soft">
          Description <span className="text-ink-soft/60 italic">(Markdown supported)</span>
        </label>
        <textarea
          id="f-custom-description"
          value={customDescription}
          onChange={(event) => setCustomDescription(event.target.value)}
          placeholder="Reminder: mention the bake sale sign-up sheet before the offering."
          rows={2}
          className="mt-1 mb-3 w-full resize-none rounded-md border border-border bg-paper-raised px-3 py-1.5 text-sm text-ink"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={closeCustomForm}
            className="cursor-pointer rounded-md border border-border bg-paper-raised px-3 py-1.5 text-sm text-ink hover:border-accent"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!customName.trim() || addOrEditCustomMutation.isPending}
            className="cursor-pointer rounded-md bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {editingEntryId ? 'Save' : 'Add'}
          </button>
        </div>
      </form>
    )
  }

  return (
    <>
      <Modal
        open={open}
        onClose={handleCancel}
        labelledBy="edit-setlist-title"
        size="md"
        header={
          <div className="-mx-6 border-b border-border px-6">
            <div className="flex items-start justify-between gap-4 pb-4">
              <div>
                <h2 id="edit-setlist-title" className="font-display text-2xl font-medium text-ink">
                  {mode === 'create' ? 'New setlist' : 'Edit setlist'}
                </h2>
                {mode === 'edit' && setlistDetail && <p className="text-sm text-ink-soft">{setlistDetail.name}</p>}
              </div>
              <button
                type="button"
                onClick={handleCancel}
                aria-label="Close"
                className="mt-1 shrink-0 cursor-pointer text-ink-soft hover:text-accent"
              >
                <IconXFilled size={22} />
              </button>
            </div>
            <div className="flex gap-6">
              <button
                type="button"
                onClick={() => setActiveTab('details')}
                className={`-mb-px cursor-pointer border-b-2 pb-2 text-sm font-medium ${
                  activeTab === 'details' ? 'border-accent text-ink' : 'border-transparent text-ink-soft hover:text-ink'
                }`}
              >
                Setlist Details
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('program')}
                className={`-mb-px cursor-pointer border-b-2 pb-2 text-sm font-medium ${
                  activeTab === 'program' ? 'border-accent text-ink' : 'border-transparent text-ink-soft hover:text-ink'
                }`}
              >
                Program Order
              </button>
            </div>
          </div>
        }
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
            >
              {mode === 'create' || activeTab === 'details' ? 'Cancel' : 'Close'}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!name.trim() || saving}
              className="cursor-pointer rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        }
      >
        <div onKeyDown={handleFormKeyDown}>
          <div className={activeTab === 'details' ? 'flex flex-col gap-4' : 'hidden'}>
            <div className="flex flex-col gap-1">
              <label htmlFor="f-setlist-name" className="text-sm text-ink-soft">
                Name <span className="text-ink-soft/60 italic">(Required)</span>
              </label>
              <input
                id="f-setlist-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="f-setlist-gig-date" className="text-sm text-ink-soft">
                Gig date
              </label>
              <input
                id="f-setlist-gig-date"
                type="date"
                value={gigDate}
                onChange={(event) => setGigDate(event.target.value)}
                className="w-fit rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              />
              <span className="text-xs text-ink-soft">Shown in your browser's own date format.</span>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="f-setlist-description" className="text-sm text-ink-soft">
                Description <span className="text-ink-soft/60 italic">(Markdown supported)</span>
              </label>
              <textarea
                id="f-setlist-description"
                rows={4}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="min-h-[96px] resize-none rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
              />
            </div>
          </div>

          <div className={activeTab === 'program' ? '' : 'hidden'}>
            {mode === 'create' ? (
              <p className="px-2 py-8 text-center text-sm text-ink-soft italic">
                Save this setlist first to start adding its program.
              </p>
            ) : (
              <>
                <p className="mb-2 text-xs font-medium tracking-wide text-ink-soft uppercase">Program ({entries.length})</p>
                <div
                  ref={listRef}
                  onPointerMove={onListPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onLostPointerCapture={endDrag}
                  className="flex flex-col gap-1.5"
                >
                  {entries.map((entry) => {
                    if (entry.kind === 'custom' && entry.id === editingEntryId) {
                      return renderCustomEntryForm(String(entry.id), 'relative rounded-md border border-accent bg-paper-raised p-3')
                    }
                    const title = entry.kind === 'piece' ? (entry.piece?.title ?? '') : (entry.customName ?? '')
                    const durationSeconds = entry.kind === 'piece' ? entry.piece?.duration : entry.customDurationSeconds
                    return (
                      <div
                        key={entry.id}
                        data-entry-id={entry.id}
                        onPointerDown={(event) => onCardPointerDown(event, entry.id)}
                        className={`flex touch-none items-start gap-1.5 rounded-md border border-border bg-paper-raised px-2 py-1.5 cursor-grab select-none active:cursor-grabbing ${
                          draggingId === entry.id ? 'opacity-40' : ''
                        }`}
                      >
                        <span aria-hidden="true" className="mr-1 shrink-0 self-center text-ink-soft/50">
                          <IconGripVertical size={14} />
                        </span>
                        {entry.kind === 'custom' && (
                          <button
                            type="button"
                            onClick={() => openEditCustomForm(entry)}
                            aria-label={`Edit ${title}`}
                            className="no-drag mt-0.5 shrink-0 cursor-pointer text-ink-soft hover:text-accent"
                          >
                            <IconPencil size={13} />
                          </button>
                        )}
                        <div className="min-w-0 flex-1">
                          <div
                            className={`truncate ${
                              entry.kind === 'piece'
                                ? 'font-display text-sm font-medium text-ink'
                                : 'font-sans text-sm font-normal text-ink-soft italic'
                            }`}
                          >
                            {title}
                          </div>
                          {entry.kind === 'piece' ? (
                            <div className="truncate text-xs text-ink-soft">
                              {personCreditPart(
                                entry.piece?.composer.map((t) => t.name) ?? [],
                                entry.piece?.arranger.map((t) => t.name) ?? [],
                              )}{' '}
                              <span aria-hidden="true">•</span> {pieceKeysLabel(entry.piece)}
                            </div>
                          ) : (
                            entry.customNotes && (
                              <div className="line-clamp-2 text-xs text-ink-soft italic">
                                <MarkdownText>{entry.customNotes}</MarkdownText>
                              </div>
                            )
                          )}
                        </div>
                        {durationSeconds != null && (
                          <span className="mt-0.5 shrink-0 font-mono text-xs tabular-nums text-ink-soft">
                            {formatDuration(durationSeconds)}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => removeEntry(entry.id)}
                          aria-label={`Remove ${title}`}
                          className="no-drag mt-0.5 shrink-0 cursor-pointer text-ink-soft hover:text-ink"
                        >
                          <IconX size={14} />
                        </button>
                      </div>
                    )
                  })}

                  <div className="rounded-md bg-paper-raised overflow-hidden">
                    <div className="flex">
                      <button
                        type="button"
                        onClick={() => selectAddMode('search')}
                        className={`relative flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-tl-md border-t border-r border-l border-border px-3 py-2 text-sm font-medium transition-colors ${
                          addRowMode === 'buttons' ? 'rounded-bl-md border-b' : ''
                        } ${addRowMode === 'search' ? 'bg-paper-sunken text-ink' : 'text-ink-soft hover:z-10 hover:border-accent'}`}
                      >
                        <IconPlus size={14} />
                        Piece
                      </button>
                      <button
                        type="button"
                        onClick={() => selectAddMode('custom')}
                        className={`relative -ml-px flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-tr-md border-t border-r border-l border-border px-3 py-2 text-sm font-medium transition-colors ${
                          addRowMode === 'buttons' ? 'rounded-br-md border-b' : ''
                        } ${addRowMode === 'custom' ? 'bg-paper-sunken text-ink' : 'text-ink-soft hover:z-10 hover:border-accent'}`}
                      >
                        <IconPlus size={14} />
                        Custom Entry
                      </button>
                    </div>

                    {addRowMode === 'search' && (
                      <div ref={setExpandedRef} className="border border-border rounded-b-md p-2.5">
                        <div className="relative">
                          <IconSearch
                            size={13}
                            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-soft/60"
                          />
                          <input
                            ref={pieceSearchInputRef}
                            type="text"
                            autoFocus
                            value={pieceQuery}
                            onChange={(event) => {
                              setPieceQuery(event.target.value)
                              setSearchHighlight(-1)
                            }}
                            onKeyDown={onPieceSearchKeyDown}
                            placeholder="Search pieces…"
                            aria-label="Search pieces"
                            className="w-full rounded-md border border-border bg-paper py-1.5 pr-8 pl-7 text-sm text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={closeAddRow}
                            aria-label="Cancel adding a piece"
                            className="absolute top-1/2 right-1.5 -translate-y-1/2 cursor-pointer rounded p-1 text-ink-soft hover:bg-paper-sunken hover:text-ink"
                          >
                            <IconX size={13} />
                          </button>
                        </div>
                        <p className="mt-2 mb-1 text-[0.65rem] font-medium tracking-wide text-ink-soft uppercase">
                          {pieceQuery.trim()
                            ? `${pieceResults.length} ${pieceResults.length === 1 ? 'match' : 'matches'}`
                            : 'Recently added'}
                        </p>
                        <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
                          {pieceResults.length === 0 ? (
                            <p className="px-2 py-4 text-center text-sm text-ink-soft italic">No matches</p>
                          ) : (
                            pieceResults.map((piece, i) => {
                              const inProgram = libraryPieceIdsInProgram.has(piece.id)
                              return (
                                <div
                                  key={piece.id}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => selectPiece(piece)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                      event.preventDefault()
                                      selectPiece(piece)
                                    }
                                  }}
                                  className={`flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left ${
                                    i === searchHighlight ? 'bg-paper-sunken' : 'hover:bg-paper-sunken'
                                  }`}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 font-display text-sm font-medium text-ink">
                                      <span className="truncate">{piece.title}</span>
                                      {inProgram && (
                                        <span onClick={(event) => event.stopPropagation()}>
                                          <InfoTooltip
                                            message="Already in this setlist"
                                            ariaLabel="Already in this setlist"
                                            showPointerCursor={false}
                                            triggerClassName="shrink-0 text-accent"
                                          >
                                            <IconCalendarFilled size={12} />
                                          </InfoTooltip>
                                        </span>
                                      )}
                                    </div>
                                    <div className="truncate text-xs text-ink-soft">
                                      {personCreditPart(
                                        piece.composer.values.map((p) => p.name),
                                        piece.arranger.values.map((p) => p.name),
                                      )}{' '}
                                      <span aria-hidden="true">•</span> {pieceKeysLabel(piece)}
                                    </div>
                                  </div>
                                  {piece.duration != null && (
                                    <span className="shrink-0 font-mono text-xs tabular-nums text-ink-soft">
                                      {formatDuration(piece.duration)}
                                    </span>
                                  )}
                                </div>
                              )
                            })
                          )}
                        </div>
                      </div>
                    )}

                    {addRowMode === 'custom' &&
                      renderCustomEntryForm('add-custom-entry', 'relative border border-border rounded-b-md p-3')}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </Modal>

      {draggingId != null &&
        ghostPos &&
        draggingEntry &&
        createPortal(
          <div
            aria-hidden="true"
            style={{
              position: 'fixed',
              left: ghostPos.x - dragOffset.x,
              top: ghostPos.y - dragOffset.y,
              width: dragWidth,
              pointerEvents: 'none',
              zIndex: 9999,
            }}
            className="flex items-start gap-1.5 rounded-md border border-accent bg-paper-raised px-2 py-1.5 shadow-xl"
          >
            <span className="mr-1 shrink-0 self-center text-ink-soft/50">
              <IconGripVertical size={14} />
            </span>
            {draggingEntry.kind === 'custom' && (
              <span className="mt-0.5 shrink-0 text-ink-soft">
                <IconPencil size={13} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div
                className={`truncate ${
                  draggingEntry.kind === 'piece'
                    ? 'font-display text-sm font-medium text-ink'
                    : 'font-sans text-sm font-normal text-ink-soft italic'
                }`}
              >
                {draggingEntry.kind === 'piece' ? draggingEntry.piece?.title : draggingEntry.customName}
              </div>
              {draggingEntry.kind === 'piece' ? (
                <div className="truncate text-xs text-ink-soft">
                  {personCreditPart(
                    draggingEntry.piece?.composer.map((t) => t.name) ?? [],
                    draggingEntry.piece?.arranger.map((t) => t.name) ?? [],
                  )}{' '}
                  <span aria-hidden="true">•</span> {pieceKeysLabel(draggingEntry.piece)}
                </div>
              ) : (
                draggingEntry.customNotes && (
                  <div className="line-clamp-2 text-xs text-ink-soft italic">
                    <MarkdownText>{draggingEntry.customNotes}</MarkdownText>
                  </div>
                )
              )}
            </div>
            {(draggingEntry.kind === 'piece' ? draggingEntry.piece?.duration : draggingEntry.customDurationSeconds) != null && (
              <span className="mt-0.5 shrink-0 font-mono text-xs tabular-nums text-ink-soft">
                {formatDuration((draggingEntry.kind === 'piece' ? draggingEntry.piece?.duration : draggingEntry.customDurationSeconds)!)}
              </span>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
