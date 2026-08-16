import { useEffect, type ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  labelledBy?: string
  children: ReactNode
}

/**
 * Shared modal shell for every popup in the app (design doc §15: "popup/
 * blurred bkgd thing (desktop) or slide-up popover (mobile)") — built once
 * here so the piece edit menu, book edit menu, and anything else that
 * needs a modal all get identical Escape-to-close and backdrop-click-to-
 * close behavior for free, rather than each screen reimplementing it.
 */
export function Modal({ open, onClose, labelledBy, children }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 backdrop-blur-sm sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-paper-raised p-6 shadow-xl sm:rounded-2xl"
      >
        {children}
      </div>
    </div>
  )
}
