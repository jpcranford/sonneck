// Renders dmg-background.svg into the 1x and 2x PNGs the .dmg window uses
// (dmgbuild joins dmg-background.png and dmg-background@2x.png into one
// Retina-ready image). Needs Playwright's Chromium, as in CLAUDE.md's
// "Live browser verification": run it with that install's index.mjs path,
//   PLAYWRIGHT=<path>/node_modules/playwright/index.mjs node render-dmg-background.mjs
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright')
const dir = path.dirname(fileURLToPath(import.meta.url))
const browser = await chromium.launch()
for (const scale of [1, 2]) {
  const page = await browser.newPage({ viewport: { width: 600, height: 500 }, deviceScaleFactor: scale })
  await page.goto(pathToFileURL(path.join(dir, 'dmg-background.svg')).href)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({
    path: path.join(dir, scale === 1 ? 'dmg-background.png' : 'dmg-background@2x.png'),
  })
  await page.close()
}
await browser.close()
