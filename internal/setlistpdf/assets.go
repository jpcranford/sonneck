package setlistpdf

import _ "embed"

// Real TTF files sourced directly from Google Fonts (the same families
// this app already self-hosts as woff2 for the web UI, SIL OFL 1.1) —
// fpdf needs real font bytes to embed, and this repo has no TTF/OTF
// source format checked in anywhere else. Weights match what the four
// locked page designs actually use; see the plan file's "Download Set
// PDF" section for the live verification that Libre Baskerville genuinely
// has a real 700 upstream (this app's own web subset only ever needed
// 400/500, so it never had reason to check one in before now).

//go:embed assets/fonts/LibreBaskerville-Regular.ttf
var fontLibreBaskervilleRegular []byte

//go:embed assets/fonts/LibreBaskerville-Italic.ttf
var fontLibreBaskervilleItalic []byte

//go:embed assets/fonts/LibreBaskerville-Bold.ttf
var fontLibreBaskervilleBold []byte

//go:embed assets/fonts/Cabin-Regular.ttf
var fontCabinRegular []byte

//go:embed assets/fonts/Cabin-Italic.ttf
var fontCabinItalic []byte

//go:embed assets/fonts/Cabin-SemiBold.ttf
var fontCabinSemiBold []byte

//go:embed assets/fonts/Cabin-Bold.ttf
var fontCabinBold []byte

//go:embed assets/fonts/Cabin-BoldItalic.ttf
var fontCabinBoldItalic []byte

// BravuraText-subset.ttf — the same SMuFL music-symbol glyphs the web app
// self-hosts as bravura-text-subset.woff2 (SIL OFL 1.1, Steinberg Media
// Technologies GmbH), re-subsetted fresh from the authoritative source
// release (steinbergmedia/bravura's BravuraText.otf, v1.482, matching the
// web font's own embedded version string exactly — confirmed live via
// GitHub's release API) rather than converting the already-woff2-packaged
// derivative, using the identical 26-codepoint unicode-range the web
// @font-face already documents (index.css). fpdf's TTF parser requires
// real TrueType glyph outlines (a `glyf`/`loca` table pair) — Bravura
// ships CFF/PostScript outlines only (confirmed: no .ttf exists in any
// recent upstream release), so the subset was converted CFF->TrueType via
// fonttools' cu2qu-based otf2ttf after subsetting, not before — subsetting
// first keeps the conversion's cubic-to-quadratic curve-fitting work
// scoped to only the 26 glyphs this app actually uses.
//
//go:embed assets/fonts/BravuraText-subset.ttf
var fontBravuraText []byte

// The real Sonneck S-mark (components/SonneckMark.tsx / assets/brand/
// sonneck-s-mark.svg), rasterized once to a transparent PNG with the
// ink-soft (#5c5349) fill already baked in — matches the colophon's own
// locked design exactly (the seal recolored to match the credit text
// above it). fpdf has no general SVG-path renderer, so this is drawn as
// an image rather than reconstructed from the original Bézier path data.
//
//go:embed assets/sonneck-s-mark.png
var sonneckSMarkPNG []byte
