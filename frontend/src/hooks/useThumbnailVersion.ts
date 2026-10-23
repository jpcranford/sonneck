import { useQuery } from '@tanstack/react-query'
import { getConfig } from '../api/config'

/**
 * Returns `version(fileHash)`: the `?v=` to put on a piece thumbnail or a
 * book's first-page cover — the file's own hash plus when thumbnails were
 * last redrawn (GET /api/config's thumbnailsRedrawn, bumped by the
 * regenerate-thumbnails command). Either changing gives the image a new
 * URL, so the server lets the browser keep each one indefinitely (internal/
 * handlers' imageCacheHeaders) and a replaced file or a redraw still shows
 * at once. A hook returning a function, so a list renders any number of
 * thumbnails from one call.
 */
export function useThumbnailVersion(): (fileHash: string | null | undefined) => string | undefined {
  const { data: config } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  const redrawn = config?.thumbnailsRedrawn
  return (fileHash) => {
    if (!fileHash) return undefined
    const hash = fileHash.slice(0, 16)
    return redrawn ? `${hash}.${redrawn}` : hash
  }
}

/**
 * The same for a Sheet Viewer page (GET /api/pieces/{id}/pages/{n}): the
 * file's hash plus GET /api/config's pagesVersion (the render version and
 * when pages were last redrawn by regenerate-pages). Undefined until the
 * config has loaded, so a page is never requested under a stale version.
 */
export function usePageVersion(): (fileHash: string | null | undefined) => string | undefined {
  const { data: config } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  const pagesVersion = config?.pagesVersion
  return (fileHash) =>
    fileHash && pagesVersion ? `${fileHash.slice(0, 16)}.${pagesVersion}` : undefined
}
