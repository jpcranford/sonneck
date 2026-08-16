import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface ContextMenuItem {
  label: string
  onSelect: () => void
  destructive?: boolean
}

interface ContextMenuProps {
  items: ContextMenuItem[]
  children: ReactNode
}

/**
 * Wraps children with a right-click context menu — built once here so
 * every place the app needs one (piece cards, book rows, ...) shares the
 * same positioning, dismiss-on-Escape, and dismiss-on-outside-click
 * behavior instead of each usage reimplementing it.
 *
 * Known gap, not addressed here: right-click has no reliable touch
 * equivalent (some mobile browsers map long-press to the contextmenu
 * event, many don't) — CLAUDE.md's "no hover-dependent interactions" rule
 * is about hover specifically, but this component's *trigger* still
 * deserves a real touch affordance (e.g. a visible "⋯" button) once it's
 * wired up somewhere real, rather than relying on long-press alone.
 */
export function ContextMenu({ items, children }: ContextMenuProps) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

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

  return (
    <>
      <div
        onContextMenu={(event) => {
          event.preventDefault()
          setPosition({ x: event.clientX, y: event.clientY })
        }}
      >
        {children}
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
}
