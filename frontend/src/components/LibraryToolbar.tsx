import { type ReactNode } from 'react'
import {
  IconAdjustmentsHorizontal,
  IconLayoutGridFilled,
  IconLayoutListFilled,
  IconPlus,
  IconSearch,
} from '@tabler/icons-react'
import { SortControl, type SortDirection, type SortFieldOption } from './SortControl'
import { WIDE_CONTENT_MAX_W } from '../lib/layout'

/**
 * Shared toolbar for the Piece/Book/Person Library pages — search
 * (centered, capped at max-w-xl), a paired optional "+New X" button that
 * rides Search's own right edge, Filters+Sort right-aligned, view toggle
 * left-aligned. Full design history (every dead end, every direct
 * correction) is in memory `project_responsive_device_plan.md` — read
 * that before changing this component, since several things here look
 * like they could be simplified but aren't:
 *
 * - The middle grid track is `1fr`, the two side tracks are rigid exact
 *   values (`auto` for the toggle, a directly-measured exact px for
 *   Filters+Sort, via `rightColumnGridColsClassName`) — never make the
 *   Filters+Sort side `minmax(N,1fr)` again, that was a real, confirmed
 *   bug: a second flexible track lets it independently claim leftover
 *   grid space instead of the two 1fr-ish columns sharing it evenly,
 *   silently drifting Filters away from Sort's own neighbors as the
 *   viewport widens.
 * - `rightColumnGridColsClassName`'s two numbers are exact (icon-only
 *   tier / full-text tier), not a rounded-up guess — an earlier ~10px
 *   safety margin was itself the source of a small constant (non-growing)
 *   gap in front of Filters, visible even when Search was nowhere near
 *   its cap. Measure the real Filters+Sort rendered width per caller (it
 *   genuinely differs — People's shorter "Name" sort label needs a
 *   smaller floor than Piece/Books' "Date Added") and pass the actual
 *   number plus ~1px. **Measure with the WIDEST sort field label
 *   selected, not whatever the default field happens to be** — a real
 *   bug found live: measuring at the default ("Name"/"Date Added") and
 *   then selecting a longer field (e.g. "Piece Count") grows the segmented
 *   sort button past a floor sized for the shorter default, clipping it
 *   at the toolbar's right edge. Every caller's own sort-field list needs
 *   its own widest-label check, not just its default.
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
 * - `newButton` is never icon-only, unlike Filters (direct instruction)
 *   — don't add a responsive icon-only variant for it later without
 *   checking that's still wanted.
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
  rightColumnGridColsClassName,
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
   * library (Piece) with no "create new" toolbar action. */
  newButton?: { label: string; onClick: () => void }
  /** The literal `sm:grid-cols-[auto_1fr_Npx] 2xl:grid-cols-[auto_1fr_Mpx]`
   * class string, passed as a complete literal from the caller — not
   * assembled from separate numeric props. Tailwind's JIT only picks up
   * arbitrary-value classes that appear as complete literal strings
   * somewhere in scanned source; a template-literal-interpolated value
   * built from a numeric prop would silently compile to nothing (the
   * same "auto-track ignores a percentage child" class of bug found
   * earlier in this exact toolbar's history, different mechanism, same
   * root cause: Tailwind never seeing the literal string). N/M are the
   * Filters+Sort cluster's directly-measured exact px width, one value
   * per label-visibility tier — genuinely differ per caller (People's
   * shorter "Name" sort label needs a smaller floor than Piece/Books'
   * "Date Added"), never a rounded guess (an earlier ~10px safety margin
   * was itself the source of a small constant, non-growing gap in front
   * of Filters). */
  rightColumnGridColsClassName: string
  /** Filter-pills row, rendered below the main toolbar row — left as
   * children since each domain's own filter-pill shape differs. */
  children?: ReactNode
}) {
  return (
    <div className="sticky top-0 z-20 border-b border-border bg-paper">
      <div className={`${WIDE_CONTENT_MAX_W} flex flex-col gap-3 p-4`}>
        <div className={`grid grid-cols-[auto_1fr] items-center gap-3 ${rightColumnGridColsClassName}`}>
          <div className="col-start-1 row-start-1 flex shrink-0 items-center justify-self-start gap-1 rounded-md border border-border p-0.5 sm:col-start-auto sm:row-start-auto">
            <button
              type="button"
              onClick={() => onViewModeChange('grid')}
              aria-label="Grid view"
              aria-pressed={viewMode === 'grid'}
              className={`flex size-8 cursor-pointer items-center justify-center rounded ${
                viewMode === 'grid' ? 'bg-accent-soft text-accent' : 'text-ink-soft'
              }`}
            >
              <IconLayoutGridFilled size={16} />
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange('list')}
              aria-label="List view"
              aria-pressed={viewMode === 'list'}
              className={`flex size-8 cursor-pointer items-center justify-center rounded ${
                viewMode === 'list' ? 'bg-accent-soft text-accent' : 'text-ink-soft'
              }`}
            >
              <IconLayoutListFilled size={16} />
            </button>
          </div>

          <div className="col-span-2 row-start-2 flex w-full min-w-0 items-center justify-center gap-3 sm:col-span-1 sm:row-start-auto">
            <div className="relative min-w-0 max-w-xl flex-1">
              <IconSearch
                size={16}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft"
              />
              <input
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
                className="flex h-[38px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-paper-raised px-3 text-sm text-ink hover:border-accent hover:text-accent active:border-accent active:text-accent"
              >
                <IconPlus size={16} />
                {newButton.label}
              </button>
            )}
          </div>

          <div className="col-start-2 row-start-1 flex items-center justify-self-end gap-3 sm:col-start-auto sm:row-start-auto">
            <button
              type="button"
              onClick={onOpenFilters}
              aria-label="Filters"
              className={`flex h-[38px] cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm active:border-accent active:text-accent ${
                activeFilterCount > 0
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border bg-paper-raised text-ink hover:border-accent hover:text-accent'
              }`}
            >
              <IconAdjustmentsHorizontal size={16} />
              <span className="inline sm:hidden 2xl:inline">Filters</span>
              {activeFilterCount > 0 && (
                <span className="flex size-4 items-center justify-center rounded-full bg-accent text-[0.65rem] font-semibold text-white">
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
            />
          </div>
        </div>

        {children}
      </div>
    </div>
  )
}
