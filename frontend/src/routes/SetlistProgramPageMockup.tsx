import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconArrowLeft } from '@tabler/icons-react'
import { SonneckMark } from '../components/SonneckMark'
import { GARAMOND_FLEURON_ASPECT, GARAMOND_FLEURON_PATH, GARAMOND_FLEURON_VIEWBOX } from '../lib/garamondFleuron'
import { formatDateOnly } from '../lib/dateOnly'
import { CONTENT_MAX_W } from '../lib/layout'
import { useMockupTitle } from '../lib/useMockupTitle'

// Reference sample for every generated page in the Setlists "Download Set
// PDF" export (design doc §13) — the four locked directions, chosen from a
// wider comparison pass, in the order they'd actually appear in the
// merged packet: Cover, Table of Contents, Generated Program Page (the
// stand-in page a custom, non-piece entry contributes, since it has no
// sheet music of its own), and Colophon.
//
// Only the cover and colophon carry any reference to the app itself — by
// design, nothing else in the packet does. Page shape (Letter vs. A4) is
// inferred at export time from the library's own configured copyright
// region (en-US/ca -> Letter, eu-generic/en-GB -> A4) and applies to every
// page in the packet at once, so one toggle here drives all four previews.
// The Program Page's own preview-entry toggle intentionally spans every
// combination of role/duration/description being present or absent —
// neither control exists on a real generated page, which always shows
// exactly one entry at one fixed shape.

const SETLIST = { name: 'Sunday Morning Service', gigDate: '2026-10-04' }
const LONG_DATE: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' }
const COVER_DESCRIPTION =
  'Traditional hymns and choral music for the first Sunday of October — all are welcome to join in the congregational singing.'
const COLOPHON_TYPEFACES = 'Set in Libre Baskerville and Cabin.'

// Table of contents fixtures — the two programs the locked design was
// settled against: a short one-page service, and a long Lessons and Carols
// that runs onto a continuation page. `keys` are real stored key names
// ("E♭ Major"); page numbers are computed, as in the real packet (cover,
// then the TOC's own pages, then each entry in order).
interface TocEntry {
  title: string
  piece: boolean
  keys?: string[]
  role?: string
  seconds?: number
  pages: number
  countsAsMusic?: boolean
}

interface TocProgram {
  key: 'short' | 'long'
  label: string
  name: string
  gigDate: string
  entries: TocEntry[]
}

const P = (title: string, keys: string[], seconds: number, pages: number, role?: string): TocEntry => ({
  title, piece: true, keys, seconds, pages, role,
})
const C = (title: string, role?: string, seconds?: number, countsAsMusic = false): TocEntry => ({
  title, piece: false, role, seconds, pages: 1, countsAsMusic,
})

const TOC_PROGRAMS: TocProgram[] = [
  {
    key: 'short',
    label: 'Sunday service (one page)',
    name: 'Sunday Morning Service',
    gigDate: '2026-10-04',
    entries: [
      C('Prelude', undefined, 180),
      P('Holy, Holy, Holy', ['D Major', 'E♭ Major'], 165, 2),
      C('Welcome & Announcements'),
      P('How Great Thou Art', ['B♭ Major', 'C Major'], 220, 3, 'Anthem'),
      C('Congregational Response', 'Offertory', 90, true),
      P('Amazing Grace', ['G Major'], 195, 2),
      C('Benediction', 'Closing'),
    ],
  },
  {
    key: 'long',
    label: 'Lessons and Carols (two pages)',
    name: 'A Festival of Nine Lessons and Carols',
    gigDate: '2026-12-13',
    entries: [
      C('Organ Voluntary', 'Prelude', 300),
      P('Once in Royal David’s City', ['F Major'], 270, 2, 'Processional'),
      C('Bidding Prayer'),
      C('First Lesson', 'Genesis 3', 120),
      P('Adam Lay Ybounden', ['C♯ Minor'], 100, 1),
      C('Second Lesson', 'Genesis 22', 150),
      P('The Truth from Above', ['D Minor'], 190, 2),
      C('Third Lesson', 'Isaiah 9', 120),
      P('In the Bleak Midwinter (Cranham), with Descant for Upper Voices', ['F Major', 'G Major'], 285, 3),
      P('Es ist ein Ros entsprungen', ['F Major'], 170, 1),
      C('Fourth Lesson', 'Isaiah 11', 135),
      P('Lo, How a Rose E’er Blooming', ['F Major'], 180, 2),
      P('Gabriel’s Message', ['G Minor'], 160, 1),
      C('Fifth Lesson', 'Luke 1', 150),
      P('Ave Maria', ['F Major'], 270, 3),
      P('Magnificat', ['E Major', 'A Minor', 'C Major'], 320, 4, 'Anthem'),
      C('Sixth Lesson', 'Luke 2', 120),
      P('Infant Holy, Infant Lowly', ['F Major'], 130, 1),
      P('A Spotless Rose', ['E♭ Major'], 175, 2),
      C('Seventh Lesson', 'Luke 2', 120),
      P('Shepherd’s Pipe Carol', ['E♭ Major'], 200, 4),
      P('While Shepherds Watched Their Flocks', ['D Major'], 180, 1),
      C('Eighth Lesson', 'Matthew 2', 150),
      P('Coventry Carol', ['G Minor'], 165, 1),
      P('The Three Kings', ['C Major'], 210, 2),
      C('Ninth Lesson', 'John 1', 180),
      P('Hark! The Herald Angels Sing', ['F Major', 'G Major'], 220, 2, 'Recessional'),
      P('O Come, All Ye Faithful (Adeste Fideles), with Last-Verse Reharmonization', ['G Major', 'A Major'], 255, 3),
      C('Collect and Blessing', 'Closing'),
      C('Organ Voluntary', 'Postlude', 240),
      C('Reception'),
    ],
  },
]

// The TOC's short key form: the stored name read case- and space-
// insensitively — a major key is just its note, a minor key gets "m"
// ("E Major" › "A Minor" › "C Major" reads "E › Am › C"). A name that isn't
// "<note> major/minor" shows as stored.
function shortKey(name: string): string {
  const match = name.toLowerCase().replace(/\s+/g, '').match(/^(.+?)(major|minor)$/)
  if (!match) return name
  return match[1].charAt(0).toUpperCase() + match[1].slice(1) + (match[2] === 'minor' ? 'm' : '')
}

// A row's own duration: m:ss, or h:mm:ss from an hour up.
function formatRowDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = String(seconds % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

// A key sequence, joined the way the app joins one everywhere else
// (Piece Details, library card pills, Setlist Details): a regular-weight ›,
// lighter than the keys, with a little space each side — for print the
// app's 55% opacity becomes the solid fainter ink.
function KeyChevrons({ keys }: { keys: string[] }) {
  return keys.map((key, i) => (
    <span key={i}>
      {i > 0 && (
        <span aria-hidden="true" style={{ margin: '0 0.3em', fontWeight: 400, color: PRINT_FAINTER }}>
          ›
        </span>
      )}
      {key}
    </span>
  ))
}

// A row's parenthetical: role • keys • duration, whichever are present.
function tocParenthetical(row: TocRow) {
  const parts = [
    row.role,
    row.keys.length > 0 ? <KeyChevrons keys={row.keys} /> : undefined,
    row.duration,
  ].filter((part) => part !== undefined)
  return parts.map((part, i) => (
    <span key={i}>
      {i > 0 && ' • '}
      {part}
    </span>
  ))
}

// The header's total, to the nearest minute: "approximately 1 hour 28 minutes".
function formatApproximateTotal(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  return `approximately ${[h ? unit(h, 'hour') : '', m ? unit(m, 'minute') : ''].filter(Boolean).join(' ')}`
}

interface TocRow {
  num: string
  title: string
  piece: boolean
  // The parenthetical's parts, in order: role, the key sequence (short
  // keys, drawn with chevrons between them), duration — any may be absent.
  role?: string
  keys: string[]
  duration?: string
  page: number
}

// One row per entry: the display number (an en dash for an entry that
// doesn't count as music), the parenthetical — role • keys • duration for a
// piece, role • duration for a custom entry, any part absent — and the page
// the entry starts on.
function tocRows(program: TocProgram, tocPages: number): TocRow[] {
  let page = 1 + tocPages
  let num = 0
  return program.entries.map((e) => {
    page += 1
    const start = page
    page += e.pages - 1
    const counts = e.piece || Boolean(e.countsAsMusic)
    if (counts) num += 1
    return {
      num: counts ? String(num) : '–',
      title: e.title,
      piece: e.piece,
      role: e.role,
      keys: (e.keys ?? []).map(shortKey),
      duration: e.seconds ? formatRowDuration(e.seconds) : undefined,
      page: start,
    }
  })
}

interface PreviewEntry {
  key: string
  label: string
  name: string
  role: string | null
  duration: string | null
  description: string | null
}

const ENTRIES: PreviewEntry[] = [
  { key: 'prelude', label: 'Prelude', name: 'Prelude', role: null, duration: '3:00', description: null },
  {
    key: 'announcements',
    label: 'Announcements',
    name: 'Welcome & Announcements',
    role: null,
    duration: null,
    description:
      'Please silence phones and camera flashes during the service. Fellowship hour follows immediately in the parish hall — all are welcome.',
  },
  {
    key: 'response',
    label: 'Congregational Response',
    name: 'Congregational Response',
    role: 'Offertory',
    duration: '1:30',
    description: null,
  },
  { key: 'benediction', label: 'Benediction', name: 'Benediction', role: 'Closing', duration: null, description: null },
  {
    key: 'full',
    label: 'All Fields',
    name: 'Special Music',
    role: 'Offertory',
    duration: '4:00',
    description: 'A guest vocal duet, accompanied by piano, processing down the side aisle during the collection.',
  },
]

// widthPt/heightPt: the page's real size in PDF points (matching
// internal/setlistpdf's pageSize), for the point-exact sizing below.
const SHAPES = [
  { key: 'letter', label: 'Letter', ratio: '8.5 / 11', widthPt: 612, heightPt: 792 },
  { key: 'a4', label: 'A4', ratio: '210 / 297', widthPt: 595.28, heightPt: 841.89 },
] as const

// Every TOC page's margin, on all four sides.
const TOC_MARGIN = 72
// The space between the header row's rule and the first program row.
const TOC_ROWS_TOP_GAP = 10

// The cover's three solid print colors, on pure white — fixed hexes rather
// than theme tokens, since the printed page never follows the app's theme.
const PRINT_INK = '#1c1815'
const PRINT_FAINT = '#5c5349'
const PRINT_FAINTER = '#b3a99e'

// Cabin reads smaller than Libre Baskerville at the same size (x-height
// .490 vs .530), so its sizes are scaled up by this factor to match.
const CABIN_OPTICAL = 1.08

function PageShell({
  ratio,
  className = 'bg-paper-raised',
  children,
}: {
  ratio: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={`relative w-full max-w-[440px] shadow-lg ${className}`}
      style={{ aspectRatio: ratio, containerType: 'inline-size' }}
    >
      {children}
    </div>
  )
}

function Fleuron({ height, rotated = false, style }: { height: string; rotated?: boolean; style?: React.CSSProperties }) {
  return (
    <svg
      viewBox={GARAMOND_FLEURON_VIEWBOX}
      aria-hidden="true"
      focusable="false"
      style={{
        display: 'block',
        flexShrink: 0,
        height,
        width: `calc(${height} * ${GARAMOND_FLEURON_ASPECT})`,
        transform: rotated ? 'rotate(180deg)' : undefined,
        ...style,
      }}
    >
      <path fill="currentColor" fillRule="evenodd" d={GARAMOND_FLEURON_PATH} />
    </svg>
  )
}

export function SetlistProgramPageMockup() {
  useMockupTitle('Download Set PDF')
  const [entryKey, setEntryKey] = useState(ENTRIES[2].key)
  const [shapeKey, setShapeKey] = useState<(typeof SHAPES)[number]['key']>('letter')
  const [tocKey, setTocKey] = useState<TocProgram['key']>('short')
  const entry = ENTRIES.find((e) => e.key === entryKey) ?? ENTRIES[0]
  const shape = SHAPES.find((s) => s.key === shapeKey) ?? SHAPES[0]
  const hasInfo = Boolean(entry.duration || entry.description)
  // A length in real PDF points, scaled to this preview's rendered width.
  const pt = (n: number) => `calc(${n} * 100cqw / ${shape.widthPt})`
  const toc = TOC_PROGRAMS.find((p) => p.key === tocKey) ?? TOC_PROGRAMS[0]
  // TOC pagination, the way the real PDF does it: lay every row out once
  // (the hidden measuring page below), measure the header and each row's
  // real height — wrapped titles included — and start a new page whenever
  // the next row would cross the bottom margin. Continuation pages begin at
  // the top margin with only the header row. `breaks` are the indices of
  // each continuation page's first row; the page count they imply feeds
  // every entry's page number.
  const tocMeasureRef = useRef<HTMLDivElement>(null)
  const [tocLayout, setTocLayout] = useState<{ key: string; breaks: number[] } | null>(null)
  const tocLayoutKey = `${toc.key}:${shape.key}`
  const tocBreaks = tocLayout?.key === tocLayoutKey ? tocLayout.breaks : []
  const tocPageCount = tocBreaks.length + 1
  const allTocRows = tocRows(toc, tocPageCount)
  const tocPageRows = [0, ...tocBreaks].map((start, i) => allTocRows.slice(start, tocBreaks[i] ?? allTocRows.length))
  const tocTotalSeconds = toc.entries.reduce((sum, e) => sum + (e.seconds ?? 0), 0)

  const renderTocPage = (rows: TocRow[], pageIndex: number) => (
    <PageShell key={pageIndex} ratio={shape.ratio} className="bg-white">
      <div
        className="absolute flex flex-col"
        style={{ left: pt(TOC_MARGIN), right: pt(TOC_MARGIN), top: pt(TOC_MARGIN) }}
      >
        {pageIndex === 0 && (
          <div className="flex flex-col" style={{ gap: pt(4), marginBottom: pt(24) }}>
            <span
              className="font-display"
              style={{ fontSize: pt(24), fontWeight: 700, lineHeight: 1.24, color: PRINT_INK }}
            >
              {toc.name}
            </span>
            <span
              className="font-sans"
              style={{
                fontSize: pt(12 * CABIN_OPTICAL),
                letterSpacing: '0.02em',
                lineHeight: 1.4,
                color: PRINT_FAINT,
              }}
            >
              {formatDateOnly(toc.gigDate, LONG_DATE)} &bull; {formatApproximateTotal(tocTotalSeconds)}
            </span>
          </div>
        )}
        <div
          data-toc-label
          className="font-sans flex items-baseline uppercase"
          style={{
            paddingBottom: pt(5),
            borderBottom: `${pt(1)} solid ${PRINT_FAINTER}`,
            fontSize: pt(9 * CABIN_OPTICAL),
            letterSpacing: '0.1em',
            lineHeight: 1.4,
            color: PRINT_FAINT,
          }}
        >
          <span className="grow">{pageIndex === 0 ? 'Program' : 'Program, continued'}</span>
          <span>Page</span>
        </div>
        <div className="flex flex-col" style={{ gap: pt(12), marginTop: pt(TOC_ROWS_TOP_GAP) }}>
          {rows.map((row) => (
            // The row itself is Baskerville 12pt, so each line box
            // is sized by the title's own font — a line that
            // started from a different font (the page's default
            // Cabin 16px) would grow taller than its line-height
            // once the Baskerville and 9pt Cabin runs sit on its
            // baseline. The PDF places baselines at an exact pitch,
            // so this keeps the mockup's rows the same height.
            <div
              key={row.page}
              data-toc-row
              className="font-display flex"
              style={{ alignItems: 'last baseline', fontSize: pt(12), lineHeight: pt(12 * 1.24) }}
            >
              {/* The number sits inside the title's first line, so
                  it shares that line's baseline; wrapped lines hang
                  under the title, past it. */}
              <span
                className="min-w-0"
                style={{ flex: '0 1 auto', paddingLeft: pt(34), textIndent: `calc(-1 * ${pt(34)})` }}
              >
                <span
                  className="font-display inline-block text-right tabular-nums"
                  style={{ width: pt(24), marginRight: pt(10), textIndent: 0, fontSize: pt(12), color: PRINT_FAINT }}
                >
                  {row.num}
                </span>
                {row.piece ? (
                  <span className="font-display" style={{ fontSize: pt(12), fontWeight: 500, color: PRINT_INK }}>
                    {row.title}
                  </span>
                ) : (
                  <span className="font-display italic" style={{ fontSize: pt(12), color: PRINT_FAINT }}>
                    {row.title}
                  </span>
                )}
                {(row.role || row.keys.length > 0 || row.duration) && (
                  <>
                    {' '}
                    <span
                      className="font-sans whitespace-nowrap"
                      style={{ fontSize: pt(9 * CABIN_OPTICAL), letterSpacing: '0.02em', lineHeight: 1, color: PRINT_FAINT }}
                    >
                      ({tocParenthetical(row)})
                    </span>
                  </>
                )}
              </span>
              <span
                aria-hidden="true"
                style={{
                  flex: `1 0 ${pt(24)}`,
                  height: pt(2),
                  margin: `0 ${pt(3)} 0 ${pt(6)}`,
                  backgroundImage: `radial-gradient(circle at ${pt(1)} ${pt(1)}, ${PRINT_FAINTER} ${pt(0.7)}, transparent ${pt(0.95)})`,
                  backgroundSize: `${pt(4)} ${pt(2)}`,
                  backgroundRepeat: 'repeat-x',
                  backgroundPosition: 'right bottom',
                }}
              />
              <span
                className="font-display flex-none text-right tabular-nums"
                style={{ minWidth: pt(16), fontSize: pt(12), color: PRINT_INK }}
              >
                {row.page}
              </span>
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  )

  useEffect(() => {
    const el = tocMeasureRef.current
    if (!el) return
    let cancelled = false
    const measure = () => {
      if (cancelled) return
      const shell = el.firstElementChild?.getBoundingClientRect()
      const label = el.querySelector('[data-toc-label]')
      if (!shell || !label || shell.width === 0) return
      const toPt = shape.widthPt / shell.width
      const bottomLimit = shape.heightPt - TOC_MARGIN
      // Where a continuation page's first row starts: the top margin, the
      // header row, and its gap.
      const continuationTop = TOC_MARGIN + label.getBoundingClientRect().height * toPt + TOC_ROWS_TOP_GAP
      const breaks: number[] = []
      let shift = 0 // added to a measured position to place it on its own page
      el.querySelectorAll('[data-toc-row]').forEach((row, i) => {
        const r = row.getBoundingClientRect()
        const top = (r.top - shell.top) * toPt
        const bottom = (r.bottom - shell.top) * toPt
        if (bottom + shift > bottomLimit && i > (breaks[breaks.length - 1] ?? 0)) {
          breaks.push(i)
          shift = continuationTop - top
        }
      })
      setTocLayout((prev) =>
        prev?.key === tocLayoutKey && prev.breaks.join() === breaks.join() ? prev : { key: tocLayoutKey, breaks },
      )
    }
    void document.fonts.ready.then(measure)
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [tocLayoutKey, tocPageCount, shape.widthPt, shape.heightPt])

  return (
    <div className={`${CONTENT_MAX_W} flex flex-1 flex-col gap-6 px-6 py-6 md:px-8 md:py-8`}>
      <Link to="/mockup" className="inline-flex w-fit items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
        <IconArrowLeft size={20} />
        Setlists
      </Link>

      <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
        Reference sample — <span className="font-medium text-ink">Download Set PDF</span> (design doc §13). The four
        locked page directions, in packet order: Cover, Table of Contents, a Generated Program Page (for a custom,
        non-piece entry), and Colophon — each chosen from its own wider comparison pass. Only the cover and colophon
        carry any reference to the app itself.
        <div className="mt-2">
          The Cover is the locked redesign, drawn at true point sizes: two frames, Bringhurst's classical type
          scale, three solid print colors on white, and the Garamond fleuron (redrawn from a 1927 printing of
          Caslon's English Flowers no. 1) upright above and rotated below. The fleuron also marks the Generated
          Program Page. internal/setlistpdf draws the Cover from these same point values.
        </div>
        <div className="mt-2">
          The Table of Contents is the locked redesign too, also in true points, shown for a one-page program and one
          that runs onto a continuation page. The real PDF measures how many rows fit (a long setlist name or wrapped
          titles leave room for fewer); internal/setlistpdf still draws the previous TOC until it's ported.
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs font-medium text-ink-soft">Page shape:</span>
          {SHAPES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setShapeKey(s.key)}
              className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs ${
                shapeKey === s.key
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border text-ink-soft hover:text-ink'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-16 py-4">
        {/* Cover */}
        <section className="flex flex-col items-center gap-3">
          <h2 className="font-display text-xl text-ink">Cover Page</h2>
          <PageShell ratio={shape.ratio} className="bg-white">
            <div className="absolute" style={{ inset: pt(36), border: `${pt(1)} solid ${PRINT_FAINTER}` }} />
            <div
              className="absolute flex flex-col items-center justify-center text-center"
              style={{
                inset: pt(44),
                border: `${pt(1)} solid ${PRINT_FAINTER}`,
                gap: pt(10),
                padding: `0 ${pt(32)}`,
              }}
            >
              <Fleuron height={pt(21)} style={{ color: PRINT_FAINTER, marginBottom: pt(8) }} />
              <span
                className="font-sans uppercase"
                style={{
                  fontSize: pt(11 * CABIN_OPTICAL),
                  fontWeight: 400,
                  letterSpacing: '0.1em',
                  color: PRINT_FAINT,
                }}
              >
                {formatDateOnly(SETLIST.gigDate, LONG_DATE)}
              </span>
              <span
                className="font-display"
                style={{ fontSize: pt(24), fontWeight: 700, color: PRINT_INK, width: pt(233) }}
              >
                {SETLIST.name}
              </span>
              <span
                aria-hidden="true"
                style={{ height: pt(1), width: pt(24), background: PRINT_FAINTER, margin: `${pt(2)} 0` }}
              />
              <p
                className="font-sans italic"
                style={{
                  fontSize: pt(12 * CABIN_OPTICAL),
                  letterSpacing: '0.02em',
                  lineHeight: 1.4,
                  color: PRINT_FAINT,
                  width: pt(233),
                  margin: 0,
                }}
              >
                {COVER_DESCRIPTION}
              </p>
              <Fleuron height={pt(21)} rotated style={{ color: PRINT_FAINTER, marginTop: pt(8) }} />
            </div>
          </PageShell>
        </section>

        {/* Table of contents — the locked design, in true points: 72pt
            margins on every side; the setlist name at 2x the 12pt body;
            one small-caps header row repeated on each continuation page;
            Libre Baskerville rows with wrapped titles hanging under the
            title column; the Cabin parenthetical at 9pt; dot leaders on
            the baseline, stopping 3pt short of the page number. */}
        <section className="relative flex flex-col items-center gap-3">
          <h2 className="font-display text-xl text-ink">Table of Contents</h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-ink-soft">Program:</span>
            {TOC_PROGRAMS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setTocKey(p.key)}
                className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs ${
                  tocKey === p.key
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border text-ink-soft hover:text-ink'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex w-full flex-wrap justify-center gap-6">
            {tocPageRows.map((rows, pageIndex) => renderTocPage(rows, pageIndex))}
          </div>
          {/* The measuring page: the same markup with every row on it, laid
              out at the visible pages' width, never shown. */}
          <div
            ref={tocMeasureRef}
            aria-hidden="true"
            className="pointer-events-none invisible absolute inset-x-0 top-0 flex justify-center"
          >
            {renderTocPage(allTocRows, 0)}
          </div>
        </section>

        {/* Generated program page */}
        <section className="flex flex-col items-center gap-3">
          <h2 className="font-display text-xl text-ink">Generated Program Page</h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-ink-soft">Preview entry:</span>
            {ENTRIES.map((e) => (
              <button
                key={e.key}
                type="button"
                onClick={() => setEntryKey(e.key)}
                className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs ${
                  entryKey === e.key
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border text-ink-soft hover:text-ink'
                }`}
              >
                {e.label}
              </button>
            ))}
          </div>
          <PageShell ratio={shape.ratio}>
            <div className="absolute inset-6 flex flex-col items-center justify-center gap-3 border border-border px-8 text-center">
              <span className="text-accent">
                <Fleuron height="1.25rem" />
              </span>
              {entry.role && (
                <span className="text-xs font-semibold tracking-wide text-ink-soft uppercase">{entry.role}</span>
              )}
              <span className="font-display text-2xl text-ink italic">{entry.name}</span>
              {hasInfo && (
                <div className="flex items-center gap-2" aria-hidden="true">
                  <span className="h-px w-7 bg-border" />
                  <span className="h-1.5 w-1.5 rotate-45 bg-accent" />
                  <span className="h-px w-7 bg-border" />
                </div>
              )}
              {entry.description && <p className="max-w-[85%] text-sm text-ink-soft">{entry.description}</p>}
              {entry.duration && <span className="text-sm text-ink-soft">{entry.duration}</span>}
            </div>
          </PageShell>
          <p className="text-xs text-ink-soft">
            Becomes one page of the concatenated Set PDF, positioned wherever this entry falls in the program order.
          </p>
        </section>

        {/* Colophon */}
        <section className="flex flex-col items-center gap-3">
          <h2 className="font-display text-xl text-ink">Colophon Page</h2>
          <PageShell ratio={shape.ratio}>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3.5 px-10 text-center">
              <div className="text-xs leading-relaxed text-ink-soft">
                {COLOPHON_TYPEFACES}
                <br />
                Generated {formatDateOnly(SETLIST.gigDate, LONG_DATE)}.
              </div>
              <span className="h-px w-6 bg-border" aria-hidden="true" />
              <SonneckMark className="h-4 w-auto text-ink-soft" />
            </div>
          </PageShell>
        </section>
      </div>
    </div>
  )
}
