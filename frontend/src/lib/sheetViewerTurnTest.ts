// A page-turn timing test for the Sheet Viewer, run from its mockup's Mockup
// panel on a real device (the iPad the viewer is tuned for). It turns
// through a piece's real pages the way the viewer draws them — each page
// drawn at screen size into a canvas kept off screen, then copied onto a
// visible canvas on each turn (SheetViewerPage.tsx's PageDrawing and
// ShownPage) — three ways: one page at a time, as today; two pages turning
// by spread; and two pages sliding a page at a time on a strip that moves
// (https://claude.ai/artifact/J9T8zCieMcc82cRqRJXKFD). Each keeps the
// viewer's preload window (one screen behind, two ahead), times each turn
// from the change to the frame after it's drawn, and reports the most
// memory its canvases held at once, since iPad Safari caps what all
// canvases may hold. A slide also reports its longest frame while moving.
//
// Progress is saved as it goes: if Safari reloads the tab mid-run (out of
// memory), the next visit to the mockup reports where it stopped.

const KEY = 'sv-turn-test'
const TURN_GAP_MS = 1500

export interface TurnTestVariant {
  name: string
  perScreen: 1 | 2
  slide: boolean
}

export const TURN_TEST_VARIANTS: TurnTestVariant[] = [
  { name: 'One page (today)', perScreen: 1, slide: false },
  { name: 'Two pages, by spread', perScreen: 2, slide: false },
  { name: 'Two pages, sliding', perScreen: 2, slide: true },
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

const GAP = 8
const SLIDE_MS = 200

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
  stage.style.cssText = 'position:fixed;inset:0;z-index:100;background:#fff;overflow:hidden'
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

      const n = variant.perScreen
      const across = box.width >= box.height
      // Each page's cell on screen: the whole stage, or a share of it.
      const cellW = across ? (box.width - (n - 1) * GAP) / n : box.width
      const cellH = across ? box.height : (box.height - (n - 1) * GAP) / n
      const drawings = new Map<number, HTMLCanvasElement>()
      const prep: number[] = []
      let peak = 0
      const measure = (extra: HTMLCanvasElement[]) => {
        let bytes = 0
        for (const c of [...drawings.values(), ...extra]) bytes += c.width * c.height * 4
        peak = Math.max(peak, bytes)
      }
      const at = (slot: number) =>
        across ? `left:${slot * (cellW + GAP)}px;top:0` : `top:${slot * (cellH + GAP)}px;left:0`
      const copy = (target: HTMLCanvasElement, source: HTMLCanvasElement) => {
        target.width = source.width
        target.height = source.height
        target.style.width = source.style.width
        target.style.height = source.style.height
        target.getContext('2d')?.drawImage(source, 0, 0)
      }
      const draw = async (p: number) => {
        if (p < 1 || p > pages || drawings.has(p)) return
        const started = performance.now()
        // A fresh URL per run, so no variant reuses another's decode.
        const url = `${pageUrl(p)}${pageUrl(p).includes('?') ? '&' : '?'}turnTest=${index}-${Date.now()}`
        const bitmap = await loadBitmap(url)
        drawings.set(p, drawCanvas(bitmap, cellW, cellH))
        bitmap.close()
        prep.push(Math.round(performance.now() - started))
      }
      // Keeps one screen behind and two ahead drawn, and lets go of the rest.
      const keep = async (first: number) => {
        for (const p of [...drawings.keys()]) {
          if (p < first - n || p >= first + 3 * n) {
            const c = drawings.get(p)
            if (c) c.width = c.height = 0
            drawings.delete(p)
          }
        }
        for (let p = first - n; p < first + 3 * n; p++) await draw(p)
      }

      const turns: number[] = []
      const frames: string[] = []
      if (!variant.slide) {
        // Spread (or one page): a visible canvas per slot, copied into.
        const slots = Array.from({ length: n }, (_, i) => {
          const c = document.createElement('canvas')
          c.style.cssText = `position:absolute;${at(i)}`
          stage.append(c)
          return c
        })
        const show = (first: number) =>
          slots.forEach((c, i) => {
            const d = drawings.get(first + i)
            if (d) copy(c, d)
            else c.width = c.height = 0
          })
        await keep(1)
        show(1)
        measure(slots)
        await painted()
        await sleep(TURN_GAP_MS)
        for (let first = 1 + n; first <= pages; first += n) {
          const started = performance.now()
          show(first)
          await painted()
          turns.push(Math.round(performance.now() - started))
          measure(slots)
          saved.progress = `page ${first}, turns so far ${turns.join(' ')}`
          write(saved)
          void keep(first)
          await sleep(TURN_GAP_MS)
        }
      } else {
        // Slide: every nearby page copied onto its own canvas on one strip,
        // which moves a page at a time.
        const strip = document.createElement('div')
        strip.style.cssText = `position:absolute;inset:0;transition:transform ${SLIDE_MS}ms cubic-bezier(.2,.7,.3,1)`
        const ahead = n
        stage.append(strip)
        const onStrip = new Map<number, HTMLCanvasElement>()
        const place = (first: number) => {
          for (const [p, c] of onStrip) {
            if (p < first - 1 || p > first + ahead) {
              c.width = c.height = 0
              c.remove()
              onStrip.delete(p)
            }
          }
          for (let p = first - 1; p <= first + ahead; p++) {
            const d = drawings.get(p)
            if (!d || onStrip.has(p)) continue
            const c = document.createElement('canvas')
            c.style.cssText = `position:absolute;${at(p - 1)}`
            copy(c, d)
            strip.append(c)
            onStrip.set(p, c)
          }
        }
        const step = (across ? cellW : cellH) + GAP
        const move = (first: number) =>
          (strip.style.transform = across
            ? `translateX(${-(first - 1) * step}px)`
            : `translateY(${-(first - 1) * step}px)`)
        strip.style.transition = 'none'
        await keep(1)
        place(1)
        move(1)
        measure([...onStrip.values()])
        await painted()
        strip.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(.2,.7,.3,1)`
        await sleep(TURN_GAP_MS)
        for (let first = 2; first + n - 1 <= pages; first++) {
          place(first)
          const started = performance.now()
          move(first)
          // Every frame from the move to the end of the slide: the turn is
          // the first two (as painted() times the others), and the longest
          // gap is reported with which frame it was.
          const gaps: number[] = []
          let lastFrame = started
          while (lastFrame - started < SLIDE_MS + 20) {
            await new Promise((r) => requestAnimationFrame(r))
            const now = performance.now()
            gaps.push(now - lastFrame)
            lastFrame = now
          }
          turns.push(Math.round(gaps[0] + (gaps[1] ?? 0)))
          const longest = Math.max(...gaps)
          frames.push(`${Math.round(longest)} (#${gaps.indexOf(longest) + 1})`)
          measure([...onStrip.values()])
          saved.progress = `page ${first}, turns so far ${turns.join(' ')}`
          write(saved)
          void keep(first)
          await sleep(TURN_GAP_MS)
        }
      }
      for (const c of drawings.values()) c.width = c.height = 0
      stage.replaceChildren()
      saved.lines.push(
        `${variant.name}\n  turns ${turns.join(' ')} ms` +
          (frames.length
            ? ` | longest frame while sliding, ms (which frame) ${frames.join(' ')}`
            : '') +
          ` | load+prep ${prep.join(' ')} ms | canvases at most ${(peak / 1048576).toFixed(0)} MB`,
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
