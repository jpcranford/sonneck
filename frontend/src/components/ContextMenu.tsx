import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent,
} from 'react'
import { IconDotsVerticalFilled } from '@tabler/icons-react'

export interface ContextMenuItem {
  label: string
  onSelect: () => void
  destructive?: boolean
}

export interface ContextMenuHandle {
  /** Opens the menu anchored at a viewport point — for a caller that wants
   * its own custom-positioned trigger instead of the built-in "⋯" button
   * (e.g. one anchored to an inner element, not the whole wrapped area). */
  open: (x: number, y: number) => void
}

interface ContextMenuProps {
  items: ContextMenuItem[]
  children: ReactNode
  /** Suppresses the built-in "⋯" button when a caller supplies its own
   * custom-positioned trigger via the forwarded ref instead. */
  hideTriggerButton?: boolean
}

// A long press holds for this long before it counts, matching the rough
// duration iOS/Android themselves use for their own long-press gestures —
// short enough to feel responsive, long enough not to fire on an ordinary
// tap-and-release.
const LONG_PRESS_MS = 500
// A touch that drifts more than this many px before LONG_PRESS_MS elapses
// is a scroll/drag, not a long-press — cancel the pending timer rather than
// opening the menu out from under a finger that's clearly scrolling.
const LONG_PRESS_MOVE_CANCEL_PX = 10

/**
 * Wraps children with a context menu — built once here so every place the
 * app needs one (piece cards, book rows, ...) shares the same popup
 * rendering, viewport-clamped positioning, dismiss-on-Escape, and
 * dismiss-on-outside-click behavior instead of each usage reimplementing
 * it. Three triggers by default: right-click (desktop), a long-press
 * (touch — implemented as a real touchstart/touchmove/touchend timer here,
 * not by relying on the browser mapping long-press to the `contextmenu`
 * event, which not every mobile browser does), and an always-visible "⋯"
 * button. Right-click and long-press always work anywhere on `children`;
 * the visible button can instead be a caller-owned custom-positioned
 * trigger via `hideTriggerButton` + the forwarded ref, or omitted
 * entirely when long-press is meant to be the only touch affordance (see
 * PieceGridCard, 2026-08-18 — removed its own thumbnail-anchored button
 * in favor of long-press, since a permanently-visible "⋯" read as clutter
 * on the grid's already-dense card).
 */
export const ContextMenu = forwardRef<ContextMenuHandle, ContextMenuProps>(function ContextMenu(
  { items, children, hideTriggerButton },
  ref,
) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  // A long-press that fires while the finger is still down still gets a
  // trailing synthetic `click` once it lifts — without this, that click
  // would fall through to whatever's under the finger (e.g. a card's own
  // navigate-on-click) right after the menu opens.
  const suppressNextClickRef = useRef(false)

  useImperativeHandle(ref, () => ({
    open: (x, y) => setPosition({ x, y }),
  }))

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  function onTouchStart(event: TouchEvent) {
    const touch = event.touches[0]
    touchStartRef.current = { x: touch.clientX, y: touch.clientY }
    clearLongPressTimer()
    longPressTimerRef.current = setTimeout(() => {
      suppressNextClickRef.current = true
      setPosition({ x: touch.clientX, y: touch.clientY })
      navigator.vibrate?.(10)
    }, LONG_PRESS_MS)
  }

  function onTouchMove(event: TouchEvent) {
    if (!touchStartRef.current || !longPressTimerRef.current) return
    const touch = event.touches[0]
    const dx = touch.clientX - touchStartRef.current.x
    const dy = touch.clientY - touchStartRef.current.y
    if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_CANCEL_PX) clearLongPressTimer()
  }

  useEffect(() => {
    if (!position) return

    const close = () => setPosition(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('scroll', close, true)
    }
  }, [position])

  // Clamps the menu back on-screen after it mounts, when the anchor point
  // (a right-click near a screen edge, or a trigger button that sits near a
  // card's own edge — closer to the viewport edge on narrow screens) would
  // otherwise render it partially or fully off-viewport. Runs after layout
  // but before paint, so there's no visible jump.
  useLayoutEffect(() => {
    if (!position || !menuRef.current) return
    const margin = 8
    const rect = menuRef.current.getBoundingClientRect()
    const clampedX = Math.min(position.x, window.innerWidth - rect.width - margin)
    const clampedY = Math.min(position.y, window.innerHeight - rect.height - margin)
    menuRef.current.style.left = `${Math.max(margin, clampedX)}px`
    menuRef.current.style.top = `${Math.max(margin, clampedY)}px`
  }, [position])

  return (
    <>
      <div
        className="relative [-webkit-touch-callout:none]"
        onContextMenu={(event) => {
          event.preventDefault()
          setPosition({ x: event.clientX, y: event.clientY })
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={clearLongPressTimer}
        onTouchCancel={clearLongPressTimer}
        onClickCapture={(event) => {
          if (!suppressNextClickRef.current) return
          suppressNextClickRef.current = false
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        {children}
        {!hideTriggerButton && (
          <button
            type="button"
            aria-label="More actions"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              setPosition({ x: rect.right, y: rect.bottom })
            }}
            className="absolute top-2 right-2 z-10 flex size-7 items-center justify-center rounded-md bg-paper-raised/90 text-ink-soft shadow-sm hover:text-ink"
          >
            <IconDotsVerticalFilled size={16} />
          </button>
        )}
      </div>
      {position && (
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-50 min-w-40 rounded-lg border border-border bg-paper-raised py-1 shadow-lg"
          style={{ top: position.y, left: position.x }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              onClick={() => {
                item.onSelect()
                setPosition(null)
              }}
              className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-paper ${
                item.destructive ? 'text-red-700' : 'text-ink'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  )
})
