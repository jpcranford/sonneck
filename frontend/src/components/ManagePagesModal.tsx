import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { IconX } from '@tabler/icons-react'
import { Modal } from './Modal'
import { showAlert } from '../lib/dialogs'
import { shownRange } from '../lib/sheetViewerSpreads'

// Manage Pages (design B of https://claude.ai/artifact/38ezJE9QQLEA5PtzWXEgjQ,
// copied on /mockup/piece-details and /mockup/sheet-viewer):
// every page, wrapping onto rows, in a green frame around the ones the Sheet Viewer
// shows; dragging either handle inward skips pages from the start or the
// end. Opened from Piece Details and the Sheet Viewer's Display panel.

/** The strip's padding and the space between its pages, in px. */
const PAD = 14
const GAP = 6
/** At most this many pages a row, each this wide at least and at most. */
const COLS_MAX = 8
const CELL_MIN = 64
const CELL_MAX = 96

export function ManagePagesModal({
  open,
  onClose,
  title,
  credit,
  pageCount: n,
  skipStart,
  skipEnd,
  onSave,
  renderPage,
}: {
  open: boolean
  onClose: () => void
  title: string
  credit?: string
  pageCount: number
  skipStart: number
  skipEnd: number
  /** Saves; the window closes once it's done, and stays open on a failure. */
  onSave: (skipStart: number, skipEnd: number) => Promise<unknown>
  /** Page n as an image filling its box. */
  renderPage: (n: number) => ReactNode
}) {
  // Starts from what's saved each time it opens.
  const [start, setStart] = useState(skipStart)
  const [end, setEnd] = useState(skipEnd)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setStart(skipStart)
      setEnd(skipEnd)
    }
  }
  const [saving, setSaving] = useState(false)
  const { first, last } = shownRange(n, start, end)
  const skipped = start + end
  const stripRef = useRef<HTMLDivElement>(null)

  // Pages wrap onto rows of at most COLS_MAX, each page CELL_MIN to
  // CELL_MAX wide; the strip is no wider than its widest row needs.
  const [stripWidth, setStripWidth] = useState(0)
  const measureStrip = useCallback((el: HTMLDivElement | null) => {
    stripRef.current = el
    if (!el?.parentElement) return
    const parent = el.parentElement
    const observer = new ResizeObserver(() => setStripWidth(parent.clientWidth))
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])
  const fitCols = Math.floor((stripWidth - 2 * PAD + GAP) / (CELL_MIN + GAP))
  const cols = Math.max(1, Math.min(n, COLS_MAX, stripWidth ? fitCols : COLS_MAX))
  const rows = Array.from({ length: Math.ceil(n / cols) }, (_, r) => r * cols)

  // A page edge (0 to n) from a pointer: the row nearest it, then the
  // nearest edge between pages on that row.
  function edgeAt(x: number, y: number) {
    const rowEls = [...(stripRef.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])]
    let row: HTMLElement | undefined
    let best = Infinity
    for (const el of rowEls) {
      const r = el.getBoundingClientRect()
      const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0
      if (d < best) {
        best = d
        row = el
      }
    }
    if (!row) return 0
    const rowStart = Number(row.dataset.row)
    const len = Math.min(cols, n - rowStart)
    const box = row.getBoundingClientRect()
    const cell = (box.width - 2 * PAD - (cols - 1) * GAP) / cols
    const k = Math.round((x - box.left - PAD + GAP / 2) / (cell + GAP))
    return rowStart + Math.max(0, Math.min(k, len))
  }
  function moveTo(side: 'start' | 'end', edge: number) {
    if (side === 'start') setStart(Math.max(0, Math.min(edge, n - end - 1)))
    else setEnd(Math.max(0, Math.min(n - edge, n - start - 1)))
  }
  // A drag is captured on the strip, which stays put while a handle moves
  // to another row (and so is drawn anew).
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null)
  const handle = (side: 'start' | 'end') => (
    <button
      type="button"
      data-handle={side}
      aria-label={side === 'start' ? 'Skip pages at the start' : 'Skip pages at the end'}
      onPointerDown={(e) => {
        e.preventDefault()
        stripRef.current?.setPointerCapture(e.pointerId)
        setDragging(side)
      }}
      onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
        if (!d) return
        e.preventDefault()
        moveTo(side, side === 'start' ? start + d : n - end + d)
        // The handle may have moved to another row: keep it focused.
        requestAnimationFrame(() =>
          stripRef.current?.querySelector<HTMLElement>(`[data-handle="${side}"]`)?.focus(),
        )
      }}
      className={`pointer-events-auto absolute top-1/2 flex h-12 w-[22px] -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center gap-[3px] rounded-md bg-accent-fill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        side === 'start' ? '-left-[13px]' : '-right-[13px]'
      }`}
    >
      <span data-hit aria-hidden="true" className="hit-area" />
      <span className="h-[18px] w-0.5 rounded-full bg-white/75" />
      <span className="h-[18px] w-0.5 rounded-full bg-white/75" />
    </button>
  )
  // Where the edge before a row's page k sits, as a CSS length.
  const edgeX = (k: number) =>
    `(${PAD}px + (100% - ${2 * PAD + (cols - 1) * GAP}px) * ${k / cols} + ${k * GAP}px)`

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="manage-pages-title"
      size="lg"
      header={
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="manage-pages-title" className="font-display text-2xl font-medium text-ink">
              Manage Pages
            </h2>
            <p className="truncate text-sm text-ink-soft">
              {title}
              {credit ? ` \u2022 ${credit}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mt-1 shrink-0 cursor-pointer text-ink-soft hover:text-accent"
          >
            <IconX size={22} />
          </button>
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <span className="mr-auto text-sm text-ink-soft">
            {skipped ? (
              <>
                Sheet Viewer shows{' '}
                <span className="font-medium text-ink">
                  pages {first}&ndash;{last}
                </span>{' '}
                &bull; {skipped} skipped
              </>
            ) : (
              <>
                Sheet Viewer shows <span className="font-medium text-ink">all {n} pages</span>
              </>
            )}
          </span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => {
                setStart(0)
                setEnd(0)
              }}
              disabled={!skipped}
              className="cursor-pointer text-sm text-accent underline underline-offset-2 disabled:text-ink-fainter disabled:no-underline"
            >
              Show all
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display font-medium text-ink hover:border-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setSaving(true)
                  onSave(start, end)
                    .then(onClose)
                    .catch((err: unknown) =>
                      showAlert(
                        err instanceof Error ? err.message : 'The pages couldn\u2019t be saved.',
                        'Couldn\u2019t save',
                      ),
                    )
                    .finally(() => setSaving(false))
                }}
                disabled={saving || (start === skipStart && end === skipEnd)}
                className="cursor-pointer rounded-md bg-accent-fill px-4 py-2 font-display font-medium text-white hover:bg-accent-fill/90 disabled:opacity-50"
              >
                {saving ? 'Saving\u2026' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">
          Drag the handles to skip pages at the start or end: a cover, a title page, a
          publisher&rsquo;s catalogue. The Sheet Viewer only displays the pages inside the frame.
        </p>
        <div
          ref={measureStrip}
          onPointerMove={(e) => {
            if (dragging) moveTo(dragging, edgeAt(e.clientX, e.clientY))
          }}
          onPointerUp={() => setDragging(null)}
          onPointerCancel={() => setDragging(null)}
          onLostPointerCapture={() => setDragging(null)}
          className="mx-auto flex w-full touch-none flex-col rounded-lg bg-paper-sunken py-1.5 select-none"
          style={{ maxWidth: cols * CELL_MAX + (cols - 1) * GAP + 2 * PAD }}
        >
          {rows.map((rowStart) => {
            const len = Math.min(cols, n - rowStart)
            // The shown pages on this row, 0-based within it.
            const a = Math.max(first - 1, rowStart) - rowStart
            const b = Math.min(last - 1, rowStart + len - 1) - rowStart
            const hasFirst = first - 1 >= rowStart && first - 1 < rowStart + len
            const hasLast = last - 1 >= rowStart && last - 1 < rowStart + len
            return (
              <div
                key={rowStart}
                data-row={rowStart}
                className="relative grid py-1.5"
                style={{
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  gap: GAP,
                  paddingInline: PAD,
                }}
              >
                {Array.from({ length: len }, (_, i) => rowStart + i + 1).map((p) => {
                  const off = p < first || p > last
                  return (
                    <div key={p} className="flex min-w-0 flex-col items-center gap-1.5">
                      <div
                        className={`aspect-[612/792] w-full overflow-hidden rounded-sm bg-white shadow-sm transition-opacity ${
                          off ? 'opacity-30' : ''
                        }`}
                      >
                        {renderPage(p)}
                      </div>
                      <span
                        className={`text-xs tabular-nums ${off ? 'text-ink-fainter' : 'text-ink-soft'}`}
                      >
                        {p}
                      </span>
                    </div>
                  )
                })}
                {/* This row's part of the frame around the shown pages. It's
                    open on a side where the run carries on to another row; a
                    handle sits on the first page's side and the last's. */}
                {a <= b && (
                  <div
                    className={`pointer-events-none absolute top-0.5 bottom-[26px] border-y-[3px] border-accent-fill ${
                      hasFirst ? 'rounded-l-lg border-l-[3px]' : ''
                    } ${hasLast ? 'rounded-r-lg border-r-[3px]' : ''}`}
                    style={{
                      left: `calc(${edgeX(a)} - 6px)`,
                      right: `calc(100% - ${edgeX(b + 1)} + ${GAP}px - 6px)`,
                    }}
                  >
                    {hasFirst && handle('start')}
                    {hasLast && handle('end')}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}
