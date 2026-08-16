import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
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

/**
 * Wraps children with a context menu — built once here so every place the
 * app needs one (piece cards, book rows, ...) shares the same popup
 * rendering, viewport-clamped positioning, dismiss-on-Escape, and
 * dismiss-on-outside-click behavior instead of each usage reimplementing
 * it. Two triggers by default: right-click (desktop), and an always-visible
 * "⋯" button (device-aware conventions, CLAUDE.md > Frontend — right-click
 * has no reliable touch equivalent, some mobile browsers map long-press to
 * the contextmenu event and many don't, so a real tappable affordance is
 * needed rather than relying on long-press alone). Right-click always works
 * anywhere on `children`; the visible button can instead be a caller-owned
 * custom-positioned trigger via `hideTriggerButton` + the forwarded ref,
 * for when it needs to anchor to a specific inner element rather than the
 * whole wrapped area (see PieceGridCard's bottom-right-of-thumbnail trigger).
 */
export const ContextMenu = forwardRef<ContextMenuHandle, ContextMenuProps>(function ContextMenu(
  { items, children, hideTriggerButton },
  ref,
) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useImperativeHandle(ref, () => ({
    open: (x, y) => setPosition({ x, y }),
  }))

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
        className="relative"
        onContextMenu={(event) => {
          event.preventDefault()
          setPosition({ x: event.clientX, y: event.clientY })
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
