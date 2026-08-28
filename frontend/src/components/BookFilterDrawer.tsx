import { IconX } from '@tabler/icons-react'
import type { BookFacets } from '../api/books'
import type { BookFilterState } from '../lib/bookFilterState'

// Real build of BooksLibrarySample.tsx's own BookFilterDrawer — same
// system as PieceFilterDrawer.tsx, adjusted for Books' own (much lighter)
// filter facets: Sheet Type and Instrument only, no Key/tags/Favorite/
// Practice Status (those are piece-only fields, design doc §3's Naming/
// architecture note), so there's no "Show only" boolean section the way
// Pieces' drawer has one. BookFilterState/EMPTY_BOOK_FILTERS/
// activeBookFilterCount live in lib/bookFilterState.ts, not here
// (react-refresh/only-export-components — CLAUDE.md > Frontend).

function toggleInArray(arr: number[], value: number): number[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]
}

function FacetSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border py-3 last:border-b-0">
      <p className="mb-1.5 text-xs font-semibold tracking-wide text-ink-soft uppercase">{title}</p>
      <div className="flex flex-col">{children}</div>
    </div>
  )
}

function FacetRow({
  label,
  count,
  checked,
  onChange,
}: {
  label: string
  count: number
  checked: boolean
  onChange: () => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1.5 text-sm text-ink hover:bg-paper-sunken">
      <input type="checkbox" checked={checked} onChange={onChange} className="accent-accent" />
      <span className="flex-1">{label}</span>
      <span className="text-xs text-ink-soft tabular-nums">{count}</span>
    </label>
  )
}

export function BookFilterDrawer({
  open,
  facets,
  filters,
  onChange,
  onClose,
  onClear,
}: {
  open: boolean
  facets: BookFacets | undefined
  filters: BookFilterState
  onChange: (next: BookFilterState) => void
  onClose: () => void
  onClear: () => void
}) {
  return (
    <>
      <div
        aria-hidden={!open}
        className={`fixed inset-0 z-40 bg-ink/40 backdrop-blur-[1px] transition-opacity duration-200 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-label="Filters"
        className={`fixed inset-y-0 right-0 z-50 flex w-80 max-w-[88vw] flex-col border-l border-border bg-paper-raised shadow-xl transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3.5">
          <h2 className="font-display text-base font-medium text-ink">Filters</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="flex size-8 cursor-pointer items-center justify-center rounded-md text-ink-soft hover:bg-paper-sunken hover:text-ink"
          >
            <IconX size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2">
          {facets && (
            <>
              {facets.sheetTypes.length > 0 && (
                <FacetSection title="Sheet Type">
                  {facets.sheetTypes.map((v) => (
                    <FacetRow
                      key={v.id}
                      label={v.name}
                      count={v.count}
                      checked={filters.sheetTypeId.includes(v.id)}
                      onChange={() =>
                        onChange({ ...filters, sheetTypeId: toggleInArray(filters.sheetTypeId, v.id) })
                      }
                    />
                  ))}
                </FacetSection>
              )}

              {facets.instruments.length > 0 && (
                <FacetSection title="Instrument">
                  {facets.instruments.map((v) => (
                    <FacetRow
                      key={v.id}
                      label={v.name}
                      count={v.count}
                      checked={filters.instrumentId.includes(v.id)}
                      onChange={() =>
                        onChange({ ...filters, instrumentId: toggleInArray(filters.instrumentId, v.id) })
                      }
                    />
                  ))}
                </FacetSection>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center border-t border-border px-4 py-3.5">
          <button
            type="button"
            onClick={onClear}
            className="w-full cursor-pointer rounded-md border border-border bg-paper-raised px-3 py-2 text-sm font-medium text-ink hover:border-accent"
          >
            Clear all filters
          </button>
        </div>
      </aside>
    </>
  )
}
