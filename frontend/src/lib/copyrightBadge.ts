import {
  IconCopyleftFilled,
  IconCopyright,
  IconShieldCheck,
  IconShieldCheckFilled,
} from '@tabler/icons-react'
import type { CopyrightStatus } from '../api/types'

// Public Domain Badge feature — shared between the real Piece Details page
// (PiecePage.tsx) and its mockup (PieceDetailsSample.tsx), unlike most
// mockup-vs-real pairs in this app: this is pure presentational data (icon
// components, color classes, tooltip copy), the same "shared, not
// duplicated" treatment lib/formatPieceMeta.ts/lib/textCase.ts already get,
// not markup or a visual redesign.
//
// Option A (bare icon, no circle chip) + Grass green — both locked in the
// design artifact §5. Likely Public Domain/In Copyright use a neutral tone
// matching this page's other bare icons (e.g. the IMSLP external-link
// icon's own #9d9892).

// Literal, static Tailwind arbitrary-value classes (not built via string
// interpolation) — Tailwind's JIT scanner needs the full class string to
// appear verbatim in the source, so these are declared once here and
// referenced by key, never assembled at runtime from just the hex.
const GRASS_ICON_CLASS = 'text-[#3fa34d]'
const NEUTRAL_ICON_CLASS = 'text-[#9d9892]'

export const COPYRIGHT_BADGE_META: Record<
  CopyrightStatus,
  { label: string; icon: typeof IconShieldCheck; colorClass: string }
> = {
  publicDomain: { label: 'In Public Domain', icon: IconShieldCheckFilled, colorClass: GRASS_ICON_CLASS },
  likelyPublicDomain: { label: 'Likely Public Domain', icon: IconShieldCheck, colorClass: NEUTRAL_ICON_CLASS },
  inCopyright: { label: 'In Copyright', icon: IconCopyright, colorClass: NEUTRAL_ICON_CLASS },
  copyleft: { label: 'Copyleft', icon: IconCopyleftFilled, colorClass: GRASS_ICON_CLASS },
}

// Hover text — sentence case app-wide (first letter capital, rest
// lowercase), matching every other InfoTooltip message in this codebase
// (e.g. "Inherited from book"), NOT the Title Case used for the status's
// own name/label above (dropdown options, Advanced panel row). "as of
// {year}" only for the two PD-ish states, and only when an expiry year is
// actually computable. The PD states' own base text has no leading "In"
// per the original feature request's own example ("Public Domain as of
// 2005"), unlike "In copyright" below, which keeps its "In".
export function copyrightTooltipText(status: CopyrightStatus, expiryYear: number | null): string {
  switch (status) {
    case 'publicDomain':
      return expiryYear != null ? `Public domain as of ${expiryYear}` : 'Public domain'
    case 'likelyPublicDomain':
      return expiryYear != null ? `Likely public domain as of ${expiryYear}` : 'Likely public domain'
    case 'inCopyright':
      return 'In copyright'
    case 'copyleft':
      return 'Copyleft'
  }
}
