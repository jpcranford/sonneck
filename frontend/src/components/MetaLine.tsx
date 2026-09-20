import type { ReactNode } from 'react'

// Renders a bullet-joined ("•") meta line from parts that may be null/
// undefined/empty-string, omitting the separator around any missing part
// instead of rendering a dangling or doubled "•" with nothing next to it —
// the JSX-capable sibling of lib/formatPieceMeta.ts's own
// `.filter(Boolean).join(' • ')` pattern for a line whose parts aren't all
// plain strings (a chevron-joined key sequence needs to render as real
// elements, not text). Found live: a piece with no keys rendered
// "arr. X • • 4 pages" — the key segment's own bullets rendered on both
// sides regardless of whether it had anything to say.
export function MetaLine({ parts }: { parts: ReactNode[] }) {
  const visible = parts.filter((part) => part != null && part !== '')
  return (
    <>
      {visible.map((part, i) => (
        <span key={i}>
          {i > 0 && <span aria-hidden="true"> • </span>}
          {part}
        </span>
      ))}
    </>
  )
}
