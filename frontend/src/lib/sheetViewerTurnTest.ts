// A page-turn timing test for the Sheet Viewer, run from its mockup's Mockup
// panel on a real device (the iPad the viewer is tuned for). It turns
// through a piece's real pages three ways — the old build's stacked <img>
// hidden at opacity 0; the current build's canvases drawn at screen size
// when each page loads (PageCanvas, SheetViewerPage.tsx), stacked and hidden
// at opacity 0; and those same drawings kept off screen, copied onto one
// visible canvas on each turn — in the viewer's own preload window (one page
// behind, two ahead), and times each turn from the change to the frame
// after it's drawn.
//
// Why the third: on the iPad, a canvas drawn while hidden at opacity 0 can
// show soft once it's revealed (measured from device screenshots: softer
// than a half-resolution copy, though the canvas itself held the full
// drawing); drawing it again while it shows was sharp. Copying from an
// off-screen canvas redraws the visible one on every turn without decoding
// the page again.
//
// Progress is saved as it goes: if Safari reloads the tab mid-run (out of
// memory), the next visit to the mockup reports where it stopped.

const KEY = 'sv-turn-test'
const TURN_GAP_MS = 1500

export interface TurnTestVariant {
  name: string
  kind: 'image' | 'canvas' | 'copy'
}

export const TURN_TEST_VARIANTS: TurnTestVariant[] = [
  { name: 'Old: stacked images, hidden at 0', kind: 'image' },
  { name: 'Current: canvases drawn at screen size, hidden at 0', kind: 'canvas' },
  { name: 'Copy: drawn off screen, copied to one canvas on each turn', kind: 'copy' },
]

interface Saved {
  running: string | null
  progress: string
  lines: string[]
}

function read(): Saved | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null
  } catch {
    return null
  }
}
function write(saved: Saved | null) {
  try {
    if (saved) localStorage.setItem(KEY, JSON.stringify(saved))
    else localStorage.removeItem(KEY)
  } catch {
    // Without storage the test still runs; only a reload's report is lost.
  }
}

/** Forgets a reload-interrupted run once its report has been read. */
export function clearInterruptedTurnTest() {
  write(null)
}

/** A run that a reload cut short, as report text, or null. */
export function interruptedTurnTest(): string | null {
  const saved = read()
  if (!saved?.running) return null
  return [
    ...saved.lines,
    `${saved.running}\n  PAGE RELOADED during the run (got as far as: ${saved.progress || 'loading'})`,
  ].join('\n')
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
// The frame after a change has been drawn.
const painted = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )

async function loadImage(url: string) {
  const img = new Image()
  img.src = url
  await img.decode()
  return img
}
// Decoded the way the viewer decodes a page (PageCanvas).
async function loadBitmap(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`page ${response.status}`)
  return createImageBitmap(await response.blob())
}

function drawCanvas(img: ImageBitmap, width: number, height: number) {
  // Sized like PageCanvas: whole CSS pixels, so it shows at its own size.
  const dpr = window.devicePixelRatio || 1
  const scale = Math.min(width / img.width, height / img.height, 1 / dpr)
  const cssWidth = Math.floor(img.width * scale)
  const cssHeight = Math.floor(img.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(cssWidth * dpr)
  canvas.height = Math.round(cssHeight * dpr)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no canvas')
  context.imageSmoothingQuality = 'high'
  context.drawImage(img, 0, 0, canvas.width, canvas.height)
  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${cssHeight}px`
  return canvas
}

/**
 * Runs every variant over `pageUrl(1)`…`pageUrl(pageCount)` (at most 8
 * pages) on a full-screen white stage, its status along the bottom, and
 * returns the report text.
 */
export async function runTurnTest(
  pageUrl: (page: number) => string,
  pageCount: number,
): Promise<string> {
  const pages = Math.min(pageCount, 8)
  const header = `dpr ${window.devicePixelRatio}, ${window.innerWidth}x${window.innerHeight}, ${pages} pages`
  const saved: Saved = { running: null, progress: '', lines: [header] }
  write(saved)

  const stage = document.createElement('div')
  stage.style.cssText = 'position:fixed;inset:0;z-index:100;background:#fff'
  const status = document.createElement('p')
  status.style.cssText =
    'position:fixed;left:12px;right:12px;bottom:12px;z-index:101;margin:0;padding:10px 12px;border-radius:10px;background:rgba(0,0,0,.85);color:#fff;font:14px system-ui'
  const onStatus = (text: string) => (status.textContent = `${text} Don’t touch the screen.`)
  document.body.append(stage, status)
  const box = stage.getBoundingClientRect()

  try {
    for (const [index, variant] of TURN_TEST_VARIANTS.entries()) {
      saved.running = variant.name
      saved.progress = ''
      write(saved)
      onStatus(`Running ${index + 1} of ${TURN_TEST_VARIANTS.length}: ${variant.name}…`)

      const els = new Map<number, HTMLElement>()
      const prep: number[] = []
      const place = (el: HTMLElement) =>
        (el.style.cssText +=
          ';position:absolute;inset:0;margin:auto;display:block;max-width:100%;max-height:100%')
      // Copy: the one canvas on screen, redrawn from the page's off-screen
      // drawing on every turn.
      const visible = document.createElement('canvas')
      if (variant.kind === 'copy') {
        place(visible)
        stage.append(visible)
      }
      const hide = (el: HTMLElement) => {
        if (variant.kind !== 'copy') el.style.opacity = '0'
      }
      const show = (el: HTMLElement) => {
        if (variant.kind !== 'copy') {
          el.style.opacity = '1'
          return
        }
        const source = el as HTMLCanvasElement
        visible.width = source.width
        visible.height = source.height
        visible.style.width = source.style.width
        visible.style.height = source.style.height
        visible.getContext('2d')?.drawImage(source, 0, 0)
      }
      const mount = async (p: number) => {
        if (p < 1 || p > pages || els.has(p)) return
        const started = performance.now()
        // A fresh URL per run, so no variant reuses another's decode.
        const url = `${pageUrl(p)}${pageUrl(p).includes('?') ? '&' : '?'}turnTest=${index}-${Date.now()}`
        let el: HTMLElement
        if (variant.kind === 'image') {
          el = await loadImage(url)
        } else {
          const bitmap = await loadBitmap(url)
          el = drawCanvas(bitmap, box.width, box.height)
          bitmap.close()
        }
        prep.push(Math.round(performance.now() - started))
        els.set(p, el)
        if (variant.kind === 'copy') return
        place(el)
        hide(el)
        stage.append(el)
      }

      for (const p of [1, 2, 3]) await mount(p)
      const first = els.get(1)
      if (first) show(first)
      await painted()
      await sleep(TURN_GAP_MS)

      const turns: number[] = []
      for (let page = 2; page <= pages; page++) {
        const started = performance.now()
        for (const [p, el] of els) if (p !== page) hide(el)
        const current = els.get(page)
        if (current) show(current)
        await painted()
        turns.push(Math.round(performance.now() - started))
        saved.progress = `page ${page}, turns so far ${turns.join(' ')}`
        write(saved)
        for (const [p, el] of els) {
          if (p < page - 1 || p > page + 2) {
            el.remove()
            els.delete(p)
          }
        }
        void mount(page + 2)
        await sleep(TURN_GAP_MS)
      }
      stage.replaceChildren()
      saved.lines.push(
        `${variant.name}\n  turns ${turns.join(' ')} ms | load+prep ${prep.join(' ')} ms`,
      )
      saved.running = null
      write(saved)
      await sleep(500)
    }
  } catch (error) {
    saved.lines.push(`${saved.running ?? 'Test'}\n  error: ${String(error)}`)
  } finally {
    stage.remove()
    status.remove()
    write(null)
  }
  return saved.lines.join('\n')
}
