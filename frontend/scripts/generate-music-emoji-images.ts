// Regenerates docs/music-emoji-images/*.png — the symbol previews used by
// docs/music-emoji.md. Run via `npm run generate:music-emoji-images` from
// frontend/ (see CONTRIBUTING.md's "Music symbol shortcodes" section for
// when this needs to be re-run).
//
// Nothing about the symbol list is hand-maintained here: it's derived
// directly from MUSIC_SHORTCODES (src/lib/musicEmoji.ts, the actual
// runtime source of truth), and every image is rendered live from the
// actual shipped font subset (src/assets/fonts/bravura-text-subset.woff2)
// rather than mocked up separately — so both stay correct automatically
// whenever the shortcode list or the font subset changes, as long as this
// script gets re-run.
//
// One filename-derivation choice worth knowing: MUSIC_SHORTCODES has
// several keys per symbol (e.g. `piano` and `p` both map to the same
// character) and always declares the descriptive word before its terse
// alias. This script keeps only the first key seen per unique character as
// that symbol's filename slug, which naturally picks "piano.png" over
// "p.png" for free, without a separate name-lookup table to keep in sync.

/// <reference lib="dom" />
// This file otherwise runs under tsconfig.node.json (no DOM lib, this is a
// Node script) — the one exception is page.evaluate()'s callback below,
// which Playwright actually executes inside the browser page, so it's
// legitimately DOM code living inside a Node file.

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { MUSIC_SHORTCODES } from '../src/lib/musicEmoji.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FONT_PATH = path.resolve(__dirname, '../src/assets/fonts/bravura-text-subset.woff2')
const OUT_DIR = path.resolve(__dirname, '../../docs/music-emoji-images')

function uniqueSymbols(): Array<{ slug: string; char: string }> {
  const seen = new Map<string, string>()
  for (const [code, char] of Object.entries(MUSIC_SHORTCODES)) {
    if (!seen.has(char)) seen.set(char, code)
  }
  return Array.from(seen, ([char, slug]) => ({ slug, char }))
}

async function main() {
  if (!existsSync(FONT_PATH)) {
    throw new Error(`Font subset not found at ${FONT_PATH}`)
  }
  mkdirSync(OUT_DIR, { recursive: true })

  const fontBase64 = readFileSync(FONT_PATH).toString('base64')
  const symbols = uniqueSymbols()

  const browser = await chromium.launch()
  // deviceScaleFactor 4: these are tiny glyphs blown up to fill a table
  // cell in the doc, so a plain 1x render looks visibly soft next to
  // surrounding sharp text.
  const page = await browser.newPage({ deviceScaleFactor: 4 })

  for (const { slug, char } of symbols) {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      @font-face {
        font-family: 'Bravura Text';
        src: url(data:font/woff2;base64,${fontBase64}) format('woff2');
      }
      html, body { margin: 0; padding: 0; }
      .wrap {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 6px 10px;
        font-family: 'Bravura Text';
        font-size: 40px;
        line-height: 1;
        /* --color-paper (frontend/src/index.css), not transparent or plain
           white: GitHub renders this doc in both light and dark mode, and
           a transparent PNG would make the dark-ink glyphs unreadable
           against a dark page background. An opaque light background,
           matching the app's own paper token, keeps every glyph readable
           regardless of the viewer's theme. */
        background: #fbfaf8;
        color: #1c1815;
        white-space: nowrap;
      }
    </style></head><body><span class="wrap" id="s">${char}</span></body></html>`

    await page.setContent(html)
    await page.evaluate(() => document.fonts.ready)
    await page
      .locator('#s')
      .screenshot({ path: path.join(OUT_DIR, `${slug}.png`) })
    console.log(`wrote ${slug}.png`)
  }

  await browser.close()
  console.log(`\nDone — ${symbols.length} symbols written to ${path.relative(process.cwd(), OUT_DIR)}`)
}

main()
