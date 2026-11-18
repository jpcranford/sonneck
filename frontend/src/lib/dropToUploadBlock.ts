import { useEffect } from 'react'

// Overlays that aren't a Modal but still pause the app-wide drop-to-upload
// (components/DropToUpload.tsx), which already steps aside for any open
// Modal: the page lightboxes (components/PageLightbox.tsx and the mockups'
// copies). A count, so overlapping blockers each release only their own.
let blockers = 0

/** Whether drop-to-upload is paused right now — read at event time. */
export function isDropToUploadBlocked(): boolean {
  return blockers > 0
}

/** Pauses drop-to-upload while `active` and the caller is mounted. */
export function useDropToUploadBlocker(active: boolean) {
  useEffect(() => {
    if (!active) return
    blockers += 1
    return () => {
      blockers -= 1
    }
  }, [active])
}
