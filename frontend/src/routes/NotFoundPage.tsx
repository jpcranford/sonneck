import { Link } from 'react-router-dom'

// Deliberately not ComingSoon — that component's copy ("coming soon")
// is accurate for a real, planned-but-unbuilt feature route; it's wrong
// for a URL that doesn't correspond to any route at all.
export function NotFoundPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="font-display text-3xl text-ink">Page not found</h1>
      <p className="text-ink-soft">There's nothing at this address.</p>
      <Link to="/" className="mt-4 text-accent underline">
        Back to Library
      </Link>
    </div>
  )
}
