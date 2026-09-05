import { IconMinus, IconPlus, IconSlash, IconX } from '@tabler/icons-react'
import type { BookFacets } from '../api/books'
import { dimensionState, setDimensionState, type BookFilterState, type TriState } from '../lib/bookFilterState'

// Real build of BooksLibrarySample.tsx's own BookFilterDrawer — same
// system as PieceFilterDrawer.tsx, adjusted for Books' own (much lighter)
// filter facets: Sheet Type and Instrument only, no Key/tags/Favorite/
// Practice Status (those are piece-only fields, design doc §3's Naming/
// architecture note), so there's no "Show only" boolean section the way
// Pieces' drawer has one. BookFilterState/EMPTY_BOOK_FILTERS/
// activeBookFilterCount live in lib/bookFilterState.ts, not here
// (react-refresh/only-export-components — CLAUDE.md > Frontend).
//
// Segmented exclude/neutral/include control per row (direct request,
// 2026-09-05, ported from the mockup once approved there — see
// PieceLibrarySample.tsx's own TriStateControl comment for the full
// reasoning) replaces the old plain checkbox.

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
  state,
  onChange,
}: {
  label: string
  count: number
  state: TriState
  onChange: (next: TriState) => void
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-md px-1 py-1.5 text-sm text-ink">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-xs text-ink-soft tabular-nums">{count}</span>
      <TriStateControl state={state} onChange={onChange} label={label} />
    </div>
  )
}

function TriStateControl({ state, onChange, label }: { state: TriState; onChange: (next: TriState) => void; label: string }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border p-0.5">
      <button
        type="button"
        onClick={() => onChange('exclude')}
        aria-label={`Exclude ${label}`}
        aria-pressed={state === 'exclude'}
        className={`flex size-6 cursor-pointer items-center justify-center rounded ${
          state === 'exclude' ? 'bg-red-50 text-red-700' : 'text-ink-soft hover:bg-paper-sunken hover:text-ink'
        }`}
      >
        <IconMinus size={14} />
      </button>
      <button
        type="button"
        onClick={() => onChange('neutral')}
        aria-label={`Clear ${label} filter`}
        aria-pressed={state === 'neutral'}
        className={`flex size-6 cursor-pointer items-center justify-center rounded ${
          state === 'neutral' ? 'bg-paper-sunken text-ink' : 'text-ink-soft hover:bg-paper-sunken hover:text-ink'
        }`}
      >
        <IconSlash size={14} />
      </button>
      <button
        type="button"
        onClick={() => onChange('include')}
        aria-label={`Include ${label}`}
        aria-pressed={state === 'include'}
        className={`flex size-6 cursor-pointer items-center justify-center rounded ${
          state === 'include' ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-paper-sunken hover:text-ink'
        }`}
      >
        <IconPlus size={14} />
      </button>
    </div>
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

        <p className="shrink-0 border-b border-border px-4 py-2.5 text-xs leading-snug text-ink-soft">
          Included options within a section combine with <span className="font-medium text-ink">or</span> — checking
          two sheet types, for example, matches books with either. Different sections, and any excluded option, must
          all match.
        </p>

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
                      state={dimensionState(filters.sheetTypeId, String(v.id))}
                      onChange={(next) =>
                        onChange({ ...filters, sheetTypeId: setDimensionState(filters.sheetTypeId, String(v.id), next) })
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
                      state={dimensionState(filters.instrumentId, String(v.id))}
                      onChange={(next) =>
                        onChange({ ...filters, instrumentId: setDimensionState(filters.instrumentId, String(v.id), next) })
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
