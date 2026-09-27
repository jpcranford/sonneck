import { useState } from 'react'
import { Link } from 'react-router-dom'
import { IconArrowLeft } from '@tabler/icons-react'
import { SonneckMark } from '../components/SonneckMark'
import { GARAMOND_FLEURON_ASPECT, GARAMOND_FLEURON_PATH, GARAMOND_FLEURON_VIEWBOX } from '../lib/garamondFleuron'
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

const SETLIST = { name: 'Sunday Morning Service', gigDate: 'October 4, 2026' }
const COVER_DESCRIPTION =
  'Traditional hymns and choral music for the first Sunday of October — all are welcome to join in the congregational singing.'
const COLOPHON_TYPEFACES = 'Set in Libre Baskerville and Cabin.'

interface ProgramEntry {
  name: string
  kind: 'piece' | 'custom'
  num: number | null
  paren: string | null
  page: number
}

// Matches the fixture used throughout this feature's design pass — total
// pages (11) includes the four generated pages alongside the three
// pieces' own 7 pages of real sheet music.
const PROGRAM: ProgramEntry[] = [
  { name: 'Prelude', kind: 'custom', num: null, paren: '3:00', page: 1 },
  { name: 'Holy, Holy, Holy', kind: 'piece', num: 1, paren: 'Eb • 2:45', page: 2 },
  { name: 'Welcome & Announcements', kind: 'custom', num: null, paren: null, page: 4 },
  { name: 'How Great Thou Art', kind: 'piece', num: 2, paren: 'F • 3:40', page: 5 },
  { name: 'Congregational Response', kind: 'custom', num: 3, paren: 'Offertory • 1:30', page: 8 },
  { name: 'Amazing Grace', kind: 'piece', num: 4, paren: 'G • 3:15', page: 9 },
  { name: 'Benediction', kind: 'custom', num: null, paren: 'Closing', page: 11 },
]

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

// widthPt: the page's real width in PDF points, for the cover's
// point-exact sizing below.
const SHAPES = [
  { key: 'letter', label: 'Letter', ratio: '8.5 / 11', widthPt: 612 },
  { key: 'a4', label: 'A4', ratio: '210 / 297', widthPt: 595 },
] as const

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
  const entry = ENTRIES.find((e) => e.key === entryKey) ?? ENTRIES[0]
  const shape = SHAPES.find((s) => s.key === shapeKey) ?? SHAPES[0]
  const hasInfo = Boolean(entry.duration || entry.description)
  // A length in real PDF points, scaled to this preview's rendered width.
  const pt = (n: number) => `calc(${n} * 100cqw / ${shape.widthPt})`

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
                {SETLIST.gigDate}
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

        {/* Table of contents */}
        <section className="flex flex-col items-center gap-3">
          <h2 className="font-display text-xl text-ink">Table of Contents</h2>
          <PageShell ratio={shape.ratio}>
            <div className="flex h-full flex-col px-7 pt-6 pb-5">
              <div className="font-display text-base font-bold text-ink">{SETLIST.name}</div>
              <div className="mt-0.5 text-sm text-ink-soft">{SETLIST.gigDate} &bull; approx. 14:10</div>
              <div className="mt-2.5 text-xs font-semibold tracking-wide text-ink-soft uppercase">Program</div>
              <div className="mt-2 flex border-b border-border pb-1 text-[11px] font-semibold tracking-wide text-ink-soft uppercase">
                <span className="mr-1.5 w-5 flex-none" />
                <span className="flex-1">Title</span>
                <span>Pg.</span>
              </div>
              {PROGRAM.map((e) => (
                <div key={e.name} className="flex items-baseline py-1">
                  <span className="mr-1.5 w-5 flex-none text-right text-xs text-ink-soft">{e.num ?? '–'}</span>
                  <span className="flex-shrink truncate">
                    {e.kind === 'piece' ? (
                      <span className="font-display text-sm text-ink">{e.name}</span>
                    ) : (
                      <span className="text-xs text-ink-soft italic">{e.name}</span>
                    )}
                    {e.paren && <span className="text-[11px] text-ink-soft"> ({e.paren})</span>}
                  </span>
                  <span className="mx-1.5 mb-0.5 h-px min-w-2.5 flex-1 border-b border-dotted border-ink/30" />
                  <span className="flex-none text-xs text-ink tabular-nums">{e.page}</span>
                </div>
              ))}
            </div>
          </PageShell>
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
                Generated {SETLIST.gigDate}.
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
