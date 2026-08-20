interface ComingSoonProps {
  title: string
}

/** Placeholder body for routes that exist (shell scope) but aren't wired up yet. */
export function ComingSoon({ title }: ComingSoonProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="font-display text-3xl font-medium text-ink">{title}</h1>
      <p className="text-ink-soft">This page is coming soon.</p>
    </div>
  )
}
