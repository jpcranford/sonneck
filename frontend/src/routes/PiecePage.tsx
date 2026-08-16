import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getPiece } from '../api/pieces'
import { ApiError } from '../api/client'

// Scaffolded ahead of a dedicated Piece View phase (design doc §14) — the
// upload flow's duplicate-file dedupe (CLAUDE.md > File handling) needs
// somewhere real to send the user to when a re-uploaded file already
// matches an existing piece, rather than a dead-end placeholder.
export function PiecePage() {
  const { id } = useParams<{ id: string }>()
  const pieceId = Number(id)

  const {
    data: piece,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['piece', pieceId],
    queryFn: () => getPiece(pieceId),
  })

  const notFound = error instanceof ApiError && error.code === 'NOT_FOUND'

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      {isLoading && <p className="text-ink-soft">Loading…</p>}
      {isError && notFound && (
        <>
          <h1 className="font-display text-3xl text-ink">Piece not found</h1>
          <p className="text-ink-soft">It may have been deleted or moved.</p>
          <Link to="/" className="mt-4 text-accent underline">
            Back to Library
          </Link>
        </>
      )}
      {isError && !notFound && (
        <p className="text-ink-soft">
          {error instanceof ApiError ? error.message : 'Could not load this piece.'}
        </p>
      )}
      {piece && (
        <>
          <h1 className="font-display text-3xl text-ink">{piece.title}</h1>
          {piece.composer.value && <p className="text-ink-soft">{piece.composer.value}</p>}
          <p className="mt-4 text-sm text-ink-soft">The full piece view is coming soon.</p>
        </>
      )}
    </div>
  )
}
