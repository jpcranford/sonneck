// Checks the Sheet Viewer's touch targets (its plan's Phase 0 rule): every
// element marked data-hit must be at least 48×48 CSS px, and no two may
// overlap. Measured at a phone, both tablet orientations and a desktop
// window, in the page's starting state and again after each --click (the
// clicks build on one another, so a sequence can open Annotate, then a menu).
// Needs Playwright's Chromium, as in CLAUDE.md's "Live browser verification":
//   PLAYWRIGHT=<path>/node_modules/playwright/index.mjs \
//     node scripts/check-hit-areas.mjs http://localhost:5173/mockup/sheet-viewer \
//     --click '[aria-label="Clock"]' --click '[aria-label="Clock"]' --click '[aria-label="Annotate"]'
// Exits 1 if anything fails.
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright')

const args = process.argv.slice(2)
const url = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'))
const clicks = []
args.forEach((a, i) => {
  if (a === '--click') clicks.push(args[i + 1])
})
if (!url) {
  console.error('usage: node scripts/check-hit-areas.mjs <url> [--click <selector>]…')
  process.exit(2)
}

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet portrait', width: 820, height: 1180 },
  { name: 'tablet landscape', width: 1180, height: 820 },
  { name: 'desktop', width: 1440, height: 900 },
]
const MIN = 47.5

function measure() {
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return false
    const s = getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none'
  }
  const describe = (el) =>
    el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30) || el.tagName
  return [...document.querySelectorAll('[data-hit]')].filter(visible).map((el) => {
    const r = el.getBoundingClientRect()
    return { name: describe(el), x: r.x, y: r.y, w: r.width, h: r.height }
  })
}

let failures = 0
const browser = await chromium.launch()
for (const vp of VIEWPORTS) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: true,
  })
  await page.goto(url)
  await page.waitForTimeout(800)
  const states = [['start', null], ...clicks.map((c) => [`after ${c}`, c])]
  for (const [label, selector] of states) {
    if (selector) {
      const target = page.locator(selector).first()
      if (!(await target.isVisible())) {
        console.log(`${vp.name} · ${label}: not on screen here, skipped`)
        continue
      }
      await target.click()
      await page.waitForTimeout(300)
    }
    const hits = await page.evaluate(measure)
    const small = hits.filter((h) => h.w < MIN || h.h < MIN)
    const overlaps = []
    for (let i = 0; i < hits.length; i++)
      for (let j = i + 1; j < hits.length; j++) {
        const a = hits[i]
        const b = hits[j]
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        if (ox > 0.5 && oy > 0.5) overlaps.push(`${a.name} × ${b.name}`)
      }
    const ok = !small.length && !overlaps.length
    if (!ok) failures++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${vp.name} · ${label}: ${hits.length} targets`)
    for (const h of small)
      console.log(`       under 48: ${h.name} (${h.w.toFixed(1)}×${h.h.toFixed(1)})`)
    for (const o of overlaps) console.log(`       overlap: ${o}`)
  }
  await page.close()
}
await browser.close()
process.exit(failures ? 1 : 0)
