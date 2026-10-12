// Every empty message in the app (picked wordings: /mockup/states): a serif
// headline over a smaller sans italic line saying what goes there.
// `className` sets the spacing around it, which differs by page.
export function EmptyState({
  title,
  detail,
  className = 'p-8',
}: {
  title: string
  detail?: string
  className?: string
}) {
  return (
    <div className={`text-center ${className}`}>
      <p className="font-display font-medium break-words text-ink-muted">{title}</p>
      {detail && <p className="mt-1 text-sm text-ink-muted italic">{detail}</p>}
    </div>
  )
}
