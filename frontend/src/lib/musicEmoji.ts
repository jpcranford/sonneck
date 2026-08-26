import { findAndReplace } from 'mdast-util-find-and-replace'
import type { Root } from 'mdast'
import type { Plugin } from 'unified'

// Shortcode -> the literal Unicode character it stands for. Values are the
// Bravura Text subset's codepoints (see index.css's font-face comment and
// frontend/src/assets/fonts/bravura-text-subset.woff2) — this map is only
// ever the "first listed" codepoint per symbol, i.e. what actually gets
// inserted; a symbol's other SMuFL/Unicode codepoints (if it has one) are
// handled purely at the font level, not here.
//
// \uXXXX escapes throughout, deliberately, even for the three that have a
// normal printable form (♭/E/F) — most of these are Private Use Area
// codepoints with no visible glyph of their own outside this font, so a
// literal character here would be unverifiable (and effectively invisible)
// in a plain editor; escaping all of them keeps the table self-describing
// and consistent rather than mixing literal and escaped forms.
export const MUSIC_SHORTCODES: Record<string, string> = {
  piano: '',
  p: '',
  mezzo: '',
  m: '',
  forte: '',
  f: '',
  pianissimo: '',
  pp: '',
  mezzopiano: '',
  mp: '',
  mezzoforte: '',
  mf: '',
  fortissimo: '',
  ff: '',
  flat: '\u266D',
  b: '\u266D',
  natural: '\u266E',
  sharp: '\u266F',
  '#': '\u266F',
  doublesharp: '',
  '##': '',
  doubleflat: '',
  bb: '',
  dalsegno: '',
  ds: '',
  dacapo: '',
  dc: '',
  segno: '',
  coda: '',
  treble: '',
  alto: '',
  bass: '',
  glasses: '',
  look: '',
}

// Longest-first purely so alternation never has to backtrack to find the
// right branch — the surrounding colons already make every branch's match
// unambiguous on their own, this is just a habit for regex alternation.
const shortcodePattern = new RegExp(
  `:(${Object.keys(MUSIC_SHORTCODES)
    .sort((a, b) => b.length - a.length)
    .map((code) => code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')}):`,
  'g',
)

// Turns a `:shortcode:` into the plain Unicode character it stands for —
// by the time this reaches the DOM it's ordinary text; the Bravura Text
// @font-face (index.css) is what actually renders that character as a
// music glyph, this plugin does no font/rendering work itself. Built on
// mdast-util-find-and-replace (already a transitive dependency via
// remark-breaks, added here as a direct one) rather than a hand-rolled
// unist-util-visit + node.value.replace pass, for the same reason a
// remark-gemoji-style plugin would: it only ever touches `text` mdast
// nodes, which already excludes code spans/blocks (those store their
// content as a plain string value, not child text nodes) — so someone
// showing ":flat:" as a literal example inside a code span is untouched.
export const remarkMusicEmoji: Plugin<[], Root> = () => (tree) => {
  findAndReplace(tree, [shortcodePattern, (_match: string, code: string) => MUSIC_SHORTCODES[code]])
}
