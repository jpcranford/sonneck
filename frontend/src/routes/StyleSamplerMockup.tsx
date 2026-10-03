import { useEffect, useState, type ReactNode } from 'react'
import {
  IconBooks,
  IconCalendar,
  IconFilter,
  IconHeart,
  IconMusic,
  IconPencil,
  IconPlaylist,
  IconSearch,
  IconTrash,
  IconUpload,
  IconUsers,
} from '@tabler/icons-react'
import indexCss from '../index.css?raw'
import { useMockupTitle } from '../lib/useMockupTitle'
import { Toggle } from '../components/Toggle'
import { SingleSelect } from '../components/SingleSelect'
import { TagComboBox } from '../components/TagComboBox'
import { TagPills } from '../components/TagPills'
import { InfoIconTooltip } from '../components/InfoIconTooltip'
import type { Tag } from '../api/types'
import {
  colorUsage,
  controlStyles,
  literalColors,
  parseFontFaces,
  parseFontStacks,
  parseThemeColors,
  stripComments,
  topFiles,
  typeStyles,
  withoutTheme,
  type ColorToken,
  type ControlKind,
  type SourceFile,
  type TypeStyle,
  type Usage,
} from '../lib/styleSampler'

// A reference of the app's visual style as it stands, for prototyping
// against (dark mode first). Unlike every other mockup it is never
// hand-maintained: colors and fonts come from index.css, usage counts,
// type styles and button/field styles from scanning the app's own source
// (mockups excluded), and the shared field components are the real ones.
// Only the example window below is hand-built, out of the color tokens.

// Loaded on demand, so the source text is only fetched on this page.
const SOURCES = import.meta.glob<string>(
  [
    '../**/*.{ts,tsx}',
    '!../**/*Mockup.tsx',
    '!../**/*Sample.tsx',
    '!../**/*.test.{ts,tsx}',
    '!../lib/styleSampler.ts',
  ],
  { query: '?raw', import: 'default' },
)

function useSources(): SourceFile[] | null {
  const [files, setFiles] = useState<SourceFile[] | null>(null)
  useEffect(() => {
    let live = true
    Promise.all(
      Object.entries(SOURCES).map(async ([path, load]) => ({
        name: path
          .split('/')
          .pop()!
          .replace(/\.tsx?$/, ''),
        src: stripComments(await load()),
      })),
    ).then(
      (loaded) =>
        live &&
        setFiles([...loaded, { name: 'index.css', src: stripComments(withoutTheme(indexCss)) }]),
    )
    return () => {
      live = false
    }
  }, [])
  return files
}

const SECTIONS = [
  ['colors', 'Colors'],
  ['literal-colors', 'Hard-coded colors'],
  ['example', 'Example window'],
  ['type', 'Type'],
  ['controls', 'Buttons & fields'],
] as const

export function StyleSamplerMockup() {
  useMockupTitle('Style Sampler')
  const files = useSources()

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">
      <h1 className="font-display text-3xl font-medium text-ink">Style Sampler</h1>
      <p className="mt-2 max-w-3xl text-sm text-ink-soft">
        The app’s visual style at a glance. Read live from{' '}
        <code className="font-mono">index.css</code> and the app’s own source on every load, so
        nothing here is maintained by hand except the example window.
      </p>
      <nav className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="text-accent hover:underline">
            {label}
          </a>
        ))}
      </nav>

      <ColorSection files={files} />
      <LiteralColorSection files={files} />
      <ExampleWindowSection />
      <TypeSection files={files} />
      <ControlSection files={files} />
    </div>
  )
}

function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string
  title: string
  intro: ReactNode
  children: ReactNode
}) {
  return (
    <section id={id} className="mt-12 scroll-mt-6">
      <h2 className="font-display text-2xl font-medium text-ink">{title}</h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-soft">{intro}</p>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function Loading() {
  return <p className="text-sm text-ink-soft">Scanning source…</p>
}

function UsageLine({ usage, showKinds = true }: { usage: Usage; showKinds?: boolean }) {
  if (usage.count === 0) return <p className="text-xs text-danger">Not used anywhere in the app.</p>
  const { shown, more } = topFiles(usage)
  const kinds = [...usage.kinds].sort((a, b) => b[1] - a[1])
  return (
    <p className="text-xs text-ink-soft">
      {showKinds && (
        <>
          {kinds.map(([kind, n]) => `${kind} ×${n}`).join(' • ')}
          {' — '}
        </>
      )}
      {usage.files.size} {usage.files.size === 1 ? 'file' : 'files'}: {shown.join(', ')}
      {more > 0 && ` +${more} more`}
    </p>
  )
}

// ---- Colors ----

function Swatch({ color, size = 32 }: { color: string; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-md border border-ink/15"
      style={{ width: size, height: size, background: color }}
    />
  )
}

function ColorSection({ files }: { files: SourceFile[] | null }) {
  const groups = parseThemeColors(indexCss)
  const all = groups.flatMap((g) => g.tokens)
  const defined = new Set(all.map((t) => t.name))
  const aliasesOf = (name: string) => all.filter((t) => t.refersTo === name)

  return (
    <Section
      id="colors"
      title="Colors"
      intro={
        <>
          Every <code className="font-mono">--color-*</code> token in{' '}
          <code className="font-mono">index.css</code>’s <code className="font-mono">@theme</code>,
          in its own groups. The note under a name is the comment above it in the stylesheet; usage
          counts every utility class and <code className="font-mono">var()</code> naming it. A token
          defined as another token is listed under that one.
        </>
      }
    >
      <div className="flex flex-col gap-8">
        {groups.map((group) => {
          const roots = group.tokens.filter((t) => !t.refersTo || !defined.has(t.refersTo))
          if (roots.length === 0) return null
          return (
            <div key={group.label}>
              <h3 className="text-xs font-semibold tracking-wide text-ink-soft uppercase">
                {group.label}
              </h3>
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-paper-raised">
                {roots.map((token) => (
                  <ColorRow
                    key={token.name}
                    token={token}
                    aliases={aliasesOf(token.name)}
                    files={files}
                  />
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

function ColorRow({
  token,
  aliases,
  files,
}: {
  token: ColorToken
  aliases: ColorToken[]
  files: SourceFile[] | null
}) {
  return (
    <li className="flex gap-4 p-4">
      <Swatch color={`var(--color-${token.name}, ${token.value})`} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-3">
          <span className="font-mono text-sm font-semibold text-ink">--color-{token.name}</span>
          <span className="font-mono text-xs text-ink-soft">{token.value}</span>
        </p>
        {token.note && <p className="mt-1 text-sm text-ink">{token.note}</p>}
        <div className="mt-1">
          {files ? <UsageLine usage={colorUsage(token.name, files)} /> : <Loading />}
        </div>
        {aliases.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2 border-l-2 border-border pl-4">
            {aliases.map((alias) => (
              <li key={alias.name}>
                <p className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-mono text-sm font-semibold text-ink">
                    --color-{alias.name}
                  </span>
                  <span className="font-mono text-xs text-ink-soft">= {alias.value}</span>
                </p>
                {alias.note && <p className="mt-0.5 text-sm text-ink">{alias.note}</p>}
                <div className="mt-0.5">
                  {files ? <UsageLine usage={colorUsage(alias.name, files)} /> : <Loading />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  )
}

// Hard-coded colors that aren't a style at all, shown with the color they
// belong to for as long as that file still uses it.
const LITERAL_NOTES: { value: string; file: string; note: string }[] = [
  {
    value: '#ffffff',
    file: 'AdminPage',
    note: 'Not a style: the Share on Network QR code’s light color. Fixed white in every theme so the code stays scannable.',
  },
  {
    value: '#1a1a1a',
    file: 'AdminPage',
    note: 'Not a style: the Share on Network QR code’s dark color. Fixed in every theme so the code stays scannable.',
  },
  {
    value: 'white',
    file: 'AdminPage',
    note: 'Not a style in AdminPage’s QR code tile (bg-white), which stays white in every theme so the code stays scannable.',
  },
]

function LiteralColorSection({ files }: { files: SourceFile[] | null }) {
  const colors = files ? literalColors(files) : null
  return (
    <Section
      id="literal-colors"
      title="Hard-coded colors"
      intro="Colors written straight into components instead of through a token: hex values and Tailwind palette classes (white, black…). A dark mode can’t reach these through the tokens, so each would need its own treatment."
    >
      {!colors ? (
        <Loading />
      ) : (
        <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {colors.map((color) => (
            <li key={color.value} className="flex gap-3">
              <Swatch color={color.swatch} />
              <div className="min-w-0">
                <p className="font-mono text-sm font-semibold text-ink">{color.value}</p>
                <UsageLine
                  usage={color.usage}
                  showKinds={color.usage.kinds.size > 1 || !color.usage.kinds.has('hex')}
                />
                {LITERAL_NOTES.filter(
                  (n) => n.value === color.value && color.usage.files.has(n.file),
                ).map((n) => (
                  <p key={n.file} className="mt-0.5 text-xs font-medium text-ink">
                    {n.note}
                  </p>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

// ---- Example window ----

// Hand-built from the tokens (and the two palette colors the app leans on,
// white on accent and red for delete), so retuning a token retunes it.
function ExampleWindowSection() {
  return (
    <Section
      id="example"
      title="Example window"
      intro="A Library-like screen drawn with the color tokens: sidebar, toolbar, cards, pills, a callout, a focused field and an open context menu."
    >
      <div className="flex h-[520px] overflow-hidden rounded-xl border border-border shadow-sm">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar-bg p-3 sm:flex">
          <p className="px-2 py-2 font-display text-lg font-medium text-sidebar-text">Sonneck</p>
          <nav className="mt-2 flex flex-col gap-0.5">
            {[
              [IconMusic, 'Library', true],
              [IconBooks, 'Books', false],
              [IconUsers, 'People', false],
              [IconUpload, 'Upload', false],
            ].map(([Icon, label, active]) => {
              const I = Icon as typeof IconMusic
              return (
                <span
                  key={label as string}
                  className={`flex h-10 items-center gap-3 rounded-md px-2 font-display text-base font-medium text-sidebar-text ${
                    active ? 'bg-sidebar-panel' : 'hover:bg-white/5'
                  }`}
                >
                  <I size={24} />
                  {label as string}
                </span>
              )
            })}
          </nav>
          <div className="mx-2 my-3 border-t border-sidebar-border" />
          <p className="px-2 text-xs tracking-wide text-sidebar-text-dim uppercase">
            Upcoming Sets
          </p>
          <span className="mt-1 flex items-center gap-2 rounded-md px-2 py-1.5 font-display text-sm font-medium text-sidebar-text">
            <IconPlaylist size={16} className="text-accent-on-dark" />
            <span className="min-w-0 flex-1 truncate">Lessons and Carols</span>
            <span className="font-sans text-xs font-normal text-sidebar-text-dim">Dec 13</span>
          </span>
          <div className="mt-auto flex items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-panel p-2">
            <span className="flex size-7 items-center justify-center rounded-full bg-accent-on-dark text-xs font-semibold text-sidebar-bg">
              A
            </span>
            <span className="text-base text-sidebar-text">Admin</span>
          </div>
        </aside>

        <div className="relative min-w-0 flex-1 overflow-hidden bg-paper p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="mr-auto font-display text-xl font-medium text-ink">Library</h3>
            <span className="flex h-9 w-48 items-center gap-2 rounded-md border border-border bg-paper-raised px-3 text-sm text-ink-soft outline-2 outline-offset-2 outline-focus">
              <IconSearch size={15} />
              Search…
            </span>
            <button
              type="button"
              className="flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-paper-raised px-3 text-sm text-ink"
            >
              <IconFilter size={15} />
              Filters
            </button>
            <button
              type="button"
              className="flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-accent px-3 font-display text-sm text-white"
            >
              <IconUpload size={15} />
              Upload
            </button>
          </div>

          <p className="mt-4 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">
            3 pieces match <span className="font-semibold">Learning</span>.
          </p>

          <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
            {[
              ['Nocturne in E♭ Major', 'Chopin • Op. 9, No. 2', 'E♭ Major'],
              ['Clair de lune', 'Debussy • Suite bergamasque', 'D♭ Major'],
              ['Gymnopédie No. 1', 'Satie', 'D Major'],
            ].map(([title, meta, key], i) => (
              <div
                key={title}
                className={`overflow-hidden rounded-lg border border-border bg-paper-raised ${i === 2 ? 'hidden lg:block' : ''}`}
              >
                <div className="flex h-28 items-center justify-center bg-paper-sunken text-ink-soft">
                  <IconMusic size={28} />
                </div>
                <div className="p-3">
                  <p className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 font-display font-medium text-ink">
                      {title}
                    </span>
                    {i === 0 && (
                      <IconHeart size={16} className="mt-1 shrink-0 fill-accent text-accent" />
                    )}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-soft">{meta}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {i === 0 && (
                      <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                        Learning
                      </span>
                    )}
                    <span className="rounded-full border border-border bg-paper px-2 py-0.5 text-xs text-ink-soft">
                      {key}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="absolute right-6 bottom-6 w-52 rounded-lg border border-border bg-paper-raised py-1 shadow-lg">
            {[
              [IconPencil, 'Edit Piece', ''],
              [IconCalendar, 'Add to Setlist', 'bg-accent-soft'],
            ].map(([Icon, label, cls]) => {
              const I = Icon as typeof IconMusic
              return (
                <span
                  key={label as string}
                  className={`flex items-center gap-2 px-3 py-1.5 text-sm text-ink ${cls}`}
                >
                  <I size={15} className="text-ink-soft" />
                  {label as string}
                </span>
              )
            })}
            <div className="my-1 border-t border-border" />
            <span className="flex items-center gap-2 px-3 py-1.5 text-sm text-danger">
              <IconTrash size={15} />
              Delete Piece
            </span>
          </div>
        </div>
      </div>
    </Section>
  )
}

// ---- Type ----

const SAMPLE_TEXT: Record<string, string> = {
  display: 'Nocturne in E♭ Major, Op. 9 No. 2',
  sans: 'Composer, arranger & publisher — 1234567890',
  mono: 'IMSLP 12345 • 978-0-19-386391-2',
  music: '♭ ♯ ♮ — dynamics and accidentals',
}

function TypeSection({ files }: { files: SourceFile[] | null }) {
  const stacks = parseFontStacks(indexCss)
  const faces = parseFontFaces(indexCss)
  const styles = files ? typeStyles(files) : null
  const families = [...new Set(['display', 'sans', ...(styles?.map((s) => s.family) ?? [])])]

  return (
    <Section
      id="type"
      title="Type"
      intro={
        <>
          Each family’s stack and self-hosted cuts from <code className="font-mono">index.css</code>
          , then every size/weight/style combination set in a class string, largest first. A family
          set on a parent element isn’t visible to the scan, so a size with no{' '}
          <code className="font-mono">font-*</code> class of its own is counted as sans.
        </>
      }
    >
      {!styles ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-10">
          {families.map((family) => {
            const stack = stacks.find((s) => s.name === family)?.stack
            const primary = /'([^']+)'/.exec(stack ?? '')?.[1]
            return (
              <div key={family}>
                <div className="rounded-lg border border-border bg-paper-sunken p-4">
                  <p className="font-mono text-sm font-semibold text-ink">font-{family}</p>
                  {stack && <p className="mt-1 font-mono text-xs text-ink-soft">{stack}</p>}
                  {primary && faces.get(primary) && (
                    <p className="mt-1 text-xs text-ink-soft">
                      {primary}, self-hosted: {faces.get(primary)!.join(', ')}
                    </p>
                  )}
                  <p
                    className="mt-3 text-2xl text-ink"
                    style={{ fontFamily: `var(--font-${family})` }}
                  >
                    AaBbCcDdEeFfGg 0123456789 ♭♯♮
                  </p>
                </div>
                <ul className="mt-2 divide-y divide-border">
                  {styles
                    .filter((s) => s.family === family)
                    .map((style) => (
                      <TypeRow key={style.key} style={style} />
                    ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}

// What a type style is for, where the file list alone doesn't say. Keyed
// like TypeStyle.key (family|size|weight|italic|uppercase), so a note
// disappears with its style.
const TYPE_NOTES: Record<string, string> = {
  'display|text-sm|400|false|false':
    'Smaller labelled buttons (modal footer buttons are the larger 16px default): detail-page toolbars (Edit Piece/Book/Person, Download PDF and Download Set PDF, Play and Play Set, Split People, Edit Program), the Setlists Library’s New Setlist, and Edit Piece’s Calculate.',
  'display|text-sm|400|true|false': 'The citation line on Piece Details (click to copy).',
}

function TypeRow({ style }: { style: TypeStyle }) {
  const note = TYPE_NOTES[style.key]
  const weightName =
    { 400: 'regular', 500: 'medium', 600: 'semibold', 700: 'bold' }[style.weight] ??
    String(style.weight)
  return (
    <li className="grid gap-x-6 gap-y-1 py-3 md:grid-cols-[1fr_18rem]">
      <p
        className={`min-w-0 text-ink ${style.sizeToken} ${style.uppercase ? 'tracking-wide' : ''}`}
        style={{
          fontFamily: `var(--font-${style.family})`,
          fontWeight: style.weight,
          fontStyle: style.italic ? 'italic' : 'normal',
          textTransform: style.uppercase ? 'uppercase' : 'none',
          letterSpacing: style.family === 'display' ? 'normal' : undefined,
        }}
      >
        {SAMPLE_TEXT[style.family] ?? SAMPLE_TEXT.sans}
      </p>
      <div>
        <p className="font-mono text-xs text-ink">
          {style.sizeToken} • {style.px}px{style.lineHeightPx ? `/${style.lineHeightPx}px` : ''} •{' '}
          {weightName}
          {style.italic && ' • italic'}
          {style.uppercase && ' • uppercase'}
        </p>
        {note && <p className="mt-0.5 text-xs font-medium text-ink">{note}</p>}
        <UsageLine usage={style.usage} showKinds={false} />
      </div>
    </li>
  )
}

// ---- Buttons and fields ----

const KIND_ORDER: ControlKind[] = [
  'Primary',
  'Secondary',
  'Destructive',
  'Quiet',
  'Text field',
  'Text area',
  'Select',
]

const DEMO_OPTIONS: Tag[] = [
  { id: 1, name: 'Piano' },
  { id: 2, name: 'Voice' },
  { id: 3, name: 'Organ' },
  { id: 4, name: 'Violin' },
]

function ControlSection({ files }: { files: SourceFile[] | null }) {
  const [disabled, setDisabled] = useState(false)
  const [showOneOffs, setShowOneOffs] = useState(false)
  const styles = files ? controlStyles(files) : null

  return (
    <Section
      id="controls"
      title="Buttons & fields"
      intro="Every distinct button and field class set in the app, grouped by role and most-used first (placement classes like margins and widths left out). Below them, the shared field components themselves, rendered live."
    >
      <div className="flex flex-wrap gap-6">
        <Toggle checked={disabled} onChange={setDisabled} label="Show disabled" />
        <Toggle checked={showOneOffs} onChange={setShowOneOffs} label="Include one-off styles" />
      </div>

      {!styles ? (
        <div className="mt-4">
          <Loading />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-8">
          {KIND_ORDER.map((kind) => {
            const ofKind = styles.filter(
              (s) => s.kind === kind && (showOneOffs || s.usage.count > 1),
            )
            if (ofKind.length === 0) return null
            return (
              <div key={kind}>
                <h3 className="text-xs font-semibold tracking-wide text-ink-soft uppercase">
                  {kind}
                </h3>
                <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-paper">
                  {ofKind.map((style) => (
                    <li
                      key={style.signature}
                      className="grid items-center gap-x-6 gap-y-2 p-4 md:grid-cols-[16rem_1fr]"
                    >
                      <div>
                        {style.kind === 'Text area' ? (
                          <textarea
                            className={`w-full ${style.renderClass}`}
                            rows={2}
                            placeholder="Text area"
                            disabled={disabled}
                          />
                        ) : style.kind === 'Text field' || style.kind === 'Select' ? (
                          <input
                            className={`w-full ${style.renderClass}`}
                            placeholder="Text field"
                            disabled={disabled}
                          />
                        ) : (
                          // White text with no fill of its own sits on a dark surface
                          // (the lightbox), so it gets one here too.
                          <span
                            className={
                              /(^| )text-white( |$)/.test(style.signature) &&
                              !style.signature.includes('bg-')
                                ? 'inline-block rounded-md bg-ink p-2'
                                : ''
                            }
                          >
                            <button type="button" className={style.renderClass} disabled={disabled}>
                              {kind}
                            </button>
                          </span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-mono text-xs break-words text-ink">{style.signature}</p>
                        <p className="text-xs text-ink-soft">×{style.usage.count}</p>
                        <UsageLine usage={style.usage} showKinds={false} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}

      <LiveComponents disabled={disabled} />
    </Section>
  )
}

function LiveComponents({ disabled }: { disabled: boolean }) {
  const [toggle, setToggle] = useState(true)
  const [select, setSelect] = useState('learning')
  const [instruments, setInstruments] = useState<Tag[]>([DEMO_OPTIONS[0]])
  const [tags, setTags] = useState<Tag[]>([{ id: 10, name: 'Christmas' }])

  return (
    <div className="mt-10">
      <h3 className="text-xs font-semibold tracking-wide text-ink-soft uppercase">
        Shared components (live)
      </h3>
      <div className="mt-2 grid gap-6 rounded-lg border border-border bg-paper-raised p-4 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <p className="font-mono text-xs text-ink-soft">Toggle</p>
          <Toggle
            checked={toggle}
            onChange={setToggle}
            label="This work was renewed"
            disabled={disabled}
          />
          <Toggle checked={false} onChange={() => {}} label="Off" disabled={disabled} />
        </div>
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-1 font-mono text-xs text-ink-soft">
            InfoIconTooltip{' '}
            <InfoIconTooltip
              message="The hint next to a field label."
              ariaLabel="About this field"
            />
          </p>
        </div>
        <div>
          <p className="mb-1 font-mono text-xs text-ink-soft">SingleSelect</p>
          <SingleSelect
            label="Practice Status"
            value={select}
            onChange={setSelect}
            options={[
              { value: 'want', label: 'Want to Learn' },
              { value: 'learning', label: 'Learning' },
              { value: 'learned', label: 'Learned' },
            ]}
          />
        </div>
        <div>
          <p className="mb-1 font-mono text-xs text-ink-soft">
            TagComboBox • pillStyle="paper" (shared catalog)
          </p>
          <TagComboBox
            label="Instruments"
            options={DEMO_OPTIONS}
            selected={instruments}
            multiple
            onChange={setInstruments}
            pillStyle="paper"
          />
        </div>
        <div>
          <p className="mb-1 font-mono text-xs text-ink-soft">
            TagComboBox • pillStyle="accent" (per-user data)
          </p>
          <TagComboBox
            label="Your Tags"
            options={[{ id: 10, name: 'Christmas' }]}
            selected={tags}
            multiple
            onChange={setTags}
          />
        </div>
        <div>
          <p className="mb-1 font-mono text-xs text-ink-soft">TagPills</p>
          <TagPills
            practiceStatus="Learning"
            userTags={[{ id: 10, name: 'Christmas' }]}
            keys={[
              { id: 1, name: 'E♭ Major' },
              { id: 2, name: 'C Minor' },
            ]}
            sheetType={{ id: 1, name: 'Score' }}
            instruments={[{ id: 1, name: 'Piano' }]}
          />
        </div>
      </div>
    </div>
  )
}
