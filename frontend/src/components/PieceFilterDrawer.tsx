import { IconMinus, IconPlus, IconSlash, IconX } from '@tabler/icons-react'
import type { PieceFacets } from '../api/pieces'
import { dimensionState, setDimensionState, type PieceFilterState, type TriState } from '../lib/pieceFilterState'

// Real build of PieceLibrarySample.tsx's own FilterDrawer (mockup approved
// 2026-08-27, Option B of a 4-option comparison). Live-updating (every
// change writes straight into filters, no separate draft state), per the
// mockup's own iteration. PieceFilterState/EMPTY_PIECE_FILTERS/
// activePieceFilterCount live in lib/pieceFilterState.ts, not here
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

export function PieceFilterDrawer({
  open,
  facets,
  filters,
  onChange,
  onClose,
  onClear,
  hideFavorite = false,
  hideBookless = false,
  hideHasImslpNumber = false,
  hidePracticeStatus = false,
}: {
  open: boolean
  facets: PieceFacets | undefined
  filters: PieceFilterState
  onChange: (next: PieceFilterState) => void
  onClose: () => void
  onClear: () => void
  /** Hides a "Show only"/facet row already fixed by the page itself (e.g.
   * the Favorites page always sends favorite=true, and the Currently
   * Practicing page always sends a fixed practiceStatus) — showing a
   * redundant, already-true checkbox there would just be confusing, not a
   * real additional filter the user could meaningfully toggle. */
  hideFavorite?: boolean
  hideBookless?: boolean
  hideHasImslpNumber?: boolean
  hidePracticeStatus?: boolean
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
          two keys, for example, matches pieces in either. Different sections, and any excluded option, must all
          match.
        </p>

        <div className="flex-1 overflow-y-auto px-4 py-2">
          {facets && (
            <>
              {(!hideFavorite || !hideBookless || !hideHasImslpNumber) && (
                <FacetSection title="Show only">
                  {!hideFavorite && (
                    <FacetRow
                      label="Favorites"
                      count={facets.favorite}
                      state={filters.favorite}
                      onChange={(next) => onChange({ ...filters, favorite: next })}
                    />
                  )}
                  {!hideBookless && (
                    <FacetRow
                      label="Bookless pieces"
                      count={facets.bookless}
                      state={filters.bookless}
                      onChange={(next) => onChange({ ...filters, bookless: next })}
                    />
                  )}
                  {!hideHasImslpNumber && (
                    <FacetRow
                      label="Has IMSLP number"
                      count={facets.hasImslpNumber}
                      state={filters.hasImslpNumber}
                      onChange={(next) => onChange({ ...filters, hasImslpNumber: next })}
                    />
                  )}
                </FacetSection>
              )}

              {facets.userTags.length > 0 && (
                <FacetSection title="Your Tags">
                  {facets.userTags.map((v) => (
                    <FacetRow
                      key={v.id}
                      label={v.name}
                      count={v.count}
                      state={dimensionState(filters.userTagId, String(v.id))}
                      onChange={(next) =>
                        onChange({ ...filters, userTagId: setDimensionState(filters.userTagId, String(v.id), next) })
                      }
                    />
                  ))}
                </FacetSection>
              )}

              {!hidePracticeStatus && facets.practiceStatuses.length > 0 && (
                <FacetSection title="Practice Status">
                  {facets.practiceStatuses.map((v) => (
                    <FacetRow
                      key={v.status}
                      label={v.status}
                      count={v.count}
                      state={dimensionState(filters.practiceStatus, v.status)}
                      onChange={(next) =>
                        onChange({ ...filters, practiceStatus: setDimensionState(filters.practiceStatus, v.status, next) })
                      }
                    />
                  ))}
                </FacetSection>
              )}

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

              {facets.keys.length > 0 && (
                <FacetSection title="Key">
                  {facets.keys.map((k) => (
                    <FacetRow
                      key={k.id}
                      label={k.name}
                      count={k.count}
                      state={dimensionState(filters.keyId, String(k.id))}
                      onChange={(next) => onChange({ ...filters, keyId: setDimensionState(filters.keyId, String(k.id), next) })}
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
