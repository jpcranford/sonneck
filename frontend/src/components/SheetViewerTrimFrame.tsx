import { useRef, type CSSProperties } from 'react'
import { dragTrim, type TrimBox, type TrimHandle } from '../lib/sheetViewerTrim'

// The Trim mode's frame on the page: the trimmed-away part dimmed, a white
// frame, and a handle on each side and corner (48pt to grab; a side's
// reaches along it between the corners). Its touches never turn the page.
const TRIM_HANDLES: TrimHandle[] = [
  'top',
  'bottom',
  'left',
  'right',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
]
const TRIM_CURSORS: Record<TrimHandle, string> = {
  top: 'ns-resize',
  bottom: 'ns-resize',
  left: 'ew-resize',
  right: 'ew-resize',
  'top-left': 'nwse-resize',
  'bottom-right': 'nwse-resize',
  'top-right': 'nesw-resize',
  'bottom-left': 'nesw-resize',
}
export function TrimFrame({ box, onChange }: { box: TrimBox; onChange: (box: TrimBox) => void }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    id: number
    handle: TrimHandle
    x: number
    y: number
    start: TrimBox
    width: number
    height: number
  } | null>(null)
  const pct = (v: number) => `${v * 100}%`
  const frame = {
    left: pct(box.left),
    top: pct(box.top),
    width: pct(box.right - box.left),
    height: pct(box.bottom - box.top),
  }
  // Each handle's tap area, centered on its side or corner.
  function area(handle: TrimHandle): CSSProperties {
    const side = handle.includes('-') ? null : handle
    if (side === 'top' || side === 'bottom') return { left: 24, right: 24, height: 48, [side]: -24 }
    if (side === 'left' || side === 'right') return { top: 24, bottom: 24, width: 48, [side]: -24 }
    const [v, h] = handle.split('-')
    return { width: 48, height: 48, [v]: -24, [h]: -24 }
  }
  // What's drawn: a bar at a side's middle, an L at a corner.
  function mark(handle: TrimHandle) {
    const shadow = '0 0 0 1px rgb(0 0 0 / 0.35)'
    if (handle === 'top' || handle === 'bottom')
      return (
        <span
          className="absolute top-1/2 left-1/2 h-1.5 w-9 -translate-1/2 rounded-full bg-white"
          style={{ boxShadow: shadow }}
        />
      )
    if (handle === 'left' || handle === 'right')
      return (
        <span
          className="absolute top-1/2 left-1/2 h-9 w-1.5 -translate-1/2 rounded-full bg-white"
          style={{ boxShadow: shadow }}
        />
      )
    const [v, h] = handle.split('-')
    return (
      <span
        className="absolute size-[18px] border-white"
        style={{
          [v]: 20,
          [h]: 20,
          [`border${v === 'top' ? 'Top' : 'Bottom'}Width`]: 4,
          [`border${h === 'left' ? 'Left' : 'Right'}Width`]: 4,
          filter: 'drop-shadow(0 0 1px rgb(0 0 0 / 0.5))',
        }}
      />
    )
  }
  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0">
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute outline-1 outline-white"
          style={{ ...frame, boxShadow: '0 0 0 9999px rgb(28 24 21 / 0.55)' }}
        />
      </div>
      <div className="absolute" style={frame}>
        {TRIM_HANDLES.map((handle) => (
          <span
            key={handle}
            data-hit
            aria-label={`Trim ${handle.replace('-', ' ')}`}
            className="pointer-events-auto absolute touch-none"
            style={{ ...area(handle), cursor: TRIM_CURSORS[handle] }}
            onPointerDown={(event) => {
              event.stopPropagation()
              const r = rootRef.current?.getBoundingClientRect()
              if (!r?.width) return
              event.currentTarget.setPointerCapture(event.pointerId)
              drag.current = {
                id: event.pointerId,
                handle,
                x: event.clientX,
                y: event.clientY,
                start: box,
                width: r.width,
                height: r.height,
              }
            }}
            onPointerMove={(event) => {
              const d = drag.current
              if (!d || d.id !== event.pointerId) return
              event.stopPropagation()
              onChange(
                dragTrim(
                  d.start,
                  d.handle,
                  (event.clientX - d.x) / d.width,
                  (event.clientY - d.y) / d.height,
                ),
              )
            }}
            onPointerUp={(event) => {
              event.stopPropagation()
              drag.current = null
            }}
            onPointerCancel={(event) => {
              event.stopPropagation()
              drag.current = null
            }}
          >
            {mark(handle)}
          </span>
        ))}
      </div>
    </div>
  )
}
