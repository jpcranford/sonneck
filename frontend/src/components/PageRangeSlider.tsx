import { useId, useState, type CSSProperties } from 'react'
import {
  PAGES_TOP,
  pageRangeText,
  pageStopText,
  parsePageStop,
  type PageRange,
} from '../lib/pageRange'

// The piece libraries' Pages filter (design A of
// https://claude.ai/artifact/2uohZcztpi3ajke7bsZCrP): two knobs on one track
// from 1 to "12+", a page a step, and the two ends as fields under it to
// type into. Two real range inputs share the drawn track (index.css's
// .range-slider), so the keyboard and screen readers work as usual; only
// their knobs take the pointer, each with a 48pt grab area on touch.

const TICKS = [1, 4, 8, PAGES_TOP]

export function PageRangeSlider({
  value,
  onChange,
  count,
}: {
  value: PageRange
  onChange: (next: PageRange) => void
  /** How many pieces the range holds, for the line under it; left out
   * while unknown. */
  count?: number
}) {
  const id = useId()
  const span = PAGES_TOP - 1
  const left = ((value.min - 1) / span) * 100
  const right = ((value.max - 1) / span) * 100
  // A field being typed in keeps its own text until Enter or leaving it.
  const [draft, setDraft] = useState<{ end: 'min' | 'max'; text: string } | null>(null)
  function commit(end: 'min' | 'max', text: string) {
    setDraft(null)
    const n = parsePageStop(text)
    if (n === null) return
    if (end === 'min') onChange({ min: n, max: Math.max(n, value.max) })
    else onChange({ min: Math.min(n, value.min), max: n })
  }
  const field = (end: 'min' | 'max', label: string) => (
    <input
      id={`${id}-${end}`}
      aria-label={label}
      inputMode="numeric"
      value={draft?.end === end ? draft.text : pageStopText(value[end])}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft({ end, text: event.target.value })}
      onBlur={(event) => commit(end, event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit(end, event.currentTarget.value)
        if (event.key === 'Escape' && draft) {
          event.stopPropagation()
          setDraft(null)
        }
      }}
      className="h-9 w-14 rounded-md border border-border bg-paper-raised text-center text-sm text-ink tabular-nums outline-none focus:border-accent"
    />
  )
  return (
    <div className="range-slider-root flex flex-col">
      <div
        className="range-slider"
        style={{ '--range-from': `${left}%`, '--range-to': `${right}%` } as CSSProperties}
      >
        <div className="range-slider-track">
          <div className="range-slider-fill" />
        </div>
        <input
          type="range"
          min={1}
          max={PAGES_TOP}
          step={1}
          value={value.min}
          aria-label="Fewest pages"
          aria-valuetext={pageStopText(value.min)}
          onChange={(event) => {
            const min = Math.min(Number(event.target.value), value.max)
            onChange({ min, max: value.max })
          }}
          // At the top stop the low knob sits over the high one, so it can
          // still be dragged back down.
          style={{ zIndex: value.min === PAGES_TOP ? 3 : 1 }}
        />
        <input
          type="range"
          min={1}
          max={PAGES_TOP}
          step={1}
          value={value.max}
          aria-label="Most pages"
          aria-valuetext={pageStopText(value.max)}
          onChange={(event) => {
            const max = Math.max(Number(event.target.value), value.min)
            onChange({ min: value.min, max })
          }}
          style={{ zIndex: 2 }}
        />
      </div>
      <div
        className="range-slider-ticks text-[11px] text-ink-faint tabular-nums"
        aria-hidden="true"
      >
        {TICKS.map((t) => (
          <span key={t} style={{ left: `${((t - 1) / span) * 100}%` }}>
            {pageStopText(t)}
          </span>
        ))}
      </div>
      <div className="mt-1 flex items-center gap-2 text-sm text-ink-soft">
        {field('min', 'Fewest pages')}
        <span>to</span>
        {field('max', 'Most pages')}
        <span>pages</span>
      </div>
      {count !== undefined && (
        <p className="mt-2 text-xs text-ink-soft tabular-nums">
          {value.min <= 1 && value.max >= PAGES_TOP ? 'Any length' : pageRangeText(value)} •{' '}
          <span className="font-semibold text-ink">{count.toLocaleString()}</span>{' '}
          {count === 1 ? 'piece' : 'pieces'}
        </p>
      )}
    </div>
  )
}
