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

// The real Sonneck S-mark (components/SonneckMark.tsx / assets/brand/
// sonneck-s-mark.svg), rasterized once to a transparent PNG with the
// ink-soft (#5c5349) fill already baked in — matches the colophon's own
// locked design exactly (the seal recolored to match the credit text
// above it). fpdf has no general SVG-path renderer, so this is drawn as
// an image rather than reconstructed from the original Bézier path data.
//
//go:embed assets/sonneck-s-mark.png
var sonneckSMarkPNG []byte
