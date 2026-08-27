import { useEffect, useState } from 'react'
import { IconChevronLeft, IconChevronRightFilled, IconXFilled } from '@tabler/icons-react'

// Full-screen page preview overlay, shared by every page-thumbnail preview
// in the app that wants a click-to-enlarge view (Piece Details, the Book
// Upload Wizard's "About this book" step). Its own small component rather
// than reusing Modal.tsx: Modal is a bounded-width dialog with padded
// header/body/footer slots, not a full-bleed image viewer. Kept close to
// Modal's own backdrop treatment (bg-ink/NN + backdrop-blur-sm, click-
// target-is-currentTarget to close, Escape closes) so it still feels like
// the same app, just without Modal's mount/unmount fade choreography.
//
// Note: the frozen `/mockup/*` design-reference pages (PieceDetailsSample,
// UploadBookAboutMockup) keep their own local copy of this rather than
// importing it — same "no shared component between a mockup and the real
// thing" convention as every other mockup in this codebase.
export function PageLightbox({
  imageUrl,
  alt,
  page,
  pageCount,
  onClose,
  onPrev,
  onNext,
}: {
  imageUrl: string
  alt: string
  page: number
  pageCount: number
  onClose: () => void
  onPrev: () => void
  onNext: () => void
}) {
  // 'fit' scales the image down to fit the screen (object-contain, no
  // scroll needed). 'actual' renders the image at its real native pixel
  // size — no width/height constraint on the <img> itself, just a
  // scrollable box around it, since that's the literal definition of
  // "1:1" for a raster image. Resets to 'fit' on every page change by
  // remounting this component on `key={page}` from the caller (React's
  // own recommended pattern for "reset state when a prop changes"),
  // rather than an effect calling setState for the same result.
  const [zoom, setZoom] = useState<'fit' | 'actual'>('fit')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      // No pageCount > 1 guard needed — onPrev/onNext are the same
      // Math.max(1, …)/Math.min(pageCount, …)-clamped callbacks the
      // capsule's own buttons call, so this is a harmless no-op on a
      // single-page piece rather than something that needs its own check.
      if (event.key === 'ArrowLeft') onPrev()
      if (event.key === 'ArrowRight') onNext()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, onPrev, onNext])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {/* Upper-left of the popup itself, not the viewport corner. Same
          chip treatment (bg-ink/80 + blur, white icon) as the page-cycle
          capsule below, so the whole feature reads as one piece. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-6 left-6 flex size-10 items-center justify-center rounded-full bg-ink/80 text-white shadow-md backdrop-blur-sm hover:bg-white/15 focus-visible:outline-accent-on-dark"
      >
        <IconXFilled size={20} />
      </button>

      {/* Persistent, not hover-revealed (device-aware convention: this
          page's affordances are tap-triggered, never hover-dependent) —
          without this, "click the image to zoom" has no way to announce
          itself on a touch device that has no hover state at all. */}
      <div className="pointer-events-none absolute top-6 right-6 rounded-full bg-ink/80 px-3 py-1.5 text-xs text-white/90 shadow-md backdrop-blur-sm">
        Click image to {zoom === 'fit' ? 'zoom in' : 'fit to screen'}
      </div>

      <button
        type="button"
        onClick={() => setZoom((z) => (z === 'fit' ? 'actual' : 'fit'))}
        aria-label={zoom === 'fit' ? 'Zoom in to actual size' : 'Zoom out to fit screen'}
        className={
          zoom === 'fit'
            ? 'flex max-h-[85vh] max-w-[90vw] cursor-zoom-in items-center justify-center'
            : 'max-h-[85vh] max-w-[90vw] cursor-zoom-out overflow-auto rounded-md'
        }
      >
        <img
          src={imageUrl}
          alt={alt}
          className={
            zoom === 'fit'
              ? 'max-h-[85vh] max-w-[90vw] rounded-md object-contain shadow-2xl'
              : 'block rounded-md shadow-2xl'
          }
        />
      </button>

      {/* Same page-cycle capsule as the inline preview, carried into the
          overlay so you don't have to close the lightbox just to look at
          an adjacent page. px-2 (not an asymmetric pr-1 pl-3) keeps the
          "n / N" label visually centered — same total 16px horizontal
          padding budget the capsule always had, just split evenly instead
          of 12px/4px. Same fix applied everywhere else this capsule is
          copied (no shared component across the frozen mockup copies). */}
      {pageCount > 1 && (
        <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-ink/80 px-2 py-1 shadow-md backdrop-blur-sm">
          <button
            type="button"
            onClick={onPrev}
            disabled={page === 1}
            aria-label="Previous page"
            className="flex size-7 cursor-pointer items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-accent-on-dark disabled:pointer-events-none disabled:opacity-35"
          >
            <IconChevronLeft size={16} />
          </button>
          <span className="text-xs tabular-nums text-white/90">
            {page} / {pageCount}
          </span>
          <button
            type="button"
            onClick={onNext}
            disabled={page === pageCount}
            aria-label="Next page"
            className="flex size-7 cursor-pointer items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-accent-on-dark disabled:pointer-events-none disabled:opacity-35"
          >
            <IconChevronRightFilled size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
