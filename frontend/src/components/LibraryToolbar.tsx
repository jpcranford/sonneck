import { useRef, type ReactNode } from 'react'
import { IconAdjustmentsHorizontal, IconPlus, IconSearch } from '@tabler/icons-react'
import { SortControl, type SortDirection, type SortFieldOption } from './SortControl'
import { WIDE_CONTENT_MAX_W } from '../lib/layout'
import { PageToolbarPortal } from './PageToolbarSlot'
import { ViewModeToggle } from './ViewModeToggle'
import { useShortcuts, FILTERS_KEY } from '../lib/shortcuts'

/**
 * Shared toolbar for the Piece/Book/Person Library pages — search
 * (centered, capped at max-w-xl), a paired optional "+New X" button that
 * rides Search's own right edge, Filters+Sort right-aligned, view toggle
 * left-aligned. Several things here look like they could be simplified
 * but aren't:
 *
 * - From `sm:` the grid is `auto 1fr auto`: the toggle and the
 *   Filters+Sort cluster each take exactly their own width, and Search's
 *   middle track takes the rest. The right track sizes to whatever is
 *   there now — the current sort label, Filters' label, its active-count
 *   badge — so there's never a gap in front of Filters or an ellipsis in
 *   the sort label, whichever field is picked. (It used to be a hand-
 *   measured px width per library, sized for one label: a shorter one,
 *   like "Title", left a gap beside Search, and the count badge cut the
 *   longest one off.) Accepted cost: while Search is below its cap,
 *   picking a sort field with a different label length nudges Search's
 *   width. Never make that side `minmax(N,1fr)` — a second flexible
 *   track claims leftover space and drifts Filters away from Search as
 *   the window widens (a real, confirmed bug); `auto` takes only what its
 *   content needs.
 * - `SortControl.tsx`'s own field-picker dropdown is anchored `right-0`
 *   (not the default left-aligned), since Sort always sits at this
 *   toolbar's own right edge — a real bug found alongside the one above:
 *   the dropdown's `min-w-[150px]` routinely needs to be wider than the
 *   currently-selected field's own (possibly much narrower) button, and
 *   without `right-0` it grew rightward off past the viewport/container
 *   edge instead of leftward into the room the toolbar's own left-hand
 *   content already keeps clear.
 * - The Search+optional-newButton wrapper is `w-full` (so Search's
 *   `flex-1` has the whole track to grow into) with `justify-content:
 *   center` on the flex row itself (not `justify-self-center` on the
 *   wrapper, which does nothing once the wrapper already fills its whole
 *   track) — this is what makes the pair float centered as a unit once
 *   Search hits its cap, instead of packing flex-start with all the
 *   leftover space trailing after the New button.
 * - Below `sm:` the toggle and Filters+Sort share the first row, which a
 *   long sort field ("Year Published") overflows on the narrowest phones.
 *   So the 1fr track is `minmax(0,1fr)`, the Filters+Sort side is capped
 *   at `max-w-full` with `min-w-0` down through SortControl, Filters drops
 *   its label under 390px, and only then (320–340px) does the sort name
 *   shorten with an ellipsis. Checked against every sort field of all
 *   three libraries at widths from 320px to 2400px.
 * - `newButton` is never icon-only, unlike Filters — don't add a
 *   responsive icon-only variant for it later without checking that's
 *   still wanted.
 * - Breakpoints are `sm:`/`2xl:`, matching Piece's original proven design
 *   exactly — an `lg:`-based attempt to smooth out the real (but narrow)
 *   Search-width dip right at `md:768` (where the sidebar appears) was
 *   tried and explicitly reverted; that dip is accepted, not a bug to
 *   re-litigate.
 * - A custom arbitrary breakpoint (`min-[Npx]:`) was tried for the
 *   Filters-label squeeze band and abandoned — it doesn't reliably sort
 *   against a named breakpoint (`sm:`) in this project's Tailwind build
 *   (confirmed in the compiled stylesheet: the arbitrary rule landed
 *   *before* `sm:`'s, so `sm:` silently won past both thresholds even
 *   where the arbitrary one was the narrower, more specific match). Only
 *   real named breakpoints (`sm:`/`2xl:`) are used here for that reason.
 */
export function LibraryToolbar<Field extends string>({
  query,
  onQueryChange,
  searchPlaceholder,
  activeFilterCount,
  onOpenFilters,
  sortFields,
  sortField,
  sortDirection,
  onSortFieldChange,
  onSortDirectionToggle,
  sortDirectionLabel,
  viewMode,
  onViewModeChange,
  newButton,
  shortcutTitle,
  children,
}: {
  query: string
  onQueryChange: (value: string) => void
  searchPlaceholder: string
  activeFilterCount: number
  onOpenFilters: () => void
  sortFields: SortFieldOption<Field>[]
  sortField: Field
  sortDirection: SortDirection
  onSortFieldChange: (field: Field) => void
  onSortDirectionToggle: () => void
  sortDirectionLabel: string
  viewMode: 'grid' | 'list'
  onViewModeChange: (mode: 'grid' | 'list') => void
  /** Pairs with Search — same row as Search at narrow widths, immediately
   * to its right at wide ones. Never icon-only. Omit entirely for a
   * library (Piece) with no "create new" toolbar action, and when the
   * viewer lacks the permission it needs — hidden, not faded, like every
   * permission-gated control. */
  newButton?: { label: string; onClick: () => void }
  /** The page's name in the shortcut help ("Library", "Books"). */
  shortcutTitle: string
  /** Filter-pills row, rendered below the main toolbar row — left as
   * children since each domain's own filter-pill shape differs. */
  children?: ReactNode
}) {
  // Keyboard shortcuts (lib/shortcuts.ts — ignored while typing or with a
  // window open). A quick tap of / jumps to search; holding it shows the
  // shortcut list.
  const searchRef = useRef<HTMLInputElement>(null)
  const sortTriggerRef = useRef<HTMLButtonElement>(null)
  useShortcuts(
    [
      { key: '/', label: 'Search (tap)', run: () => searchRef.current?.focus() },
      {
        key: 'v',
        label: viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view',
        run: () => onViewModeChange(viewMode === 'grid' ? 'list' : 'grid'),
      },
      { key: FILTERS_KEY, label: 'Filters', run: onOpenFilters },
      {
        key: 'o',
        label: 'Sort by…',
        run: () => {
          sortTriggerRef.current?.focus()
          sortTriggerRef.current?.click()
        },
      },
      { key: 'r', label: 'Reverse the sort', run: onSortDirectionToggle },
      ...(newButton
        ? [
            {
              key: 'n',
              label: newButton.label,
              run: newButton.onClick,
            },
          ]
        : []),
    ],
    { title: shortcutTitle },
  )

  return (
    <PageToolbarPortal>
      <div className="border-b border-border bg-paper">
        <div className={`${WIDE_CONTENT_MAX_W} flex flex-col gap-3 p-4`}>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[auto_1fr_auto]">
            <ViewModeToggle
              value={viewMode}
              onChange={onViewModeChange}
              className="col-start-1 row-start-1 justify-self-start sm:col-start-auto sm:row-start-auto"
            />

            <div className="col-span-2 row-start-2 flex w-full min-w-0 items-center justify-center gap-3 sm:col-span-1 sm:row-start-auto">
              <div className="relative min-w-0 max-w-xl flex-1">
                <IconSearch
                  size={16}
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft"
                />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(event) => onQueryChange(event.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full rounded-md border border-border bg-paper-raised py-2 pr-3 pl-9 text-sm text-ink"
                />
              </div>

              {newButton && (
                <button
                  type="button"
                  onClick={newButton.onClick}
                  className="flex h-[38px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-paper-raised px-3 text-sm text-ink hover:bg-paper-hover"
                >
                  <IconPlus size={16} />
                  {newButton.label}
                </button>
              )}
            </div>

            <div className="col-start-2 row-start-1 flex max-w-full min-w-0 items-center justify-self-end gap-3 sm:col-start-auto sm:row-start-auto">
              <button
                type="button"
                onClick={onOpenFilters}
                aria-label="Filters"
                className={`flex h-[38px] cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm ${
                  activeFilterCount > 0
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border bg-paper-raised text-ink hover:bg-paper-hover'
                }`}
              >
                <IconAdjustmentsHorizontal size={16} />
                <span className="inline max-[389px]:hidden sm:hidden 2xl:inline">Filters</span>
                {activeFilterCount > 0 && (
                  <span className="flex size-4 items-center justify-center rounded-full bg-accent-fill text-[0.65rem] font-semibold text-white">
                    {activeFilterCount}
                  </span>
                )}
              </button>

              <SortControl
                fields={sortFields}
                field={sortField}
                direction={sortDirection}
                onFieldChange={onSortFieldChange}
                onDirectionToggle={onSortDirectionToggle}
                directionLabel={sortDirectionLabel}
                triggerRef={sortTriggerRef}
              />
            </div>
          </div>

          {children}
        </div>
      </div>
    </PageToolbarPortal>
  )
}
