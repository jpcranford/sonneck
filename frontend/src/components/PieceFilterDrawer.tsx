import { IconX } from '@tabler/icons-react'
import type { PieceFacets } from '../api/pieces'
import type { PieceFilterState } from '../lib/pieceFilterState'

// Real build of PieceLibrarySample.tsx's own FilterDrawer (mockup approved
// 2026-08-27, Option B of a 4-option comparison) — same backdrop/slide
// mechanics as MobileNavDrawer, mirrored to the right edge. Live-updating
// (every checkbox writes straight into filters, no separate draft state),
// per the mockup's own iteration. PieceFilterState/EMPTY_PIECE_FILTERS/
// activePieceFilterCount live in lib/pieceFilterState.ts, not here
// (react-refresh/only-export-components — CLAUDE.md > Frontend).

function toggleInArray<T>(arr: T[], value: T): T[] {
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

        <div className="flex-1 overflow-y-auto px-4 py-2">
          {facets && (
            <>
              {(!hideFavorite || !hideBookless || !hideHasImslpNumber) && (
                <FacetSection title="Show only">
                  {!hideFavorite && (
                    <FacetRow
                      label="Favorites"
                      count={facets.favorite}
                      checked={filters.favorite}
                      onChange={() => onChange({ ...filters, favorite: !filters.favorite })}
                    />
                  )}
                  {!hideBookless && (
                    <FacetRow
                      label="Bookless pieces"
                      count={facets.bookless}
                      checked={filters.bookless}
                      onChange={() => onChange({ ...filters, bookless: !filters.bookless })}
                    />
                  )}
                  {!hideHasImslpNumber && (
                    <FacetRow
                      label="Has IMSLP number"
                      count={facets.hasImslpNumber}
                      checked={filters.hasImslpNumber}
                      onChange={() => onChange({ ...filters, hasImslpNumber: !filters.hasImslpNumber })}
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
                      checked={filters.userTagId.includes(v.id)}
                      onChange={() => onChange({ ...filters, userTagId: toggleInArray(filters.userTagId, v.id) })}
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
                      checked={filters.practiceStatus.includes(v.status)}
                      onChange={() =>
                        onChange({ ...filters, practiceStatus: toggleInArray(filters.practiceStatus, v.status) })
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

              {facets.keys.length > 0 && (
                <FacetSection title="Key">
                  {facets.keys.map((k) => (
                    <FacetRow
                      key={k.id}
                      label={k.name}
                      count={k.count}
                      checked={filters.keyId.includes(k.id)}
                      onChange={() => onChange({ ...filters, keyId: toggleInArray(filters.keyId, k.id) })}
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
