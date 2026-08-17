import { useEffect, useState, type ReactNode } from 'react'

// "Very short" pop animation duration — kept as one constant so the
// unmount-delay timeout below can't drift out of sync with the CSS
// transition duration it's paired with.
const TRANSITION_MS = 150

interface ModalProps {
  open: boolean
  onClose: () => void
  labelledBy?: string
  children: ReactNode
  /** 'md' (default, max-w-lg) fits the simple modals (rename, placeholder
   * confirmations). 'lg' (max-w-2xl) is for genuinely field-dense forms —
   * added for the Piece Properties Edit Menu (§15), which has far more
   * fields than max-w-lg can lay out without feeling cramped. */
  size?: 'md' | 'lg'
  /** Rendered outside the scrolling body, pinned to the bottom of the
   * dialog — for a form's Cancel/Save row that should stay visible while
   * long content scrolls above it (the Piece Properties Edit Menu is long
   * enough to need this; short modals can just leave this unset and let
   * their own trailing buttons scroll with everything else). */
  footer?: ReactNode
}

/**
 * Shared modal shell for every popup in the app (design doc §15: "popup/
 * blurred bkgd thing (desktop) or slide-up popover (mobile)") — built once
 * here so the piece edit menu, book edit menu, and anything else that
 * needs a modal all get identical Escape-to-close and backdrop-click-to-
 * close behavior for free, rather than each screen reimplementing it.
 */
export function Modal({ open, onClose, labelledBy, children, size = 'md', footer }: ModalProps) {
  // Stays mounted slightly past `open` going false, so the exit transition
  // (scale/opacity back down) actually has something to animate instead of
  // the dialog just vanishing — `visible` is the one driving the CSS
  // transition classes; `mounted` is only about whether to render at all.
  //
  // The immediate reactions to `open` changing (mount right away when
  // opening; drop `visible` right away when closing, so the CSS transition
  // actually starts) happen at render time — the same "adjust state during
  // render" pattern used elsewhere for prop-driven resets — tracked via
  // `openMirror` so each transition only fires once per `open` change. The
  // effect below only ever calls setState from inside a callback (a frame,
  // a timer), which is the part effects are actually for.
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(false)
  const [openMirror, setOpenMirror] = useState(open)
  if (open !== openMirror) {
    setOpenMirror(open)
    if (open) {
      setMounted(true)
    } else {
      setVisible(false)
    }
  }

  useEffect(() => {
    if (open) {
      // Starts in the "hidden" classes (mounted just went true above, on
      // this same render), then flips to visible on the next frame —
      // flipping both in the same tick would skip the transition entirely
      // (no state change left for the browser to animate between).
      const raf = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(raf)
    }
    // visible already dropped (above) so the exit transition is already
    // playing — wait for it to finish before actually unmounting.
    const timeout = setTimeout(() => setMounted(false), TRANSITION_MS)
    return () => clearTimeout(timeout)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!mounted) return null

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center bg-ink/40 backdrop-blur-sm transition-opacity duration-150 sm:items-center ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl bg-paper-raised shadow-xl transition-[transform,opacity] duration-150 sm:rounded-2xl ${
          size === 'lg' ? 'max-w-2xl' : 'max-w-lg'
        } ${visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
      >
        <div className="overflow-y-auto p-6">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-border bg-paper-raised px-6 py-4">{footer}</div>
        )}
      </div>
    </div>
  )
}
