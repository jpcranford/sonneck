import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  IconCheck,
  IconExternalLink,
  IconLoader2,
  IconPhotoUp,
  IconSearch,
  IconXFilled,
} from '@tabler/icons-react'
import { uploadPersonPortrait } from '../api/people'
import { getWikipediaPageImage, searchWikipedia, type WikipediaSearchResult } from '../api/wikipedia'
import { ApiError } from '../api/client'
import { Modal } from './Modal'

// Person Details' own Upload Portrait flow — real build of the approved
// Phase 2 Artifact / PersonDetailsSample.tsx mockup (device upload OR
// Wikipedia search, then a drag-to-pan + zoom-slider adjust step against
// the oval frame), wired to a real chosen image instead of a fixture
// illustration.
//
// The "crop" is genuinely applied, not just a visual preview: Save
// renders the exact pan/zoom transform the user sees onto an offscreen
// canvas at a fixed 3:4 output size (matching the oval frame's own
// aspect-[3/4]) and uploads the resulting PNG through the same
// POST /api/people/{id}/portrait endpoint the plain file-picker version
// used, so no server-side cropping endpoint was needed — a client-side
// canvas can do the whole job. A Wikipedia-sourced image is loaded with
// crossOrigin="anonymous"; confirmed live (2026-08-31) that
// upload.wikimedia.org serves Access-Control-Allow-Origin: *, so this
// doesn't taint the canvas the way a plain cross-origin <img> normally
// would.

interface UploadPortraitModalProps {
  open: boolean
  onClose: () => void
  personId: number
}

type Step = 'source' | 'adjust'

const ZOOM_MIN = 1
const ZOOM_MAX = 2.5
const ZOOM_STEP = 0.05
// Output canvas size — a fixed 3:4 ratio matching the oval frame's own
// aspect-[3/4], high enough resolution for a real portrait without being
// wasteful for what's ultimately shown at a few hundred px at most.
const OUTPUT_WIDTH = 480
const OUTPUT_HEIGHT = 640

function loadImage(src: string, crossOrigin: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load this image.'))
    img.src = src
  })
}

// Renders the exact pan/zoom transform the preview shows onto a
// fixed-size output canvas — see this file's own top comment for the
// resolution-independent math (pan is measured in on-screen px against
// the live preview frame, then converted to a frame-relative fraction
// before being reapplied at the output canvas's own, different, pixel
// size).
function renderCropToBlob(
  img: HTMLImageElement,
  pan: { x: number; y: number },
  zoom: number,
  frameEl: HTMLElement,
): Promise<Blob> {
  const frameRect = frameEl.getBoundingClientRect()
  const panFracX = pan.x / frameRect.width
  const panFracY = pan.y / frameRect.height

  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT_WIDTH
  canvas.height = OUTPUT_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Could not create a canvas context.'))

  // object-cover-equivalent base scale/position (fills the frame,
  // cropping whichever axis overshoots), matching the live preview's own
  // object-cover image.
  const baseScale = Math.max(OUTPUT_WIDTH / img.naturalWidth, OUTPUT_HEIGHT / img.naturalHeight)
  const scale = baseScale * zoom
  const drawW = img.naturalWidth * scale
  const drawH = img.naturalHeight * scale
  const baseX = (OUTPUT_WIDTH - drawW) / 2
  const baseY = (OUTPUT_HEIGHT - drawH) / 2
  const x = baseX + panFracX * OUTPUT_WIDTH
  const y = baseY + panFracY * OUTPUT_HEIGHT

  ctx.drawImage(img, x, y, drawW, drawH)

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Could not export the cropped image.'))
    }, 'image/png')
  })
}

export function UploadPortraitModal({ open, onClose, personId }: UploadPortraitModalProps) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>('source')
  const [wikiQuery, setWikiQuery] = useState('')
  const [wikiResults, setWikiResults] = useState<WikipediaSearchResult[] | null>(null)
  const [wikiImageError, setWikiImageError] = useState<string | null>(null)
  const [chosenLabel, setChosenLabel] = useState<string | null>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(
    null,
  )
  const fileInputRef = useRef<HTMLInputElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const objectUrlRef = useRef<string | null>(null)

  function reset() {
    setStep('source')
    setWikiQuery('')
    setWikiResults(null)
    setWikiImageError(null)
    setChosenLabel(null)
    setImage(null)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }
  function handleClose() {
    reset()
    onClose()
  }

  const searchMutation = useMutation({
    mutationFn: (query: string) => searchWikipedia(query),
    onSuccess: (results) => setWikiResults(results),
  })
  function handleWikiSearch() {
    if (!wikiQuery.trim()) return
    setWikiImageError(null)
    searchMutation.mutate(wikiQuery.trim())
  }

  const pickImageMutation = useMutation({
    mutationFn: (result: WikipediaSearchResult) => getWikipediaPageImage(result.title).then((r) => ({ result, r })),
    onSuccess: async ({ result, r }) => {
      if (!r.imageUrl) {
        setWikiImageError(`"${result.title}" has no photo on Wikipedia — try another result or upload from device.`)
        return
      }
      try {
        const img = await loadImage(r.imageUrl, true)
        setImage(img)
        setChosenLabel(`Wikipedia: ${result.title}`)
        setZoom(1)
        setPan({ x: 0, y: 0 })
        setStep('adjust')
      } catch {
        setWikiImageError('Could not load that image — try another result or upload from device.')
      }
    },
    onError: () => setWikiImageError('Could not reach Wikipedia — try again, or upload from device.'),
  })

  async function handleFileChosen(file: File) {
    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    try {
      const img = await loadImage(url, false)
      setImage(img)
      setChosenLabel(`Uploaded: ${file.name}`)
      setZoom(1)
      setPan({ x: 0, y: 0 })
      setStep('adjust')
    } catch {
      URL.revokeObjectURL(url)
      objectUrlRef.current = null
    }
  }

  function onDragStart(event: ReactPointerEvent) {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragState.current = { startX: event.clientX, startY: event.clientY, originX: pan.x, originY: pan.y }
  }
  function onDragMove(event: ReactPointerEvent) {
    if (!dragState.current) return
    const dx = event.clientX - dragState.current.startX
    const dy = event.clientY - dragState.current.startY
    setPan({ x: dragState.current.originX + dx, y: dragState.current.originY + dy })
  }
  function onDragEnd() {
    dragState.current = null
  }

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!image || !frameRef.current) throw new Error('No image chosen.')
      const blob = await renderCropToBlob(image, pan, zoom, frameRef.current)
      const file = new File([blob], 'portrait.png', { type: 'image/png' })
      return uploadPersonPortrait(personId, file)
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['person', personId], updated)
      queryClient.invalidateQueries({ queryKey: ['people'] })
      handleClose()
    },
    onError: (error) => {
      window.alert(error instanceof ApiError ? error.message : 'Could not save this portrait.')
    },
  })

  return (
    <Modal
      open={open}
      onClose={handleClose}
      labelledBy="upload-portrait-title"
      header={
        <div className="flex items-start justify-between gap-4">
          <h2 id="upload-portrait-title" className="font-display text-2xl font-medium text-ink">
            {step === 'source' ? 'Change portrait' : 'Adjust portrait'}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="mt-1 shrink-0 cursor-pointer text-ink-soft hover:text-accent"
          >
            <IconXFilled size={22} />
          </button>
        </div>
      }
      footer={
        step === 'adjust' ? (
          <div className="flex justify-between gap-2">
            <button
              type="button"
              onClick={() => setStep('source')}
              disabled={uploadMutation.isPending}
              className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent disabled:cursor-default disabled:opacity-45"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => uploadMutation.mutate()}
              disabled={uploadMutation.isPending}
              className="flex cursor-pointer items-center gap-1.5 rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90 disabled:cursor-default disabled:opacity-60"
            >
              {uploadMutation.isPending ? (
                <IconLoader2 size={16} className="animate-spin" />
              ) : (
                <IconCheck size={16} />
              )}
              {uploadMutation.isPending ? 'Saving…' : 'Save portrait'}
            </button>
          </div>
        ) : undefined
      }
    >
      {step === 'source' && (
        <div className="flex flex-col gap-5">
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) handleFileChosen(file)
                event.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-paper-sunken px-4 py-6 text-ink-soft hover:border-accent hover:text-accent"
            >
              <IconPhotoUp size={18} />
              Upload from device
            </button>
          </div>

          <div className="flex items-center gap-3 text-xs text-ink-soft">
            <span className="h-px flex-1 bg-border" />
            or search Wikipedia
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="flex flex-col gap-2">
            <div className="relative">
              <IconSearch
                size={16}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft"
              />
              <input
                type="text"
                value={wikiQuery}
                onChange={(event) => {
                  setWikiQuery(event.target.value)
                  setWikiResults(null)
                  setWikiImageError(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleWikiSearch()
                }}
                placeholder="Search Wikipedia…"
                className="w-full rounded-md border border-border bg-paper-raised py-2 pr-3 pl-9 text-sm text-ink"
              />
            </div>
            <button
              type="button"
              onClick={handleWikiSearch}
              disabled={!wikiQuery.trim() || searchMutation.isPending}
              className="cursor-pointer self-end text-xs text-accent hover:underline disabled:cursor-default disabled:text-ink-soft disabled:no-underline"
            >
              {searchMutation.isPending ? 'Searching…' : 'Search'}
            </button>

            {wikiImageError && <p className="text-sm text-red-700">{wikiImageError}</p>}
            {searchMutation.isError && (
              <p className="text-sm text-red-700">Could not reach Wikipedia. Please try again.</p>
            )}

            {wikiResults && (
              <div className="flex flex-col divide-y divide-border rounded-md border border-border">
                {wikiResults.length === 0 && (
                  <p className="px-3 py-2.5 text-sm text-ink-soft italic">No Wikipedia results found.</p>
                )}
                {wikiResults.map((result) => (
                  <button
                    key={result.title}
                    type="button"
                    onClick={() => {
                      setWikiImageError(null)
                      pickImageMutation.mutate(result)
                    }}
                    disabled={pickImageMutation.isPending}
                    className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-left hover:bg-paper-sunken disabled:cursor-default"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#6b6560] text-white">
                      {pickImageMutation.isPending && pickImageMutation.variables?.title === result.title ? (
                        <IconLoader2 size={14} className="animate-spin" />
                      ) : (
                        <IconExternalLink size={14} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-sm font-medium text-ink">
                        {result.title}
                      </span>
                      {/* line-clamp-2, not truncate — same fix as
                          EditPersonModal.tsx's own Wikipedia results panel
                          (2026-09-01): this shares the exact same
                          searchWikipedia API/result shape, so the backend's
                          own exsentences=2 change already means there's a
                          second sentence's worth of real disambiguating
                          text here too — showing only one line of it would
                          just be an inconsistent, needless regression. */}
                      <span className="line-clamp-2 text-xs text-ink-soft">{result.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {step === 'adjust' && image && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-soft">
            Drag to reposition, use the slider to zoom — the frame below is exactly what will be saved.
            {chosenLabel && <span className="ml-1 text-ink-soft/70 italic">({chosenLabel})</span>}
          </p>
          <div
            ref={frameRef}
            className="mx-auto aspect-[3/4] w-40 touch-none overflow-hidden rounded-[50%] border border-border bg-paper-sunken [container-type:inline-size]"
          >
            <div
              className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
              onPointerDown={onDragStart}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
            >
              <img
                src={image.src}
                alt=""
                draggable={false}
                className="h-full w-full object-cover"
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: 'center',
                }}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-ink-soft">Zoom</span>
            <input
              type="range"
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step={ZOOM_STEP}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="flex-1 accent-accent"
            />
          </div>
        </div>
      )}
    </Modal>
  )
}
