// Parsing and source-scanning behind /mockup/style-sampler. Everything the
// sampler shows is derived at load time from index.css and the app's own
// source files, so it stays current without hand edits: a new color token,
// a new text size or a new button style shows up on its own.

export interface SourceFile {
  name: string
  src: string
}

export interface ColorToken {
  name: string
  value: string
  note: string
  refersTo: string | null
}

export interface ColorGroup {
  label: string
  tokens: ColorToken[]
}

export interface FontStack {
  name: string
  stack: string
}

export interface Usage {
  count: number
  kinds: Map<string, number>
  files: Map<string, number>
}

function themeBody(css: string): string {
  const open = css.indexOf('{', css.indexOf('@theme'))
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
  }
  return ''
}

// The stylesheet minus its token definitions, so it can be scanned for
// usage like any other source file without counting a token's own
// definition (focus's `var(--color-accent)`) as a use.
export function withoutTheme(css: string): string {
  const body = themeBody(css)
  return body ? css.replace(body, '') : css
}

// `--color-*` declarations in `@theme`, grouped by the blank lines between
// them; the comment directly above a declaration is its note.
export function parseThemeColors(css: string): ColorGroup[] {
  const re = /\/\*([\s\S]*?)\*\/|(--color-[\w-]+)\s*:\s*([^;]+);|\n[ \t]*\n|--[\w-]+\s*:[^;]+;/g
  const groups: ColorToken[][] = [[]]
  let note = ''
  for (const m of themeBody(css).matchAll(re)) {
    if (m[1] !== undefined) {
      note = m[1].replace(/\s+/g, ' ').trim()
    } else if (m[2]) {
      const value = m[3].trim()
      const ref = /^var\(--color-([\w-]+)\)$/.exec(value)
      groups[groups.length - 1].push({
        name: m[2].slice('--color-'.length),
        value,
        note,
        refersTo: ref?.[1] ?? null,
      })
      note = ''
    } else {
      if (m[0].trim() === '' && groups[groups.length - 1].length > 0) groups.push([])
      note = ''
    }
  }
  return groups
    .filter((g) => g.length > 0)
    .map((tokens) => ({
      label: [...new Set(tokens.map((t) => t.name.split('-')[0]))].join(' · '),
      tokens,
    }))
}

// The dark theme's overrides (`:root[data-theme='dark']`), name → value.
export function parseDarkColors(css: string): Map<string, string> {
  const start = css.search(/:root\[data-theme=['"]?dark['"]?\]\s*\{/)
  if (start < 0) return new Map()
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  return new Map(
    [...body.matchAll(/--color-([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  )
}

export function parseFontStacks(css: string): FontStack[] {
  return [...themeBody(css).matchAll(/--font-([\w-]+)\s*:\s*([^;]+);/g)].map((m) => ({
    name: m[1],
    stack: m[2].trim(),
  }))
}

// family → the weight/style pairs self-hosted for it (each @font-face).
export function parseFontFaces(css: string): Map<string, string[]> {
  const faces = new Map<string, Set<string>>()
  for (const [block] of css.matchAll(/@font-face\s*\{[^}]*\}/g)) {
    const family = /font-family:\s*'([^']+)'/.exec(block)?.[1]
    if (!family) continue
    const weight = /font-weight:\s*([\w]+)/.exec(block)?.[1] ?? '400'
    const style = /font-style:\s*(\w+)/.exec(block)?.[1] ?? 'normal'
    const set = faces.get(family) ?? new Set()
    set.add(`${weight === 'normal' ? '400' : weight}${style === 'italic' ? ' italic' : ''}`)
    faces.set(family, set)
  }
  return new Map([...faces].map(([family, set]) => [family, [...set].sort()]))
}

// Comments mention colors and class names in passing; only code counts.
// One left-to-right pass, so a `/*` inside a line comment (or `//` inside a
// block comment) is read as part of that comment, not as a new one.
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/.*$/gm, (_, before) => before ?? '')
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const UTILITY_KIND: Record<string, string> = {
  bg: 'background',
  text: 'text',
  border: 'border',
  divide: 'border',
  ring: 'ring',
  outline: 'outline',
  fill: 'icon fill',
  stroke: 'icon stroke',
  from: 'gradient',
  via: 'gradient',
  to: 'gradient',
  decoration: 'underline',
  placeholder: 'placeholder',
  caret: 'caret',
  accent: 'form accent',
  shadow: 'shadow',
}
const UTILITY =
  '(bg|text|border(?:-[trblxy])?|divide|ring(?:-offset)?|outline|fill|stroke|from|via|to|decoration|placeholder|caret|accent|shadow)'

function emptyUsage(): Usage {
  return { count: 0, kinds: new Map(), files: new Map() }
}

function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1)
}

// Every Tailwind utility (any variant, any opacity modifier) or var()
// reference naming this color.
export function colorUsage(name: string, files: SourceFile[]): Usage {
  const re = new RegExp(
    `(?<![\\w-])(?:[\\w-]+:)*${UTILITY}-${escapeRe(name)}(?:/\\d+)?(?![\\w-])|var\\(--color-${escapeRe(name)}\\)`,
    'g',
  )
  const usage = emptyUsage()
  for (const file of files) {
    for (const m of file.src.matchAll(re)) {
      const kind = m[1] ? UTILITY_KIND[m[1].split('-')[0]] : 'CSS var()'
      usage.count++
      bump(usage.kinds, kind)
      bump(usage.files, file.name)
    }
  }
  return usage
}

export interface LiteralColor {
  // A hex value, or a Tailwind palette name like "red-700".
  value: string
  swatch: string
  usage: Usage
}

const PALETTE =
  '(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\\d{2,3}|white|black'

// Colors written straight into components rather than through a token —
// the ones a dark mode would have to hunt down one by one.
export function literalColors(files: SourceFile[]): LiteralColor[] {
  const found = new Map<string, LiteralColor>()
  const hex = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])/g
  const palette = new RegExp(
    `(?<![\\w-])(?:[\\w-]+:)*${UTILITY}-(${PALETTE})(?:/\\d+)?(?![\\w-])`,
    'g',
  )
  const add = (value: string, swatch: string, kind: string, file: string) => {
    const entry = found.get(value) ?? { value, swatch, usage: emptyUsage() }
    entry.usage.count++
    bump(entry.usage.kinds, kind)
    bump(entry.usage.files, file)
    found.set(value, entry)
  }
  for (const file of files) {
    for (const m of file.src.matchAll(hex)) {
      const value = m[0].toLowerCase()
      add(value, value, 'hex', file.name)
    }
    for (const m of file.src.matchAll(palette)) {
      add(m[2], `var(--color-${m[2]})`, UTILITY_KIND[m[1].split('-')[0]], file.name)
    }
  }
  return [...found.values()].sort((a, b) => b.usage.count - a.usage.count)
}

// ---- Type styles ----

const SIZE_TOKEN = /^text-(xs|sm|base|lg|xl|[2-9]xl|\[[\d.]+(?:px|rem|em)\])$/
// Tailwind v4's default type scale: [font-size, line-height] in px.
const SIZE_PX: Record<string, [number, number]> = {
  xs: [12, 16],
  sm: [14, 20],
  base: [16, 24],
  lg: [18, 28],
  xl: [20, 28],
  '2xl': [24, 32],
  '3xl': [30, 36],
  '4xl': [36, 40],
  '5xl': [48, 48],
  '6xl': [60, 60],
}
const WEIGHTS: Record<string, number> = {
  thin: 100,
  extralight: 200,
  light: 300,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
}

export interface TypeStyle {
  key: string
  family: string
  sizeToken: string
  px: number
  lineHeightPx: number | null
  weight: number
  italic: boolean
  uppercase: boolean
  usage: Usage
}

export function sizeOf(token: string): [number, number | null] {
  const step = token.slice('text-'.length)
  if (SIZE_PX[step]) return SIZE_PX[step]
  const m = /^\[([\d.]+)(px|rem|em)\]$/.exec(step)
  if (!m) return [16, null]
  return [m[2] === 'px' ? Number(m[1]) : Number(m[1]) * 16, null]
}

function tokensOf(literal: string): string[] {
  return literal
    .split(/\s+/)
    .map((t) => t.replace(/^[^\w[-]+|[^\w\]%/.-]+$/g, ''))
    .filter(Boolean)
}

// Every distinct family/size/weight/style combination set in a class
// string. A family set on a parent element isn't seen, so a size with no
// font-* class of its own counts as the inherited sans.
export function typeStyles(files: SourceFile[]): TypeStyle[] {
  const styles = new Map<string, TypeStyle>()
  for (const file of files) {
    for (const m of file.src.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)) {
      const tokens = tokensOf(m[1] ?? m[2] ?? m[3])
      const sizes = tokens.filter((t) => SIZE_TOKEN.test(t))
      if (sizes.length === 0) continue
      const family =
        tokens.find((t) => /^font-(display|sans|mono|music)$/.test(t))?.slice(5) ?? 'sans'
      const weightToken = tokens.find((t) => /^font-\w+$/.test(t) && WEIGHTS[t.slice(5)])
      const weight = weightToken ? WEIGHTS[weightToken.slice(5)] : 400
      const italic = tokens.includes('italic')
      const uppercase = tokens.includes('uppercase')
      for (const sizeToken of new Set(sizes)) {
        const key = [family, sizeToken, weight, italic, uppercase].join('|')
        const [px, lineHeightPx] = sizeOf(sizeToken)
        const style = styles.get(key) ?? {
          key,
          family,
          sizeToken,
          px,
          lineHeightPx,
          weight,
          italic,
          uppercase,
          usage: emptyUsage(),
        }
        style.usage.count++
        bump(style.usage.files, file.name)
        styles.set(key, style)
      }
    }
  }
  return [...styles.values()].sort(
    (a, b) => b.px - a.px || b.weight - a.weight || b.usage.count - a.usage.count,
  )
}

// ---- Buttons and fields ----

export type ControlKind =
  'Primary' | 'Secondary' | 'Destructive' | 'Quiet' | 'Text field' | 'Text area' | 'Select'

export interface ControlStyle {
  kind: ControlKind
  tag: string
  // The first occurrence's classes, minus placement (margins, widths,
  // positioning), which belong to where it sits, not to how it looks.
  renderClass: string
  signature: string
  usage: Usage
}

const PLACEMENT =
  /^-?(m[trblxy]?-|w-|min-w|max-w|h-|min-h|max-h|size-|flex-1$|shrink|grow|basis-|self-|order-|col-|row-|hidden$|block$|absolute$|relative$|fixed$|sticky$|top-|left-|right-|bottom-|inset|z-|translate-|-translate-)/
const NOT_VISUAL =
  /^(cursor-|flex$|inline-flex$|grid$|items-|justify-|gap-|whitespace-|overflow-|transition|duration-|ease-|select-|text-left$|text-center$|truncate$|leading-|outline-none$|appearance-none$|resize|pointer-events|origin-|transform$|tabular|group$|peer$|sr-only$)/

function baseOf(token: string): string {
  return token.slice(token.lastIndexOf(':') + 1)
}

function classify(tag: string, tokens: string[]): ControlKind | null {
  if (tag === 'input') return 'Text field'
  if (tag === 'textarea') return 'Text area'
  if (tag === 'select') return 'Select'
  if (tokens.some((t) => /^bg-accent(-fill)?(\/|$)/.test(t))) return 'Primary'
  if (tokens.some((t) => /^(text|bg|border)-(red-|danger)/.test(t))) return 'Destructive'
  if (tokens.includes('border') || tokens.some((t) => t.startsWith('bg-'))) return 'Secondary'
  if (tag === 'button') return 'Quiet'
  return null
}

export function controlStyles(files: SourceFile[]): ControlStyle[] {
  const styles = new Map<string, ControlStyle>()
  const re = /<(button|input|textarea|select|a|Link)\b[^>]*?className=(?:"([^"]*)"|\{`([^`]*)`\})/gs
  for (const file of files) {
    for (const m of file.src.matchAll(re)) {
      const tag = m[1]
      const raw = (m[2] ?? m[3]).replace(/\$\{[^}]*\}/g, ' ')
      const all = raw.split(/\s+/).filter(Boolean)
      const visual = all
        .filter((t) => !t.includes(':') && !PLACEMENT.test(t) && !NOT_VISUAL.test(t))
        .sort()
      if (!visual.some((t) => /^(bg|text|border)-/.test(t) || t === 'border')) continue
      if (
        (tag === 'a' || tag === 'Link') &&
        !(visual.some((t) => t.startsWith('rounded')) && visual.some((t) => /^p[xy]?-/.test(t)))
      )
        continue
      if (tag === 'input' && all.includes('hidden')) continue
      const kind = classify(tag, visual)
      if (!kind) continue
      const signature = `${kind === 'Text field' || kind === 'Text area' || kind === 'Select' ? tag : 'button'}|${visual.join(' ')}`
      const style = styles.get(signature) ?? {
        kind,
        tag,
        renderClass: all.filter((t) => !PLACEMENT.test(baseOf(t))).join(' '),
        signature: visual.join(' '),
        usage: emptyUsage(),
      }
      style.usage.count++
      bump(style.usage.files, file.name)
      styles.set(signature, style)
    }
  }
  return [...styles.values()].sort((a, b) => b.usage.count - a.usage.count)
}

export function topFiles(usage: Usage, limit = 6): { shown: string[]; more: number } {
  const sorted = [...usage.files].sort((a, b) => b[1] - a[1]).map(([name]) => name)
  return { shown: sorted.slice(0, limit), more: Math.max(0, sorted.length - limit) }
}
