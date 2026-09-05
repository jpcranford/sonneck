import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  IconArrowsSplit2,
  IconArrowLeft,
  IconCameraFilled,
  IconCheck,
  IconEditFilled,
  IconExternalLink,
  IconHeartFilled,
  IconLayoutGridFilled,
  IconLayoutListFilled,
  IconMusic,
  IconPhotoUp,
  IconSearch,
  IconTrash,
  IconXFilled,
} from '@tabler/icons-react'
import { ContextMenu } from '../components/ContextMenu'
import { MarkdownText } from '../components/MarkdownText'
import { Modal } from '../components/Modal'
import { TagComboBox } from '../components/TagComboBox'
import { TagPills } from '../components/TagPills'
import { PALETTE } from '../lib/pieceSplitLogic'
import { useMockupTitle } from '../lib/useMockupTitle'
import type { Tag } from '../api/types'

// ---------------------------------------------------------------------
// DESIGN MOCKUP for the Person Details page (Phase 4 of the composer/
// arranger overhaul — see the approved Phase 2 Artifact for the shape/
// layout decisions this ports into a real, interactive route:
// https://claude.ai/code/artifact/ba5e0a91-b177-4f79-b6f6-bf9d1de0bad8).
// That artifact bundled three tab-switchable screens (Details, Upload
// Portrait, Split People) — this mockup keeps the same scope, but as one
// real page with two real modals off it (Upload Portrait via the avatar's
// camera badge, Split People via its own toolbar button), matching how the
// real app actually navigates rather than an artifact's own tab switcher.
// Edit Person (name/bio/years/IMSLP autofill fields) is a stub here on
// purpose — that's Phase 5's own mockup, not this one.
//
// Not wired to the API — one fixture Person (Chopin, continuing the same
// id/name/years/paletteIndex as PeopleLibrarySample.tsx's own fixture #3
// for continuity across the design→mockup arc) with a fixture work list.
// Piece rows are plain, non-navigating rows (not real ClickableCard links)
// since these piece ids don't exist in any real database — same "cards
// aren't real links yet" posture PeopleLibrarySample.tsx already
// established for its own person cards. They do get the same right-click/
// long-press context menu the real page's works list has (added
// 2026-08-31, mockup-parity — see workContextMenuItems below): the
// favorite toggle is genuinely interactive against local state, same as
// the avatar's own hasPortrait toggle; Edit/Delete Piece use the same
// lastAction stub-message convention as Edit Person, since there's
// nothing real to open/delete here either.
// ---------------------------------------------------------------------

interface MockWork {
  id: number
  title: string
  opus: string | null
  // Mirrors the real piece.yearWritten's own EffectiveField shape
  // (repo/effective.go: a piece's own yearWritten falls back to its
  // book's yearPublished) — null means neither is set at all, `inherited:
  // true` means this value came from the book's Year Published field, not
  // the piece's own Year Written field. See yearWrittenLabel below for how
  // that distinction reaches the screen (direct request, 2026-09-03:
  // "{year} (pub.)" instead of a bare year whenever it's inherited this
  // way).
  yearWritten: { value: string; inherited: boolean } | null
  role: 'Composer' | 'Arranger'
  // The work's own full composer/arranger credit (not just this person's
  // own role) — feeds workMetaLine below, which mirrors
  // BookDetailsPage.tsx's own pieceMetaLine exactly.
  composer: string | null
  arranger: string | null
  pageCount: number
  bookTitle: string | null
  favorite: boolean
  sheetType: Tag | null
  userTags: Tag[]
}

const MOCK_WORKS: MockWork[] = [
  {
    id: 101,
    title: 'Prelude in C minor',
    opus: 'Op. 28 No. 20',
    yearWritten: { value: '1839', inherited: false },
    role: 'Composer',
    composer: 'Frédéric Chopin',
    arranger: null,
    pageCount: 2,
    bookTitle: '24 Préludes, Op. 28',
    favorite: true,
    sheetType: { id: 1, name: 'Solo Piano' },
    userTags: [{ id: 1, name: 'Recital piece' }],
  },
  {
    id: 102,
    title: 'Nocturne in E-flat major',
    opus: 'Op. 9 No. 2',
    yearWritten: { value: '1830–1832', inherited: false },
    role: 'Composer',
    composer: 'Frédéric Chopin',
    arranger: null,
    pageCount: 4,
    bookTitle: null,
    favorite: false,
    sheetType: { id: 1, name: 'Solo Piano' },
    userTags: [],
  },
  {
    id: 103,
    title: 'Waltz in D-flat major "Minute Waltz"',
    opus: 'Op. 64 No. 1',
    yearWritten: { value: '1847', inherited: false },
    role: 'Composer',
    composer: 'Frédéric Chopin',
    arranger: null,
    pageCount: 3,
    bookTitle: 'Chopin: Waltzes',
    favorite: false,
    sheetType: { id: 1, name: 'Solo Piano' },
    userTags: [],
  },
  {
    id: 104,
    title: 'Fantaisie-Impromptu',
    opus: 'Op. 66',
    yearWritten: { value: '1834', inherited: false },
    role: 'Composer',
    composer: 'Frédéric Chopin',
    arranger: null,
    pageCount: 8,
    bookTitle: null,
    favorite: true,
    sheetType: { id: 1, name: 'Solo Piano' },
    userTags: [{ id: 2, name: 'Working on this' }],
  },
  {
    id: 105,
    title: 'Ballade No. 1 in G minor',
    opus: 'Op. 23',
    yearWritten: { value: '1835–1836', inherited: false },
    role: 'Composer',
    composer: 'Frédéric Chopin',
    arranger: null,
    pageCount: 12,
    bookTitle: null,
    favorite: false,
    // Deliberately no sheetType/userTags (keys/instruments are always
    // empty in this fixture) — TagPills returns null when every field is
    // blank, so this exercises the no-pills-row case rather than every
    // work looking identical with a "Solo Piano" pill.
    sheetType: null,
    userTags: [],
  },
  {
    id: 106,
    title: 'Military Polonaise',
    opus: 'Op. 40 No. 1',
    // Deliberately shares 1836 with work 107 below (was 1838) — the two
    // now collide on year, so the new opus-number tiebreaker (2026-09-03)
    // is actually exercised: this work's "Op. 40 No. 1" (opusSortKey 40)
    // must sort ahead of 107's opus-less null (sorts last), not fall back
    // to a coincidentally-correct title comparison.
    yearWritten: { value: '1836', inherited: false },
    role: 'Composer',
    // Carries a co-arranger too — exercises the composer+arranger fusion
    // branch of workMetaLine below, not just the plain-composer case every
    // other fixture work hits.
    composer: 'Frédéric Chopin',
    arranger: 'Carl Tausig',
    pageCount: 7,
    bookTitle: 'Chopin: Polonaises',
    favorite: false,
    sheetType: { id: 1, name: 'Solo Piano' },
    userTags: [],
  },
  // Demonstrates the Arranger role case — the role badge/filter reads
  // person-specific per work, not a fixed property of the whole page, so
  // at least one non-Composer credit needs to exist in the fixture to
  // actually exercise that path. Also the opus-less half of the 1836
  // year-collision with work 106 above (see its own comment).
  {
    id: 107,
    title: 'Chant polonais',
    opus: null,
    yearWritten: { value: '1836', inherited: false },
    role: 'Arranger',
    // No named composer — a traditional Polish folk song Chopin arranged,
    // not composed; exercises workMetaLine's arranger-only branch
    // ("arr. Arranger", no leading composer name).
    composer: null,
    arranger: 'Frédéric Chopin',
    pageCount: 2,
    bookTitle: null,
    favorite: false,
    sheetType: { id: 1, name: 'Solo Piano' },
    userTags: [],
  },
  // Demonstrates the inherited-year "(pub.)" case (direct request,
  // 2026-09-03) — this piece has no Year Written of its own, so its
  // effective year comes from its book's Year Published field instead.
  // Shown as "1833 (pub.)" rather than a bare year, so it reads as "this
  // is when the book came out," not "this is when the piece was written"
  // — those are two different facts and conflating them would
  // misrepresent a work whose actual composition date isn't on record at
  // all.
  {
    id: 108,
    title: 'Grande Valse Brillante',
    opus: 'Op. 18',
    yearWritten: { value: '1833', inherited: true },
    role: 'Composer',
    composer: 'Frédéric Chopin',
    arranger: null,
    pageCount: 5,
    bookTitle: 'Chopin: Waltzes',
    favorite: false,
    sheetType: { id: 1, name: 'Solo Piano' },
    userTags: [],
  },
]

// Chronological, not grouped by role — sortWorks (defined below; function
// declarations hoist, so this module-level use ahead of its own textual
// definition is fine) mixes Composer and Arranger credits into one flat
// list, per direct instruction not to sort arranger credits separately.
const SORTED_WORKS = sortWorks(MOCK_WORKS)

// Direct book-level credits (Book.composer/arranger naming this person
// specifically, not just a piece inheriting it) — locked as a small chip
// strip above the works list, not a second section, per the Phase 2
// artifact's own "Works section lists pieces only" decision.
interface MockBookCredit {
  id: number
  title: string
  role: 'Composer' | 'Arranger'
}
const MOCK_BOOK_CREDITS: MockBookCredit[] = [
  { id: 201, title: '24 Préludes, Op. 28', role: 'Composer' },
  { id: 202, title: 'Chopin: Waltzes', role: 'Composer' },
]

const MOCK_PERSON = {
  id: 3,
  name: 'Frédéric Chopin',
  birthYear: 1810,
  deathYear: 1849,
  paletteIndex: 2,
  bio: "Polish composer and virtuoso pianist of the Romantic era, known almost exclusively for solo piano works. Chopin left Poland at 20 and spent most of his career in Paris, where his music drew heavily on Polish folk idioms — the mazurka and polonaise chief among them — reworked into a personal, harmonically adventurous style.\n\nHis output is small (fewer than 250 works) but concentrated almost entirely in short forms: nocturnes, preludes, études, waltzes, and ballades, each pushing the technical and expressive range of the instrument further than most of his contemporaries attempted.",
}

// Other fixture people, standing in for the app's real Person catalog —
// used as Split People's search-existing options (TagComboBox's own
// suggest-or-create pattern already covers "create a brand new
// replacement Person" for free, since it's the same widget the real
// composer/arranger fields will use).
const OTHER_PEOPLE: Tag[] = [
  { id: 4, name: 'Ludwig van Beethoven' },
  { id: 5, name: 'Johannes Brahms' },
  { id: 6, name: 'Clara Schumann' },
  { id: 20, name: 'Robert Schumann' },
  { id: 21, name: 'Franz Liszt' },
]

// Same partial-case rule as PeopleLibrarySample.tsx's own formatLifespan.
function formatLifespan(birthYear: number | null, deathYear: number | null): string | null {
  if (birthYear && deathYear) return `${birthYear}–${deathYear}`
  if (deathYear) return `d. ${deathYear}`
  if (birthYear) return `b. ${birthYear}`
  return null
}

// Migration plan's own join convention (CLAUDE.md / project memory): 2 →
// "X and Y"; 3 → "X, Y, and Z"; 4+ → "X, Y, Z, and Last". Reused here for
// Split People's own preview line, since it's the same multi-person
// display format the real composer/arranger fields will need once built.
function joinNames(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

// Parenthetical, matching Book Details' own title+opus convention
// (BookDetailsPage.tsx: `{book.bookTitle}{book.workOpusNumber ? \` (${book.workOpusNumber})\` : ''}`)
// — not the comma-joined form this used before (direct correction).
function workTitle(work: MockWork): string {
  return work.opus ? `${work.title} (${work.opus})` : work.title
}

function pagesLabel(work: MockWork): string {
  return `${work.pageCount} ${work.pageCount === 1 ? 'page' : 'pages'}`
}

// List view's meta line — replaced the earlier bare "book title only"
// line with the exact composer/arranger + page-count string Book Details'
// own list view uses (BookDetailsPage.tsx's pieceMetaLine, ported
// verbatim: composer/arranger comma-fused, composer-or-arranger fallback
// when only one is set), with this work's own book credit appended at the
// end (direct instruction). A bookless work simply drops that last
// segment — `filter(Boolean).join(' • ')` already omits it cleanly, same
// "hide missing metadata" rule as everywhere else, no separate bookTitle
// conditional needed anymore.
function workMetaLine(work: MockWork): string {
  const composerPart =
    work.composer && work.arranger
      ? `${work.composer}, arr. ${work.arranger}`
      : work.composer
        ? work.composer
        : work.arranger
          ? `arr. ${work.arranger}`
          : null
  return [composerPart, pagesLabel(work), work.bookTitle].filter((part): part is string => !!part).join(' • ')
}

// Display label for a work's year: bare value when it's the piece's own
// Year Written, "{year} (pub.)" when it's inherited from the book's Year
// Published instead (direct request, 2026-09-03; format changed same day
// from a leading "pub. {year}" to this trailing form per direct
// follow-up) — the suffix is a rendering-only concern layered on top of
// the same underlying value/inherited pair workYearSortKey reads below,
// so the two never disagree about what year a work actually sorts under.
function yearWrittenLabel(yearWritten: MockWork['yearWritten']): string {
  if (!yearWritten) return '—'
  return yearWritten.inherited ? `${yearWritten.value} (pub.)` : yearWritten.value
}

// Sort key for "sort by year written, arranger credits mixed in with
// everything else" (direct instruction) — no separate grouping by role,
// just one flat chronological list. yearWritten.value can be a range
// ("1830–1832"), so this sorts on the first number found rather than
// requiring a clean single year; a work with no year at all sorts last
// (this app's usual direction-invariant blank-field-last convention).
// Reads the raw value regardless of `inherited` — the "(pub.)" suffix
// (yearWrittenLabel above) is display-only and never reaches this
// function, so it has nothing to ignore in the first place; the /\d+/
// match finds the same leading digits either way.
function workYearSortKey(work: MockWork): number {
  const match = work.yearWritten?.value.match(/\d+/)
  return match ? Number(match[0]) : Number.POSITIVE_INFINITY
}
// Compares the work's own effective opus number (mirrors the real
// piece.workOpusNumber's resolved/book-inheritable value — this fixture's
// plain `opus: string | null` already stands in for that same effective
// value, same as yearWritten above). Real dev data surfaced a case this
// fixture didn't originally cover: a set of pieces sharing one base opus
// ("Op. 12 No. 1".."Op. 12 No. 10") needs its trailing number compared too,
// not just the first one found, or the whole set falls through to a plain
// alphabetical title tiebreak instead of piece-number order (see
// PersonDetailsPage.tsx's own compareOpus for the full writeup — ported
// here for mockup-parity). `localeCompare`'s built-in `numeric: true` mode
// handles this in one line. A work with no opus at all sorts last (direct
// request, 2026-09-03).
function compareOpus(a: string | null, b: string | null): number {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  return a.localeCompare(b, undefined, { numeric: true })
}
// Same "ignore a leading A/An/The" convention the backend's own title sort
// applies elsewhere (CLAUDE.md > Frontend) — mockup-parity with
// PersonDetailsPage.tsx's own titleSortKey.
function titleSortKey(title: string): string {
  return title.replace(/^(a|an|the)\s+/i, '').toLowerCase()
}
// Year written first, then opus number, then title A→Z as the final
// tiebreaker (direct request, 2026-09-03 — opus inserted as the new middle
// key between the existing year-then-title chain from 2026-09-01).
function sortWorks(works: MockWork[]): MockWork[] {
  return [...works].sort((a, b) => {
    const yearDiff = workYearSortKey(a) - workYearSortKey(b)
    if (yearDiff !== 0) return yearDiff
    const opusDiff = compareOpus(a.opus, b.opus)
    if (opusDiff !== 0) return opusDiff
    return titleSortKey(a.title).localeCompare(titleSortKey(b.title))
  })
}

// Only the Arranger role gets called out — Composer is the expected/
// default credit on a composer's own Details page, so "as Composer" on
// every single row read as noise; only the exception (an arranger credit)
// is worth a badge (direct instruction: "only arrangers should be set
// apart"). Capitalized role noun, not just the whole phrase.
function RoleBadge({ role }: { role: 'Composer' | 'Arranger' }) {
  if (role !== 'Arranger') return null
  return (
    // font-sans explicitly, not inherited — WorkList renders this badge
    // as a child of the work title's own <p>, which sets font-display
    // (Libre Baskerville) for the title text; without an explicit
    // override here the badge silently inherited that serif instead of
    // the app's default sans, found via direct report.
    <span className="shrink-0 rounded-full bg-paper-sunken px-2 py-0.5 font-sans text-[0.65rem] font-medium text-ink-soft">
      as Arranger
    </span>
  )
}

// ---------------------------------------------------------------------
// Avatar — same oval-mask + container-query-sized-initials technique as
// PeopleLibrarySample.tsx's own PersonAvatar (page-local composite, hand-
// duplicated per this codebase's mockup convention rather than imported —
// see that file's own comment on `rounded-[50%]` vs `rounded-full`). This
// page's avatar additionally supports a real "photo" state (a hand-
// authored SVG cameo portrait, no AI-generated art) since Person Details
// is where the portrait itself is the whole point, not just a small list
// thumbnail.
// ---------------------------------------------------------------------

function CameoPortrait() {
  return (
    <svg viewBox="0 0 100 130" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
      <rect width="100" height="130" fill="#3a3430" />
      <circle cx="50" cy="48" r="22" fill="#cbb89a" />
      <path d="M14 130c0-28 18-46 36-46s36 18 36 46" fill="#cbb89a" />
      <path
        d="M28 40c2-14 12-22 22-22s20 8 22 22c-4-6-12-10-22-10s-18 4-22 10z"
        fill="#1f1b18"
      />
    </svg>
  )
}

function PersonAvatar({
  hasPortrait,
  paletteIndex,
  name,
  className,
}: {
  hasPortrait: boolean
  paletteIndex: number
  name: string
  className: string
}) {
  const color = PALETTE[paletteIndex % PALETTE.length]
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .filter(Boolean)
  const initialsText =
    initials.length === 0 ? '?' : (initials[0] + (initials[initials.length - 1] ?? '')).toUpperCase()
  return (
    <div
      className={`relative aspect-[3/4] overflow-hidden rounded-[50%] border border-border [container-type:inline-size] ${className}`}
      style={{ backgroundColor: color }}
    >
      {hasPortrait ? (
        <CameoPortrait />
      ) : (
        <div className="flex h-full w-full items-center justify-center font-display font-medium text-white text-[26cqw]">
          {initialsText}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Works list — grid mirrors BookDetailsPage.tsx's own PieceGrid; list
// mirrors its PieceList near-exactly, per the Phase 2 artifact's locked
// decision ("List view rebuilt to directly mirror BookDetailsPage.tsx's
// real PieceList"). The one structural difference: this page's own left
// column is Year Written, not a page range (a Person has no page
// provenance of their own), and the meta line under the title is
// book-only now that year has its own column — composer/arranger doesn't
// belong in that meta line either, since we're already looking at exactly
// one of this piece's credited people.
// ---------------------------------------------------------------------

function WorkThumbnail({ paletteIndex, className }: { paletteIndex: number; className: string }) {
  return (
    <div
      className={`flex items-center justify-center rounded-md border border-border ${className}`}
      style={{ backgroundColor: `${PALETTE[paletteIndex % PALETTE.length]}26` }}
    >
      <IconMusic size={16} className="text-ink-soft" />
    </div>
  )
}

const THUMB_HIDE_CLASS = 'max-[501px]:hidden'
const ROW_COLLAPSE_CLASS = 'max-[501px]:grid-cols-[72px_1fr]'

// workContextMenuItems mirrors the real page's own PieceContextMenu
// exactly — same three items in the same order (favorite toggle/Edit
// Piece/destructive Delete Piece) — kept in sync per this app's standing
// mockup-parity convention even though this fixture's piece ids don't
// exist in any real database (see this file's own header comment): the
// favorite toggle is genuinely local-state-interactive, same treatment
// the avatar's own context menu already gets (hasPortrait), while Edit/
// Delete surface the same lastAction stub-message pattern already
// established here for Edit Person and Delete Person, since neither has
// anything real to open/delete against a fixture.
function workContextMenuItems(
  work: MockWork,
  onToggleFavorite: (id: number) => void,
  onAction: (message: string) => void,
): { label: string; onSelect: () => void; destructive?: boolean }[] {
  return [
    {
      label: work.favorite ? 'Remove from Favorites' : 'Add to Favorites',
      onSelect: () => onToggleFavorite(work.id),
    },
    {
      label: 'Edit Piece',
      onSelect: () => onAction(`Mock action: this opens the Edit Piece modal for "${workTitle(work)}".`),
    },
    {
      label: 'Delete Piece',
      destructive: true,
      onSelect: () => {
        if (window.confirm(`Delete "${workTitle(work)}"? This can't be undone.`)) {
          onAction(`Mock action: "${workTitle(work)}" would be deleted.`)
        }
      },
    },
  ]
}

function WorkGrid({
  works,
  onToggleFavorite,
  onAction,
}: {
  works: MockWork[]
  onToggleFavorite: (id: number) => void
  onAction: (message: string) => void
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3">
      {works.map((work, index) => (
        <ContextMenu key={work.id} items={workContextMenuItems(work, onToggleFavorite, onAction)} hideTriggerButton>
          <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-paper-raised text-left">
            <WorkThumbnail paletteIndex={index} className="aspect-[180/132] rounded-none border-0 border-b" />
            <div className="flex flex-col gap-0.5 px-2 py-1.5">
              <p className="flex min-w-0 items-center gap-1 font-display text-[0.8rem] font-medium text-ink">
                <span className="truncate">{workTitle(work)}</span>
                {work.favorite && (
                  <span className="shrink-0 text-accent" title="Favorite">
                    <IconHeartFilled size={13} />
                  </span>
                )}
              </p>
              <p className="text-[0.65rem] text-ink-soft/80">
                {yearWrittenLabel(work.yearWritten)}
                {/* Bullet separator, not an interpunct — CLAUDE.md's own
                    standing dot-separator convention, which keeps drifting
                    into freshly-built screens; caught here directly. */}
                {work.role === 'Arranger' && ' • as Arranger'}
              </p>
            </div>
          </div>
        </ContextMenu>
      ))}
    </div>
  )
}

function WorkList({
  works,
  onToggleFavorite,
  onAction,
}: {
  works: MockWork[]
  onToggleFavorite: (id: number) => void
  onAction: (message: string) => void
}) {
  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-[96px_1fr_56px] gap-3 px-1.5 pb-2.5 text-[0.7rem] font-medium tracking-wide text-ink-soft uppercase">
        <div className="text-center">Year</div>
        <div>Title</div>
        <div className={THUMB_HIDE_CLASS} />
      </div>
      <div>
        {works.map((work, index) => (
          <ContextMenu key={work.id} items={workContextMenuItems(work, onToggleFavorite, onAction)} hideTriggerButton>
            <div
              className={`grid grid-cols-[96px_1fr_56px] items-center gap-3 border-t border-border px-1.5 py-2.5 text-left hover:rounded-md hover:bg-accent-soft ${ROW_COLLAPSE_CLASS}`}
            >
              <div className="text-center text-sm font-medium tabular-nums text-ink">
                {yearWrittenLabel(work.yearWritten)}
              </div>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 font-display text-[0.92rem] font-medium text-ink">
                  {workTitle(work)}
                  {work.favorite && (
                    <span className="text-accent" title="Favorite">
                      <IconHeartFilled size={13} />
                    </span>
                  )}
                  <RoleBadge role={work.role} />
                </p>
                <p className="mt-0.5 text-xs text-ink-soft">{workMetaLine(work)}</p>
                <TagPills
                  keys={[]}
                  sheetType={work.sheetType}
                  instruments={[]}
                  userTags={work.userTags}
                  className="mt-1.5"
                />
              </div>
              <WorkThumbnail paletteIndex={index} className={`h-[42px] w-14 ${THUMB_HIDE_CLASS}`} />
            </div>
          </ContextMenu>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// Upload Portrait — device upload OR Wikipedia search, then a real
// drag-to-pan + zoom-slider adjust step against the oval frame (Phase 2
// artifact's own three-screen scope, folded into one modal here since
// this is a real page flow, not a tab-switched artifact).
// ---------------------------------------------------------------------

interface WikiResult {
  title: string
  description: string
  thumbColor: string
  relevant: boolean
}

// Deliberately includes irrelevant noise (a crater, an airport) — locked
// in the Phase 2 artifact review specifically to demonstrate why a human
// still has to pick the right result, not just take the first hit.
const WIKI_RESULTS: WikiResult[] = [
  {
    title: 'Frédéric Chopin',
    // Two real sentences, matching the real backend's own exsentences=2
    // (changed 2026-09-01, "just one often isn't enough") and this file's
    // line-clamp-2 treatment right below — long enough to actually wrap
    // to a real second line, not just a CSS change with nothing here
    // long enough to show it.
    description:
      'Polish composer and virtuoso pianist (1810–1849). Widely regarded as one of the greatest composers for the piano, celebrated for his mazurkas, nocturnes, and études.',
    thumbColor: '#5c8a8a',
    relevant: true,
  },
  { title: 'Chopin (crater)', description: 'Impact crater on Mercury named after the composer', thumbColor: '#6b6560', relevant: false },
  { title: 'Chopin Airport', description: 'Warsaw Chopin Airport, the main international airport of Warsaw, Poland', thumbColor: '#6b6560', relevant: false },
]

function UploadPortraitModal({
  open,
  onClose,
  onSave,
}: {
  open: boolean
  onClose: () => void
  onSave: () => void
}) {
  const [step, setStep] = useState<'source' | 'adjust'>('source')
  const [wikiQuery, setWikiQuery] = useState(MOCK_PERSON.name)
  const [searched, setSearched] = useState(false)
  const [chosenLabel, setChosenLabel] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function reset() {
    setStep('source')
    setSearched(false)
    setChosenLabel(null)
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }
  function handleClose() {
    reset()
    onClose()
  }
  function pickSource(label: string) {
    setChosenLabel(label)
    setStep('adjust')
  }
  function handleSave() {
    reset()
    onSave()
  }

  function onDragStart(event: ReactMouseEvent) {
    dragState.current = { startX: event.clientX, startY: event.clientY, originX: pan.x, originY: pan.y }
  }
  function onDragMove(event: ReactMouseEvent) {
    if (!dragState.current) return
    const dx = event.clientX - dragState.current.startX
    const dy = event.clientY - dragState.current.startY
    setPan({ x: dragState.current.originX + dx, y: dragState.current.originY + dy })
  }
  function onDragEnd() {
    dragState.current = null
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      labelledBy="upload-portrait-title"
      header={
        <div className="flex items-start justify-between gap-4">
          <h2 id="upload-portrait-title" className="font-display text-2xl font-medium text-ink">
            {step === 'source' ? 'Change portrait' : 'Adjust portrait'}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="mt-1 shrink-0 cursor-pointer text-ink-soft hover:text-accent"
          >
            <IconXFilled size={22} />
          </button>
        </div>
      }
      footer={
        step === 'adjust' ? (
          <div className="flex justify-between gap-2">
            <button
              type="button"
              onClick={() => setStep('source')}
              className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="flex cursor-pointer items-center gap-1.5 rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90"
            >
              <IconCheck size={16} />
              Save portrait
            </button>
          </div>
        ) : undefined
      }
    >
      {step === 'source' && (
        <div className="flex flex-col gap-5">
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                if (event.target.files?.[0]) pickSource(`Uploaded: ${event.target.files[0].name}`)
                event.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-paper-sunken px-4 py-6 text-ink-soft hover:border-accent hover:text-accent"
            >
              <IconPhotoUp size={18} />
              Upload from device
            </button>
          </div>

          <div className="flex items-center gap-3 text-xs text-ink-soft">
            <span className="h-px flex-1 bg-border" />
            or search Wikipedia
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="flex flex-col gap-2">
            <div className="relative">
              <IconSearch
                size={16}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft"
              />
              <input
                type="text"
                value={wikiQuery}
                onChange={(event) => {
                  setWikiQuery(event.target.value)
                  setSearched(false)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setSearched(true)
                }}
                placeholder="Search Wikipedia…"
                className="w-full rounded-md border border-border bg-paper-raised py-2 pr-3 pl-9 text-sm text-ink"
              />
            </div>
            <button
              type="button"
              onClick={() => setSearched(true)}
              className="self-end cursor-pointer text-xs text-accent hover:underline"
            >
              Search
            </button>

            {searched && (
              <div className="flex flex-col divide-y divide-border rounded-md border border-border">
                {WIKI_RESULTS.map((result) => (
                  <button
                    key={result.title}
                    type="button"
                    onClick={() => pickSource(`Wikipedia: ${result.title}`)}
                    className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-left hover:bg-paper-sunken"
                  >
                    <span
                      className="flex size-9 shrink-0 items-center justify-center rounded-full text-white"
                      style={{ backgroundColor: result.thumbColor }}
                    >
                      <IconExternalLink size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-sm font-medium text-ink">
                        {result.title}
                      </span>
                      {/* line-clamp-2, not truncate — mockup-parity with
                          the real Upload Portrait/Edit Person's own fix
                          (2026-09-01, "just one [line] often isn't
                          enough"). */}
                      <span className="line-clamp-2 text-xs text-ink-soft">{result.description}</span>
                    </span>
                    {!result.relevant && (
                      <span className="shrink-0 text-[0.65rem] text-ink-soft/70 italic">not this one</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {step === 'adjust' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-soft">
            Drag to reposition, use the slider to zoom — the frame below is exactly what will be saved.
            <span className="ml-1 text-ink-soft/70 italic">({chosenLabel})</span>
          </p>
          <div
            className="mx-auto aspect-[3/4] w-40 cursor-grab overflow-hidden rounded-[50%] border border-border bg-paper-sunken active:cursor-grabbing"
            onMouseDown={onDragStart}
            onMouseMove={onDragMove}
            onMouseUp={onDragEnd}
            onMouseLeave={onDragEnd}
          >
            <div
              className="h-full w-full select-none"
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'center' }}
            >
              <CameoPortrait />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-ink-soft">Zoom</span>
            <input
              type="range"
              min={1}
              max={2.5}
              step={0.05}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="flex-1 accent-accent"
            />
          </div>
        </div>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------------
// Split People — reuses the real, shared TagComboBox (pillStyle="paper",
// multiple) as its ordered replacement-picker: the exact suggest-existing-
// or-create-new widget the real composer/arranger fields will use once
// built (Phase 6), per the Phase 2 artifact's own locked decision.
// ---------------------------------------------------------------------

function SplitPeopleModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (names: string[]) => void
}) {
  const [replacements, setReplacements] = useState<Tag[]>([])

  function handleClose() {
    setReplacements([])
    onClose()
  }
  function handleConfirm() {
    onConfirm(replacements.map((r) => r.name))
    setReplacements([])
  }

  const names = replacements.map((r) => r.name)
  const previewLine =
    names.length === 0
      ? null
      : names.length === 1
        ? `This will rename "${MOCK_PERSON.name}" to "${names[0]}" — every piece and book credit stays exactly where it is.`
        : `This will split "${MOCK_PERSON.name}"'s ${MOCK_WORKS.length + MOCK_BOOK_CREDITS.length} credits among ${joinNames(names)}, in that order.`

  return (
    <Modal
      open={open}
      onClose={handleClose}
      labelledBy="split-people-title"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={replacements.length === 0}
            className="cursor-pointer rounded-md bg-accent px-4 py-2 font-display text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Split Person
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <h2 id="split-people-title" className="font-display text-2xl font-medium text-ink">
            Split "{MOCK_PERSON.name}"
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            Reassign every one of this person's current piece and book credits to one or more replacement
            people, in order. "{MOCK_PERSON.name}" isn't deleted — they're just left with zero credits
            afterward.
          </p>
        </div>

        <TagComboBox
          label="Replace with"
          options={OTHER_PEOPLE}
          selected={replacements}
          multiple
          pillStyle="paper"
          newOptionLabel="New person"
          onChange={setReplacements}
        />

        {previewLine && (
          <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-3 py-2 text-sm text-ink-soft">
            {previewLine}
          </div>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------

export function PersonDetailsSample() {
  useMockupTitle('Person Details')

  const [hasPortrait, setHasPortrait] = useState(true)
  const [uploadPortraitOpen, setUploadPortraitOpen] = useState(false)
  const [splitPeopleOpen, setSplitPeopleOpen] = useState(false)
  const [workViewMode, setWorkViewMode] = useState<'grid' | 'list'>('list')
  const [lastAction, setLastAction] = useState<string | null>(null)
  // Lifted into state (was a plain module constant) so the works grid/
  // list's own right-click/long-press context menu can genuinely toggle
  // a favorite, same "real local interactivity where it's cheap" posture
  // the avatar's own hasPortrait toggle already has.
  const [works, setWorks] = useState<MockWork[]>(SORTED_WORKS)

  function toggleWorkFavorite(id: number) {
    setWorks((prev) => prev.map((w) => (w.id === id ? { ...w, favorite: !w.favorite } : w)))
  }

  const lifespan = formatLifespan(MOCK_PERSON.birthYear, MOCK_PERSON.deathYear)

  const avatarContextMenuItems = [
    { label: 'Change Portrait', onSelect: () => setUploadPortraitOpen(true) },
    ...(hasPortrait
      ? [{ label: 'Remove Portrait', onSelect: () => setHasPortrait(false), destructive: true }]
      : []),
  ]

  function handleDelete() {
    if (window.confirm(`Delete "${MOCK_PERSON.name}"? This can't be undone.`)) {
      setLastAction(
        `Mock action: "${MOCK_PERSON.name}" would be deleted, and you'd be sent back to the People Library.`,
      )
    }
  }

  function handleEditPerson() {
    setLastAction('Mock action: this opens the Edit Person modal, not built until Phase 5.')
  }

  // Keyboard shortcut: E opens the edit menu — mirrors the real
  // PersonDetailsPage.tsx (added 2026-08-31, mockup-parity), which itself
  // matches PiecePage.tsx's/BookDetailsPage.tsx's own E shortcut. Calls
  // the exact same handler the "Edit Person" button does above (the same
  // Phase-5-stub message, not a real modal — this mockup doesn't have
  // one). Skipped while Upload Portrait or Split People is open (both are
  // real, interactive modals here with their own text fields) or while
  // focus is in any text-entry element, so typing "e" elsewhere is never
  // intercepted. `repeat` guards against a held-down key re-firing the
  // stub message on every repeat tick.
  useEffect(() => {
    if (uploadPortraitOpen || splitPeopleOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return
      }
      if (event.key.toLowerCase() === 'e') {
        event.preventDefault()
        handleEditPerson()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [uploadPortraitOpen, splitPeopleOpen])

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 md:p-8">
      {/* Every /mockup/* page's Back control routes to the mockup index,
          not wherever its own label implies — same convention as
          PieceDetailsSample.tsx/BookDetailsSample.tsx (see CLAUDE.md >
          Frontend). */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          to="/mockup"
          className="inline-flex w-fit items-center gap-1.5 text-sm whitespace-nowrap text-ink-soft hover:text-ink"
        >
          <IconArrowLeft size={24} />
          Back to People
        </Link>
        <div className="flex shrink-0 items-stretch gap-2.5">
          <button
            type="button"
            onClick={handleDelete}
            aria-label="Delete Person"
            title="Delete Person"
            className="flex w-[38px] cursor-pointer items-center justify-center rounded-md border border-border bg-paper-raised text-red-700 hover:border-red-700"
          >
            <IconTrash size={16} />
          </button>
          <span aria-hidden="true" className="h-6 w-px self-center bg-border" />
          <button
            type="button"
            onClick={() => setSplitPeopleOpen(true)}
            className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-sm whitespace-nowrap text-ink hover:border-accent"
          >
            <IconArrowsSplit2 size={16} />
            <span className="max-[420px]:hidden">Split People</span>
          </button>
          <button
            type="button"
            title="Coming in Phase 5 — Edit Person modal"
            onClick={handleEditPerson}
            className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-sm whitespace-nowrap text-ink hover:border-accent max-[360px]:w-[38px] max-[360px]:px-0"
          >
            <IconEditFilled size={16} />
            <span className="max-[360px]:hidden">Edit Person</span>
          </button>
        </div>
      </div>

      <div className="p-0">
        <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
          Design mockup — <span className="font-medium text-ink">Person Details</span>. Change/remove
          portrait (right-click the avatar, or its camera badge), Upload Portrait's device/Wikipedia +
          drag-to-pan/zoom adjust step, Split People's ordered replacement picker, the works grid/list
          toggle, and right-click/long-press on a work (favorite toggle is real; Edit/Delete Piece are
          stubs) are all genuinely interactive against one fixture person. Edit Person is a stub —
          that's Phase 5 — but its "E" keyboard shortcut (matching the real page) still fires the same
          stub message.
        </div>
      </div>

      {lastAction && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-paper-sunken px-4 py-2.5 text-sm text-ink-soft">
          {lastAction}
          <button
            type="button"
            onClick={() => setLastAction(null)}
            aria-label="Dismiss"
            className="shrink-0 cursor-pointer text-ink-soft hover:text-ink"
          >
            <IconXFilled size={14} />
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-paper-raised shadow-sm">
        {/* Stacked below lg:, side-by-side above it — mockup-parity port of
            the real PersonDetailsPage.tsx's own fix (project_responsive_
            device_plan, Phase 4): at phone width the name/credit-chip
            column had nowhere near enough room beside the fixed 150px
            avatar. */}
        <div className="flex flex-col gap-6 p-7 lg:flex-row lg:items-start">
          {/* Camera badge is the only visible edit trigger on the portrait
              itself (locked in the Phase 2 artifact review) — no separate
              always-visible toolbar button for it, mirroring Book Details'
              own "no redundant triggers" cover treatment. Right-click/
              long-press still works too, same ContextMenu component Book
              Details uses for its own cover image. */}
          <ContextMenu items={avatarContextMenuItems} hideTriggerButton>
            <div className="relative w-[150px] shrink-0">
              <PersonAvatar
                hasPortrait={hasPortrait}
                paletteIndex={MOCK_PERSON.paletteIndex}
                name={MOCK_PERSON.name}
                className="w-full shadow-sm"
              />
              <button
                type="button"
                onClick={() => setUploadPortraitOpen(true)}
                aria-label="Change portrait"
                title="Change portrait"
                className="absolute right-1.5 bottom-1.5 flex size-8 cursor-pointer items-center justify-center rounded-full border-2 border-paper-raised bg-ink text-paper shadow-md hover:bg-ink/85"
              >
                <IconCameraFilled size={14} />
              </button>
            </div>
          </ContextMenu>

          <div className="min-w-0 flex-1">
            <div className="mb-2">
              <h1 className="font-display text-[1.35rem] font-medium text-ink">{MOCK_PERSON.name}</h1>
              {lifespan && <p className="text-[0.92rem] text-ink-soft">{lifespan}</p>}
            </div>

            <div className="max-w-[60ch] text-[0.88rem] text-ink-soft">
              <MarkdownText>{MOCK_PERSON.bio}</MarkdownText>
            </div>

            {MOCK_BOOK_CREDITS.length > 0 && (
              <div className="mt-3.5">
                <dt className="mb-1.5 text-[0.7rem] tracking-wide text-ink-soft uppercase">
                  Also credited directly on {MOCK_BOOK_CREDITS.length}{' '}
                  {MOCK_BOOK_CREDITS.length === 1 ? 'book' : 'books'}
                </dt>
                <dd className="flex flex-wrap gap-2">
                  {MOCK_BOOK_CREDITS.map((credit, index) => (
                    <span
                      key={credit.id}
                      className="flex items-center gap-2 rounded-full border border-border bg-paper-sunken py-[7px] pr-4 pl-[9px] text-xs text-ink"
                    >
                      <span
                        className="flex size-5 shrink-0 items-center justify-center rounded-full text-white"
                        style={{ backgroundColor: PALETTE[index % PALETTE.length] }}
                      >
                        <IconMusic size={10} />
                      </span>
                      <span className="font-medium">{credit.title}</span>
                      <span className="text-ink-soft">as {credit.role}</span>
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Works — deliberately NOT a card, just spacing below the header
          card, same as BookDetailsPage.tsx's own pieces area. This row's
          own classes must literally match that page's row, not just look
          similar (locked in review after an earlier attempt "fixed" a
          reported width complaint by inventing a different layout instead
          of using the real one). */}
      <div className="bg-paper">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 pb-4">
          <h2 className="font-display text-[0.95rem] font-semibold text-ink-soft">
            {MOCK_WORKS.length} {MOCK_WORKS.length === 1 ? 'piece' : 'pieces'}
          </h2>
          <div className="flex shrink-0 items-center gap-1 rounded-md border border-border p-0.5">
            <button
              type="button"
              onClick={() => setWorkViewMode('grid')}
              aria-label="Grid view"
              aria-pressed={workViewMode === 'grid'}
              className={`flex size-8 cursor-pointer items-center justify-center rounded ${
                workViewMode === 'grid' ? 'bg-accent-soft text-accent' : 'text-ink-soft'
              }`}
            >
              <IconLayoutGridFilled size={16} />
            </button>
            <button
              type="button"
              onClick={() => setWorkViewMode('list')}
              aria-label="List view"
              aria-pressed={workViewMode === 'list'}
              className={`flex size-8 cursor-pointer items-center justify-center rounded ${
                workViewMode === 'list' ? 'bg-accent-soft text-accent' : 'text-ink-soft'
              }`}
            >
              <IconLayoutListFilled size={16} />
            </button>
          </div>
        </div>
        <div className="px-6 pb-5">
          {workViewMode === 'grid' ? (
            <WorkGrid works={works} onToggleFavorite={toggleWorkFavorite} onAction={setLastAction} />
          ) : (
            <WorkList works={works} onToggleFavorite={toggleWorkFavorite} onAction={setLastAction} />
          )}
        </div>
      </div>

      <UploadPortraitModal
        open={uploadPortraitOpen}
        onClose={() => setUploadPortraitOpen(false)}
        onSave={() => {
          setHasPortrait(true)
          setUploadPortraitOpen(false)
          setLastAction('Mock action: portrait saved.')
        }}
      />
      <SplitPeopleModal
        open={splitPeopleOpen}
        onClose={() => setSplitPeopleOpen(false)}
        onConfirm={(names) => {
          setSplitPeopleOpen(false)
          setLastAction(
            names.length === 1
              ? `Mock action: "${MOCK_PERSON.name}" renamed to "${names[0]}".`
              : `Mock action: "${MOCK_PERSON.name}" split into ${joinNames(names)}.`,
          )
        }}
      />
    </div>
  )
}
