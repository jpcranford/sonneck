import {
  GARAMOND_FLEURON_ASPECT,
  GARAMOND_FLEURON_PATH,
  GARAMOND_FLEURON_VIEWBOX,
} from '../lib/garamondFleuron'

// "Copy program as image" (design F of
// https://claude.ai/artifact/8Z7qPoVzws8L5SZih6WkAW): the Set PDF's
// contents page without page numbers, inside its cover's thin double frame,
// on white in its print colors. The real image is drawn by the server at
// 1080px wide; this is the Setlist Details mockup's stand-in, at half that.

/** One program line: a numbered entry (a piece, or a custom entry counted
 * as music) or another custom entry, unnumbered and italic. */
export type ProgramImageRow =
  | { kind: 'music'; number: number; role?: string; title: string; opus?: string; credit?: string }
  | { kind: 'other'; title: string }

// The Set PDF's print colors (internal/setlistpdf): never theme tokens.
const INK = '#1c1815'
const FAINT = '#5c5349'
const FAINTER = '#b3a99e'

const smallCaps = 'font-sans text-[10px] font-medium tracking-[0.1em] uppercase'

export function ProgramImagePreview({
  name,
  date,
  rows,
}: {
  name: string
  date: string
  rows: ProgramImageRow[]
}) {
  return (
    <div className="w-[540px] max-w-full bg-white p-[18px]" style={{ color: INK }}>
      <div className="border p-1.5" style={{ borderColor: FAINTER }}>
        <div className="border px-7 pt-[30px] pb-[26px]" style={{ borderColor: FAINTER }}>
          <svg
            viewBox={GARAMOND_FLEURON_VIEWBOX}
            height={22}
            width={22 * GARAMOND_FLEURON_ASPECT}
            className="mx-auto block"
            fill={FAINTER}
            aria-hidden="true"
          >
            <path d={GARAMOND_FLEURON_PATH} fillRule="evenodd" />
          </svg>
          <p className="mt-3.5 mb-1.5 text-center font-display text-2xl leading-tight font-bold">
            {name}
          </p>
          {date && (
            <p className={`text-center ${smallCaps}`} style={{ color: FAINT }}>
              {date}
            </p>
          )}
          <div className="mt-[26px] flex flex-col gap-[11px]">
            {rows.map((row, i) =>
              row.kind === 'other' ? (
                <p
                  key={i}
                  className="pl-[26px] font-display text-[13px] leading-snug italic"
                  style={{ color: FAINT }}
                >
                  {row.title}
                </p>
              ) : (
                <div
                  key={i}
                  className="grid grid-cols-[22px_1fr] gap-x-1 font-display text-[13px] leading-snug"
                >
                  {row.role && (
                    <>
                      <span />
                      <span className={smallCaps} style={{ color: FAINT }}>
                        {row.role}
                      </span>
                    </>
                  )}
                  <span className="font-medium">{row.number}.</span>
                  <span className="flex items-baseline gap-1.5">
                    <span className="font-medium">
                      {row.title}
                      {row.opus && <span className="font-normal"> ({row.opus})</span>}
                    </span>
                    {row.credit && (
                      <>
                        <span
                          className="min-w-5 flex-1 -translate-y-[3px] border-b-[1.5px] border-dotted"
                          style={{ borderColor: FAINTER }}
                        />
                        <span
                          className="font-sans text-[11.5px] whitespace-nowrap"
                          style={{ color: FAINT }}
                        >
                          {row.credit}
                        </span>
                      </>
                    )}
                  </span>
                </div>
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
