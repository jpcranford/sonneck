import { useState, type ReactNode } from 'react'

interface InfoTooltipProps {
  message: string
  ariaLabel: string
  triggerClassName: string
  children: ReactNode
}

/**
 * Hover-or-tap info bubble: hover reveals it on desktop, click/tap toggles
 * it open on touch (design doc §12's "no hover-dependent interactions").
 * Each instance owns its own open state, so several can appear on one page
 * independently. Originally built inline for the Piece View's "inherited"
 * badges and public domain badge — pulled out here once a third/fourth use
 * (the Piece View's opus-number info icon, the Edit Piece modal's own copy
 * of it) made the duplication worth naming.
 */
export function InfoTooltip({ message, ariaLabel, triggerClassName, children }: InfoTooltipProps) {
  const [open, setOpen] = useState(false)
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={ariaLabel}
        className={triggerClassName}
      >
        {children}
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-max max-w-[220px] -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-center text-xs text-paper shadow-md transition-opacity ${
          open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        {message}
      </span>
    </span>
  )
}
