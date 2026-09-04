import citationFlowchart from '../assets/diagrams/citation-logic-flowchart.svg'
import { useMockupTitle } from '../lib/useMockupTitle'

// DESIGN MOCKUP — not a design mockup for an unbuilt UI (there's no citation
// *screen*), but a documentation "mockup" of internal/handlers/citation.go's
// own branching logic — a standing decision-flow reference in the same
// spirit as this app's other mockups, under the same mockup-parity rule
// (CLAUDE.md > Frontend / feedback_mockup_first_standing_rule.md): whenever
// citation.go's actual branching changes, this page gets ported in the same
// pass, not left to drift. Full standing rule (including how to regenerate
// the flowchart image below): memory frontend_citation_logic_mockup.md.
//
// The flowchart itself is a real Mermaid diagram (direct request,
// 2026-09-03 — a hand-rolled CSS box/arrow version read as genuinely
// ambiguous about where Yes/No splits happened once a wide sibling branch
// pushed the next one onto its own row below it), source + regeneration
// command in ../assets/diagrams/citation-logic-flowchart.mmd. Its Path A
// leaf nodes (A1-A3) are intentionally short labels, not the full citation
// text — the LEAVES constant below carries the actual worked example for
// each, cross-referenced by that same id, so the diagram stays legible
// while the real strings still live right underneath it. Every example is
// copied verbatim from a passing internal/handlers/citation_test.go case
// (see each leaf's own `source`) specifically so this page can't silently
// diverge from what the real code actually produces — if a test's expected
// string ever changes, the matching leaf here needs the same edit.
//
// Path B's own two decisions (opus match, IMSLP source) ARE drawn as real
// diamonds in the diagram — its six leaf boxes stay terse ("B1", not the
// full pattern text) and cross-reference the Path B table below by that
// same id for the actual worked example, rather than the diagram carrying
// both the decision structure and the full leaf detail redundantly.

type Leaf = {
  id: string
  pattern: string
  example: string
  source: string
}

const FLAT_LEAVES: Leaf[] = [
  {
    id: 'A1',
    pattern: 'Copyleft / In Copyright, no book — + "Copyright © {year} {holder}." clause',
    example: `Joe Hisaishi, arr. M. Yamamoto, "Merry-Go-Round of Life from 'Howl's Moving Castle'", Sony/ATV Music Publishing (UK), 2004. Copyright © Sony/ATV Music Publishing (UK).`,
    source: 'TestCitation_TitleDoubleQuotesBecomeSingleQuotes',
  },
  {
    id: 'A2',
    pattern: 'Public Domain, contradicts the live calc — + bare literal "Public domain." note',
    example: `Alexandre Boëly, 24 Pièces pour l'orgue, Op. 12, No. 5 "Prélude", IMSLP #972987, 1842. Public domain.`,
    source: 'TestCitation_FlatCitationMovesBookOpusToBookNameForPublicDomainPiece',
  },
  {
    id: 'A3',
    pattern: 'Otherwise (Likely PD, or PD agreeing with the calc) — bare, nothing appended',
    example: `Someone, "Solo", 1700.`,
    source: 'TestCitation_LikelyPublicDomainGetsNoTrailingNote',
  },
]

// Examples deliberately end where buildTwoSentenceCitation's own
// unconditional output ends — the trailing "Copyright © {year} {holder}."
// clause each source test's real citation actually carries is stripped
// back out here, since the prose below the table already covers it as an
// "additional, whenever there's something to attribute" note, not part of
// the pattern any single row is meant to illustrate. `pattern` states each
// row's opus-match/IMSLP-source combination in prose — the flowchart's own
// D3/D4-D5 diamonds show the same two decisions structurally, terse leaf
// boxes there just say "B1" etc. and point here for the detail.
const TWO_SENTENCE_LEAVES: Leaf[] = [
  {
    id: 'B1',
    pattern: 'Opus matches, piece owns IMSLP — IMSLP # joins sentence 1, no publish sentence',
    example: `Charles Villiers Stanford, Six Short Preludes and Postludes, Op. 105, III. "Lento", IMSLP #07953, 1908.`,
    source: 'TestCitation_OpusMatchWithPieceOwnedImslp',
  },
  {
    id: 'B2',
    pattern:
      'Opus matches, book owns IMSLP — "Published by {publisher}, IMSLP #{n}, {yearPublished}."',
    example: `Jane Doe, Album for the Young, Op. 68, No. 3 "The Reaper's Song", 1878. Published by Henle Verlag, IMSLP #12345, 2015.`,
    source: 'TestCitation_OpusMatchWithBookOwnedImslp',
  },
  {
    id: 'B3',
    pattern: 'Opus matches, neither owns IMSLP — "Published by {publisher}, {yearPublished}."',
    example: `Jane Doe, Album for the Young, Op. 68, No. 3 "The Reaper's Song", 1878. Published by Henle Verlag, 2015.`,
    source: 'TestCitation_OpusMatchWithNoImslpUsesPublishedByWording',
  },
  {
    id: 'B4',
    pattern: 'No opus match, piece owns IMSLP — IMSLP # joins sentence 1, no publish sentence',
    example: `Charles-Marie Widor, "Toccata", IMSLP #04154.`,
    source: 'TestCitation_ISBNHiddenWhenImslpPresent',
  },
  {
    id: 'B5',
    pattern:
      'No opus match, book owns IMSLP — "Published in {bookTitle}, {publisher}, IMSLP #{n}, {yearPublished}."',
    example: `Jane Doe, "The Reaper's Song" (No. 3), 1878. Published in Album for the Young, Henle Verlag, IMSLP #12345, 2015.`,
    source: 'TestCitation_NoOpusMatchWithBookOwnedImslp',
  },
  {
    id: 'B6',
    pattern:
      'No opus match, neither owns IMSLP — "Published in {bookTitle}[, {bookOpus}], {publisher}[, ISBN], {yearPublished}."',
    example: `Johann Sebastian Bach, "Minuet" (BWV Anh. 114). Published in Notebook for Anna Magdalena Bach, BWV Anh. 113-132.`,
    source: 'TestCitation_ShowsBookOpusNumberWhenNotContainedInPieceOpusNumber',
  },
]

// A terminal outcome — id matches the flowchart's own node label, the
// general template pattern in prose, then a real citation string a passing
// test proves that pattern actually produces.
function LeafCard({ id, pattern, example, source }: Leaf) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-paper-raised p-3">
      <p className="text-xs text-ink-soft">
        <span className="font-mono font-semibold text-accent">{id}</span> — {pattern}
      </p>
      <p className="rounded-md bg-paper-sunken p-2 font-mono text-[0.8em] leading-snug text-ink">
        {example}
      </p>
      <p className="break-all text-[0.7rem] text-ink-soft/70">{source}</p>
    </div>
  )
}

// Path B (six leaves, one per opus-match/IMSLP-ownership combination) reads
// tidier as a table than as six cards repeating the same four fields — Path
// A stays LeafCard (only three leaves, one axis of variation) since a table
// wouldn't buy anything there. The opus-match/IMSLP-source combination each
// row sits at is stated in `pattern`'s own prose, not a separate column —
// the flowchart's own D3/D4-D5 diamonds already show those two decisions
// structurally, so a dedicated column here would just restate them a
// second time next to the same B1-B6 ids the diagram's own terse leaf
// boxes already point at.
function LeafTable({ leaves }: { leaves: Leaf[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-paper-sunken text-left text-xs text-ink-soft">
            <th className="px-3 py-2 font-medium">ID</th>
            <th className="px-3 py-2 font-medium">Pattern</th>
            <th className="px-3 py-2 font-medium">Example</th>
            <th className="px-3 py-2 font-medium">Source test</th>
          </tr>
        </thead>
        <tbody>
          {leaves.map((leaf) => (
            <tr key={leaf.id} className="border-b border-border align-top last:border-b-0">
              <td className="px-3 py-2 font-mono font-semibold text-accent">{leaf.id}</td>
              <td className="px-3 py-2 text-ink-soft">{leaf.pattern}</td>
              <td className="px-3 py-2 font-mono text-[0.8em] leading-snug text-ink">{leaf.example}</td>
              <td className="px-3 py-2 break-all text-[0.7rem] text-ink-soft/70">{leaf.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function IndependentCard({
  name,
  description,
  example,
}: {
  name: string
  description: string
  example: string
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-paper-raised p-4">
      <p className="break-all font-mono text-sm font-medium text-ink">{name}</p>
      <p className="text-sm text-ink-soft">{description}</p>
      <p className="rounded-md bg-paper-sunken p-2 font-mono text-[0.8em] leading-snug text-ink">
        {example}
      </p>
    </div>
  )
}

export function CitationLogicMockup() {
  useMockupTitle('Citation Logic')

  return (
    <div className="flex flex-1 flex-col gap-8 p-6 md:p-8">
      <div>
        <h1 className="font-display text-xl font-medium text-ink">Citation Logic</h1>
        <p className="max-w-3xl text-sm text-ink-soft">
          A decision-flow reference for <span className="font-mono">buildCitation</span> (
          <span className="font-mono">internal/handlers/citation.go</span>) — not a screen
          mockup, since there's no citation UI to preview, but kept under the same standing
          mockup-parity rule: whenever the real branching logic changes, this page (diagram and
          examples both) is updated in the same pass.
        </p>
      </div>

      <section className="overflow-x-auto rounded-lg border border-border bg-paper p-6">
        <img
          src={citationFlowchart}
          alt="Citation logic flowchart: buildCitation checks whether the piece has a source book and an In Copyright/Copyleft status. If not, buildFlatCitation runs, then branches on status into leaves A1-A3. If so, buildTwoSentenceCitation runs, branching first on whether the book's opus matches the piece's own, then on who owns the effective IMSLP number, into leaves B1-B6 (see the table below for what each one produces) — all of which converge on an optional trailing copyright clause."
          className="mx-auto min-w-[880px]"
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-medium text-ink">
          Path A — no book, or not Copyleft/In Copyright (buildFlatCitation)
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {FLAT_LEAVES.map((leaf) => (
            <LeafCard key={leaf.id} {...leaf} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-medium text-ink">
          Path B — has a book, Copyleft/In Copyright (buildTwoSentenceCitation)
        </h2>
        <LeafTable leaves={TWO_SENTENCE_LEAVES} />
        <p className="max-w-2xl text-xs text-ink-soft">
          Examples above are shown without it, but all six (B1-B6) can additionally end with a
          trailing <span className="font-mono">Copyright © {'{year}'} {'{holder}'}.</span> clause
          whenever there's a year or holder to attribute to (
          <span className="font-mono">copyrightClause</span>, see below).
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-display text-lg font-medium text-ink">Independent of the flow</h2>
          <p className="max-w-3xl text-sm text-ink-soft">
            Self-contained formatting rules the branches above call into, but that don't
            themselves branch on copyright status or book presence — each is the same regardless
            of which path above is taken.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <IndependentCard
            name="fusePublisherAndID(publisher, publisherId)"
            description='Fuses publisher + publisherId as "{publisher} #{id}", or whichever one alone is set, or "" when neither is.'
            example={`"G. Schirmer" + "#1234" → "G. Schirmer #1234"`}
          />
          <IndependentCard
            name="publisherOrIdentifierParts(eff, isbn)"
            description="The flat citation's single identifier slot — IMSLP wins outright over publisher/publisherId/ISBN, dropping them entirely, rather than showing several at once (unlike the two-sentence publish line above, which shows a book-owned IMSLP alongside publisher)."
            example={`IMSLP #04154 set → publisher & ISBN dropped entirely`}
          />
          <IndependentCard
            name="resolveOpus(pieceOpus, bookOpus)"
            description='Powers the "opus match?" decision above — a space-insensitive substring check (containsIgnoringSpaces) decides titlePrefix (remainder) vs. titleParen (piece’s own opus, independent of the book’s).'
            example={`book "Op. 68" + piece "Op. 68, No. 9" → remainder "No. 9"`}
          />
          <IndependentCard
            name="stripImslpPrefix(s)"
            description='Strips a leading "IMSLP" label already baked into stored data, in any spacing/case, so the citation’s own "IMSLP #" label never doubles up.'
            example={`"IMSLP: 04154" → "04154"`}
          />
          <IndependentCard
            name="hyphenateISBN(digits)"
            description="ISBN-10/13 hyphenation heuristic — a labeled approximation (single-digit vs. two-digit registration group by first digit), not the real Agency range tables."
            example={`"0132350882" → "0-13235088-2"`}
          />
          <IndependentCard
            name="joinPersonNames(names)"
            description='Natural-English Oxford-comma list: "" / "X" / "X and Y" / "X, Y, and Z".'
            example={`["X", "Y", "Z"] → "X, Y, and Z"`}
          />
          <IndependentCard
            name="copyrightClause(eff)"
            description={`Copyright Holder falls back to the piece's effective Publisher when unset. A bare "(renewed)" marker (US renewal follow-up — no specific year, since the exact filing year never changes the term calculation) joins right after the year when CopyrightRenewed is set. Omitted entirely (returns "") when there's neither a year nor a holder to attribute to.`}
            example={`year 1950, renewed, holder "Test Publisher" → "Copyright © 1950 (renewed) Test Publisher."`}
          />
          <IndependentCard
            name="endsWithPeriod(s)"
            description='Appends a trailing period only if s doesn’t already end in one — avoids "Inc.." for a holder like "G. Schirmer, Inc."'
            example={`"G. Schirmer, Inc." → "G. Schirmer, Inc." (unchanged)`}
          />
        </div>
      </section>
    </div>
  )
}
