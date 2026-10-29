import type { ReactNode } from 'react'

// A Markdown field with its "Markdown and :shortcodes: supported" hint, the
// Sheet Viewer Info panel's style used app-wide: the hint in the box's
// bottom-right corner, small and quiet, instead of after the label.
//
// The box (border, fill, focus outline) is this wrapper, holding the
// textarea and, under it, a strip with the hint — never the hint laid over
// the textarea: a textarea's padding scrolls with its text, so a hint over
// it had text running beneath it whenever a long note was scrolled
// anywhere but the end. So the textarea passed in is bare: no border, no
// fill, no outline of its own (`bg-transparent outline-none
// focus-visible:outline-none`), and its bottom padding small (`pb-1`) — the
// strip sits right under it. Sizing and margins the field had go on
// `className` (a flex column, so a `flex-1` textarea still fills it); a
// different box look on `boxClassName`, the strip's padding on
// `hintClassName`, to line the hint up with the text's own padding.
export function MarkdownHint({
  children,
  className = '',
  boxClassName = 'rounded-md border border-border bg-paper-raised',
  hintClassName = 'px-3 pb-1.5',
}: {
  children: ReactNode
  className?: string
  boxClassName?: string
  hintClassName?: string
}) {
  return (
    <div
      className={`flex flex-col focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus ${boxClassName} ${className}`}
    >
      {children}
      <span
        className={`pointer-events-none shrink-0 text-right text-xs text-ink-muted italic select-none ${hintClassName}`}
      >
        Markdown and :shortcodes: supported
      </span>
    </div>
  )
}
