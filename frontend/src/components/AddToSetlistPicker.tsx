import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IconCalendarPlus, IconCheck, IconSearch, IconXFilled } from '@tabler/icons-react'
import { addSetlistEntry, getUpcomingSetlists, listPieceSetlistMemberships, listSetlists, removeSetlistEntry } from '../api/setlists'
import { ApiError } from '../api/client'
import type { Setlist } from '../api/types'

// Real port of AddToSetlistMockup.tsx's own exported AddToSetlistPicker
// (Setlists design pass, Phase 5 mockup approved; this is Phase 14's real
// build) — the one shared "which setlist?" popover, used from both the
// Library grid/list card context menu (PieceContextMenu.tsx) and Piece
// Details' own toolbar button (PiecePage.tsx). Unlike the mockup (fully
// controlled — allSetlists/setlistIds/onToggle all passed in), this owns
// its own data fetching and mutations, since both real call sites need the
// exact same two queries and would otherwise duplicate them.
//
// Portaled to document.body, not a plain `absolute top-full right-0` child
// of a `relative` wrapper (the mockup's own approach) — found necessary by
// live-testing against the real app: AppShell.tsx's scroll container
// carries `overflow-x-hidden`, which clips ANY `position: absolute`/
// `fixed` descendant that overflows past it regardless of z-index (the
// standing CLAUDE.md gotcha), and a first-column grid card sits close
// enough to that container's own left edge for this popup's fixed 256px
// width to trigger it in practice, not just in a contrived narrow-grid
// test. Same fix TagComboBox.tsx's own dropdown already uses: track the
// anchor's live screen position via getBoundingClientRect (kept in sync on
// resize/scroll) and render through a portal with `position: fixed`.

// "Nov 1" — short month + day, no year, same as the mockup's own
// formatShortDate: this popover only ever shows a setlist's own upcoming
// gig date, never one far enough out that the year would be ambiguous.
function formatShortDate(gigDate: string): string {
  return new Date(gigDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function SetlistToggleRow({
  name,
  date,
  checked,
  pending,
  highlighted,
  onToggle,
  onMouseDown,
}: {
  name: string
  date?: string
  checked: boolean
  pending?: boolean
  highlighted?: boolean
  onToggle: () => void
  onMouseDown?: (event: ReactMouseEvent) => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      onMouseDown={onMouseDown}
      disabled={pending}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink disabled:cursor-not-allowed disabled:opacity-60 ${
        highlighted ? 'bg-accent-soft' : 'hover:bg-accent-soft'
      }`}
    >
      <span
        className={`flex size-3.5 shrink-0 items-center justify-center rounded border ${
          checked ? 'border-accent bg-accent text-white' : 'border-border'
        }`}
      >
        {checked && <IconCheck size={9} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {date && <span className="shrink-0 text-xs text-ink-soft/60">{date}</span>}
    </button>
  )
}

export function AddToSetlistPicker({
  pieceId,
  anchorRef,
  onClose,
}: {
  pieceId: number
  /** The trigger button (or its wrapper) this popover visually anchors
   * under — a live-tracked getBoundingClientRect, not CSS positioning,
   * since this renders through a portal (see this file's own top comment). */
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const queryClient = useQueryClient()

  const [position, setPosition] = useState<{ top: number; right: number } | null>(null)
  useLayoutEffect(() => {
    function updatePosition() {
      const el = anchorRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRef])

  const { data: allSetlists = [] } = useQuery({ queryKey: ['setlists'], queryFn: listSetlists })
  const { data: memberships = [] } = useQuery({
    queryKey: ['setlist-memberships'],
    queryFn: listPieceSetlistMemberships,
  })
  const myMemberships = useMemo(() => memberships.filter((m) => m.pieceId === pieceId), [memberships, pieceId])
  const checkedIds = useMemo(() => new Set(myMemberships.map((m) => m.setlistId)), [myMemberships])

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['setlist-memberships'] })
    queryClient.invalidateQueries({ queryKey: ['setlists'] })
  }
  const addMutation = useMutation({
    mutationFn: (setlistId: number) => addSetlistEntry(setlistId, { pieceId }),
    onSuccess: invalidate,
    onError: (error) => {
      window.alert(error instanceof ApiError ? error.message : 'Could not add this piece to the setlist.')
    },
  })
  const removeMutation = useMutation({
    mutationFn: ({ setlistId, entryId }: { setlistId: number; entryId: number }) =>
      removeSetlistEntry(setlistId, entryId),
    onSuccess: invalidate,
    onError: (error) => {
      window.alert(error instanceof ApiError ? error.message : 'Could not remove this piece from the setlist.')
    },
  })
  const pending = addMutation.isPending || removeMutation.isPending

  function toggle(setlist: Setlist) {
    if (checkedIds.has(setlist.id)) {
      const membership = myMemberships.find((m) => m.setlistId === setlist.id)
      if (membership) removeMutation.mutate({ setlistId: setlist.id, entryId: membership.entryId })
    } else {
      addMutation.mutate(setlist.id)
    }
  }

  const quickList = useMemo(() => getUpcomingSetlists(allSetlists, 5), [allSetlists])
  const quickListIds = useMemo(() => new Set(quickList.map((s) => s.id)), [quickList])

  // The search universe is deliberately "everything not already shown in
  // the quick list below" — that's what makes it a search for *unlisted*
  // setlists, not just a second way to reach the same handful.
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allSetlists.filter((s) => !quickListIds.has(s.id) && (q === '' || s.name.toLowerCase().includes(q)))
  }, [allSetlists, quickListIds, query])

  // +1 slot for the always-pinned "New Setlist…" row at the end.
  const navigableCount = searchResults.length + 1

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      if (searchOpen) {
        event.preventDefault()
        event.stopPropagation()
        setSearchOpen(false)
      }
      return
    }
    if (!searchOpen) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlighted((h) => (h + 1) % navigableCount)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlighted((h) => (h - 1 + navigableCount) % navigableCount)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (highlighted < searchResults.length) toggle(searchResults[highlighted])
      // Highlighting the pinned "New Setlist…" row and pressing Enter is a
      // no-op here, same as clicking it — real creation is Phase 15's own
      // scope (the real Edit Setlist modal isn't ported yet).
    }
  }

  // Prevents the input's onBlur from firing (and closing the dropdown)
  // before a click on one of its own rows registers — the standard
  // mousedown-preventDefault fix for this exact combobox race.
  function keepInputFocused(event: ReactMouseEvent) {
    event.preventDefault()
  }

  if (!position) return null

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', top: position.top, right: position.right }}
      className="z-20 w-64 overflow-hidden rounded-md border border-border bg-paper-raised py-2 text-left shadow-lg"
    >
      <div className="mb-2 flex items-center justify-between px-3">
        <span className="text-xs font-medium text-ink-soft">Add to Setlist</span>
        <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer text-ink-soft hover:text-ink">
          <IconXFilled size={13} />
        </button>
      </div>

      <div className="relative px-3">
        <div className="relative">
          <IconSearch size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-soft/60" />
          <input
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setSearchOpen(true)
              setHighlighted(0)
            }}
            onFocus={() => {
              setSearchOpen(true)
              setHighlighted(0)
            }}
            onBlur={() => setSearchOpen(false)}
            onKeyDown={onInputKeyDown}
            placeholder="Search setlists…"
            aria-label="Search setlists"
            className="w-full rounded-md border border-border bg-paper py-1.5 pr-2.5 pl-7 text-sm text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none"
          />
        </div>

        {searchOpen && (
          <div className="absolute top-full right-0 left-0 z-30 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-paper-raised py-1 shadow-lg">
            {searchResults.length === 0 && query.trim() !== '' && (
              <p className="px-3 py-1.5 text-xs text-ink-soft/60 italic">No matches</p>
            )}
            {searchResults.map((setlist, i) => (
              <SetlistToggleRow
                key={setlist.id}
                name={setlist.name}
                checked={checkedIds.has(setlist.id)}
                pending={pending}
                highlighted={highlighted === i}
                onMouseDown={keepInputFocused}
                onToggle={() => toggle(setlist)}
              />
            ))}
            <button
              type="button"
              onMouseDown={keepInputFocused}
              className={`flex w-full items-center gap-2 border-t border-border px-3 py-1.5 text-left text-sm text-ink-soft hover:bg-accent-soft hover:text-ink ${
                highlighted === searchResults.length ? 'bg-accent-soft text-ink' : ''
              }`}
            >
              <IconCalendarPlus size={14} />
              New Setlist…
            </button>
          </div>
        )}
      </div>

      <div className="mt-2 border-t border-border pt-1">
        {quickList.length === 0 ? (
          <p className="px-3 py-3 text-center text-sm text-ink-soft/60 italic">No upcoming sets</p>
        ) : (
          quickList.map((setlist) => (
            <SetlistToggleRow
              key={setlist.id}
              name={setlist.name}
              date={formatShortDate(setlist.gigDate)}
              checked={checkedIds.has(setlist.id)}
              pending={pending}
              onToggle={() => toggle(setlist)}
            />
          ))
        )}
      </div>
    </div>,
    document.body,
  )
}
