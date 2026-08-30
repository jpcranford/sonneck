import { useEffect, useState } from 'react'
import type { Piece } from './pieceSplitLogic'

// Group Lane (design doc: the "Piece Length Indicator" comparison artifact)
// — a light tint fill connecting the thumbnails of one piece, so its true
// page length reads directly as the shape's own width, on top of the
// per-tile border treatment in BookUploadSplitStep.tsx/UploadBookSplitMockup.tsx
// (solid start, diagonal split at a shared/single boundary, no border for a
// plain member or a still-open piece's dashed border). Originally built
// mockup-local ("not promoted into lib/pieceSplitLogic.ts alongside
// computeLayout — this is presentational grouping, not the tested
// page-to-piece assignment itself, and the design isn't approved for the
// real component yet") — promoted here once it *was* approved and ported
// into the real BookUploadSplitStep.tsx, so both call sites share one
// implementation instead of two hand-synced copies. Kept out of
// pieceSplitLogic.ts itself (rather than merged in) since that file's own
// header comment scopes it specifically to the tested page-assignment
// algorithm — this is presentational grid/CSS math, a different kind of
// shared code.

// Matches the grid's own `grid-cols-3 sm:grid-cols-6` breakpoint exactly —
// this needs to know the *actual* column count to compute which row/column
// each page falls in, since a piece can wrap across rows differently at
// each width.
const GRID_SM_BREAKPOINT_PX = 640

export function useGridColumns(): number {
  const [columns, setColumns] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth >= GRID_SM_BREAKPOINT_PX ? 6 : 3,
  )
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${GRID_SM_BREAKPOINT_PX}px)`)
    const onChange = () => setColumns(mql.matches ? 6 : 3)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return columns
}

export interface LaneSegment {
  key: string
  row: number
  colStart: number // 0-indexed, inclusive
  colEnd: number // 0-indexed, exclusive
  color: string
  diagonalLeft: boolean
  diagonalRight: boolean
  // True when the piece on the *other* side of this segment's diagonalRight/
  // diagonalLeft boundary is a "double" middle bridge (see PageAssignments.double
  // in pieceSplitLogic.ts) rather than an ordinary shared/single neighbor —
  // i.e. this segment is A or C in an A/bridge/C trio sharing one page, not
  // one half of a plain 2-piece split. Changes where laneDiagonalMaskStyle
  // puts this segment's own cut: a plain boundary's two segments meet at the
  // shared centerline with no gap (found 2026-08-30 as the "weird
  // overlaying" bug report — see that function's own comment), but here a
  // third segment (the bridge's own narrow band) occupies that centerline,
  // so this segment's cut needs to stop at the band's *outer* edge instead,
  // leaving room for the band rather than painting through the middle of it.
  diagonalRightAdjacentToBridge: boolean
  diagonalLeftAdjacentToBridge: boolean
  // The piece this segment belongs to has more pages after/before this row
  // specifically (not a shared/single boundary with a *different* piece —
  // this is the same piece, just continuing across a row wrap). Without
  // some mark here, a lane simply stopping at the row's right edge read as
  // "this piece ends here," indistinguishable from a piece that genuinely
  // does end at the row edge by coincidence.
  wrapsToNextRow: boolean
  wrapsFromPrevRow: boolean
}

// One segment per (piece, row) — a piece wrapping onto a new row gets a
// separate segment there, same as two adjacent pieces sharing a page (a
// 'shared' or 'single' boundary) get two overlapping segments at that one
// column, each masked to its own diagonal half.
export function computeLaneSegments(pieces: Piece[], columns: number): LaneSegment[] {
  const segments: LaneSegment[] = []
  pieces.forEach((piece, i) => {
    const prevPiece = pieces[i - 1]
    const nextPiece = pieces[i + 1]
    const prevPrevPiece = pieces[i - 2]
    const nextNextPiece = pieces[i + 2]
    const diagonalLeftForPiece = !!(prevPiece && prevPiece.end === piece.start)
    const diagonalRightForPiece = !!(nextPiece && nextPiece.start === piece.end)
    // A "double" middle bridge is always a single-page piece pinched
    // between two real neighbors on the exact same page — see
    // PageAssignments.double in pieceSplitLogic.ts. Detecting it from a
    // neighboring piece's own perspective (rather than from the bridge
    // itself) is what lets this segment's own mask leave room for the
    // bridge's band instead of cutting straight through its center.
    const nextPieceIsBridge = !!(
      nextPiece &&
      nextNextPiece &&
      nextPiece.start === nextPiece.end &&
      nextNextPiece.start === nextPiece.end
    )
    const prevPieceIsBridge = !!(
      prevPiece &&
      prevPrevPiece &&
      prevPiece.start === prevPiece.end &&
      prevPrevPiece.end === prevPiece.start
    )
    let page = piece.start
    while (page <= piece.end) {
      const row = Math.floor((page - 1) / columns)
      const rowEndPage = (row + 1) * columns
      const segEnd = Math.min(piece.end, rowEndPage)
      const colStart = (page - 1) % columns
      const colEnd = colStart + (segEnd - page + 1)
      const diagonalLeft = page === piece.start && diagonalLeftForPiece
      const diagonalRight = segEnd === piece.end && diagonalRightForPiece
      segments.push({
        key: `${i}-${page}`,
        row,
        colStart,
        colEnd,
        color: piece.color,
        diagonalLeft,
        diagonalRight,
        // A segment adjacent to a bridge on *both* sides is the bridge's
        // own segment (diagonalLeft && diagonalRight already true from the
        // plain neighbor checks above) — these two flags are about a
        // *neighboring* segment's boundary, so they never apply to the
        // bridge's own segment itself, only to the ordinary pieces on
        // either side of it.
        diagonalRightAdjacentToBridge: diagonalRight && nextPieceIsBridge,
        diagonalLeftAdjacentToBridge: diagonalLeft && prevPieceIsBridge,
        wrapsToNextRow: segEnd < piece.end,
        wrapsFromPrevRow: page > piece.start,
      })
      page = segEnd + 1
    }
  })
  return segments
}

// The lane wraps both the thumbnail *and* its caption below — but it used
// to share the *exact* same footprint as the tile+caption content, edge
// for edge, which read as the lane visibly touching the thumbnail with
// zero breathing room (direct report, 2026-08-30). LANE_OUTSET_PX expands
// the lane symmetrically beyond that footprint on every side (negative
// margin, not padding — the tile+caption content itself is unchanged, the
// lane's own box just grows around it), so there's a hair of visible
// lane-background color between its own border and the thumbnail/caption
// it's wrapping.
//
// CAPTION_RESERVE_PX is the fixed (column-width-independent) vertical
// space the caption + its own top margin adds below the thumbnail — a
// 4px top margin plus a ~0.65rem line's own rendered height (~15.6px),
// measured directly rather than derived purely from the Tailwind values,
// since line-height math is easy to get subtly wrong. It's not used to
// shrink the lane (the lane still spans the caption too) — it's only
// needed by laneDiagonalMaskStyle below, to correct for the fact that
// wrapping the caption pulls the lane's own natural center down and out
// of alignment with the thumbnail's own center. See that function's own
// comment for the derivation. Depends on the caption using the exact same
// `mt-1`/`text-[0.65rem]` sizing in both call sites — if either ever
// changes its own caption styling independently, this constant (and the
// alignment it protects) needs re-deriving.
export const LANE_OUTSET_PX = 4
export const CAPTION_RESERVE_PX = 20

// `135deg` is a true geometric angle, not corner-relative — the resulting
// line has the exact same real-world slope regardless of the box's own
// aspect ratio (this is *why* mask-image replaced clip-path for this
// border in the first place). But a gradient's percentage stops are
// fractions of *that box's own* gradient-line length — and the lane's own
// box is a different shape than the tile border's (taller, by the caption
// hanging off the bottom) — so a plain "50%"/"33%"/"67%" stop on the
// lane's full box does not, in general, land on the same real-world line
// the tile border's own identically-named stop does.
//
// A first fix (2026-08-30) patched just the "50%" case with a fixed pixel
// correction (Δy·cosθ, derived from the caption's own fixed height) — it
// worked for the ordinary 2-way shared/single split, but a follow-up
// report on the 3-way "double" split ("the lane frames should match the
// border splits exactly, just like it does on the two-way split") exposed
// why that approach doesn't generalize: a fixed real-pixel correction is
// only equivalent to a percentage correction at the one stop where the
// percentage is *provably* size-independent — the 50% center, which by
// definition is a box's own literal middle regardless of its size. 33%/67%
// carry no such guarantee — they're fractions of the *tile's own* gradient
// length, and translating that into an equivalent real-pixel offset would
// need the tile's actual rendered width+height, which varies with the
// grid's column count and the page's own aspect ratio (not a fixed
// constant the way the caption's height is).
//
// The actual fix: stop trying to correct percentages via pixel math at
// all. Instead, scope each gradient layer's own `mask-size`/`mask-position`
// to exclude exactly the caption's fixed height (CAPTION_RESERVE_PX),
// anchored at the top — within that scoped sub-region, the lane's
// effective box is (up to LANE_OUTSET_PX's small, symmetric, deliberately-
// ignored contribution — see LANE_OUTSET_PX's own comment above) the same
// shape as the tile border's own box, so a literal "50%"/"33%"/"67%" stop
// inside it lands on exactly the same real-world line the tile border's
// identically-valued stop does — for *any* stop position, not just the
// one where a pixel-based correction happens to be derivable.
const CAPTION_EXCLUDED_HEIGHT = `calc(100% - ${CAPTION_RESERVE_PX}px)`

// Two layered gradients — one hard vertical cutoff covering every column
// except the diagonal one, plus a 135deg gradient sized/positioned to
// occupy only that one column (and, per the scoping above, only the
// caption-excluded portion of it) — so two adjacent lanes meeting at a
// shared/single boundary page split on the same diagonal the border does,
// instead of a plain vertical seam.
//
// An earlier version of this also force-squared (`border-*-radius: 0`)
// whichever two corners sat on a segment's diagonal side, on the theory
// that a uniformly rounded corner would produce a stray-looking sliver
// where the mask cuts through it. That reasoning doesn't actually hold for
// these boxes: each segment's own diagonal line only ever crosses its
// *left and right* edges (the line's real slope is a true 45°, and every
// lane segment here is taller than the single column-width the mask is
// scoped to), never anywhere near a corner. Squaring was therefore
// flattening corners the mask never actually touched — found 2026-08-30
// via a direct report ("the lane frame for the two 'split' statuses isn't
// rounded on the corners"), reproduced most clearly on a `single` page
// (both overlapping segments confined to one column, so the wrongly-
// squared corner was impossible to miss). Removed entirely at every call
// site — plain `rounded-[10px]` now applies uniformly, and the mask cuts
// cleanly through the already-rounded shape with no artifact.
export function laneDiagonalMaskStyle(seg: LaneSegment): React.CSSProperties {
  const totalCols = seg.colEnd - seg.colStart
  const edgeFrac = (1 / totalCols) * 100
  const restFrac = 100 - edgeFrac

  // A segment carrying *both* flags is either a genuine "finish previous
  // and split twice" middle bridge — always exactly one page/column wide,
  // the only way a single piece can be pinched between two neighbors on
  // both sides at once — or, found 2026-08-30 via a direct report
  // ("chained splits don't render the caption strip"), a genuinely
  // different case this was never designed for: a *multi-page* piece
  // chained between two *separate* ordinary shared/single boundaries (its
  // own start is one shared page, its own end a different shared page
  // later on — e.g. piece2 spans pages 8–9, page 8 shares with piece1 and
  // page 9 separately shares with piece3). That also sets both flags on
  // piece2's own segment, but stretching the bridge's narrow single-column
  // band mask across a multi-column box produces nonsense geometry — the
  // 33%/67% band, computed as if the box were one column wide, ends up a
  // sliver of a much wider box instead, which is what actually produced
  // the reported near-blank rendering. `totalCols` is what tells these two
  // apart: a genuine bridge is always exactly 1, this new case never is.
  if (seg.diagonalLeft && seg.diagonalRight && totalCols === 1) {
    // Two offset 135deg gradients, *intersected* (not added, unlike every
    // other case here) — only the region satisfying "after the left-hand
    // cut" AND "before the right-hand cut" survives, a narrow diagonal
    // band rather than a half. Stops at literal 33%/67% — matching the
    // tile border's own `prevColor 33%, middleColor 33% 67%, piece.color
    // 67%` thirds exactly, once scoped to exclude the caption the same way
    // the single-sided branches below are.
    const image =
      `linear-gradient(135deg, transparent 33%, black 33%), ` +
      `linear-gradient(135deg, black 67%, transparent 67%)`
    const size = `100% ${CAPTION_EXCLUDED_HEIGHT}, 100% ${CAPTION_EXCLUDED_HEIGHT}`
    const position = '0 0, 0 0'
    return {
      maskImage: image,
      maskSize: size,
      maskPosition: position,
      maskRepeat: 'no-repeat, no-repeat',
      maskComposite: 'intersect',
      WebkitMaskImage: image,
      WebkitMaskSize: size,
      WebkitMaskPosition: position,
      WebkitMaskRepeat: 'no-repeat, no-repeat',
      WebkitMaskComposite: 'source-in',
    }
  }

  if (seg.diagonalLeft && seg.diagonalRight) {
    // The chained multi-column case: independent cuts at each edge — the
    // exact same per-edge construction the plain single-sided branches
    // below use, including the same bridge-adjacency stop correction
    // (one end of a chained piece can still legitimately neighbor a
    // genuine single-page bridge even though this segment itself isn't
    // one) — plus a solid fill for whatever columns sit between the two
    // edges. The middle-fill layer is safe to include unconditionally: at
    // totalCols === 2 (no page truly "between" the two shared boundaries)
    // edgeFrac === restFrac, so its own visible region is zero-width and
    // contributes nothing.
    const leftStop = seg.diagonalLeftAdjacentToBridge ? '67%' : '50%'
    const rightStop = seg.diagonalRightAdjacentToBridge ? '33%' : '50%'
    const image =
      `linear-gradient(to right, transparent 0%, transparent ${edgeFrac}%, black ${edgeFrac}%, black ${restFrac}%, transparent ${restFrac}%, transparent 100%), ` +
      `linear-gradient(135deg, transparent ${leftStop}, black ${leftStop}), ` +
      `linear-gradient(135deg, black ${rightStop}, transparent ${rightStop}), ` +
      // Only the left (starting) edge needs its own caption-strip fill —
      // see the plain diagonalLeft branch below for why the right
      // (ending) edge doesn't: past that cut, the *next* piece's own
      // diagonalLeft segment claims that page's caption instead.
      `linear-gradient(to bottom, transparent 0%, transparent ${CAPTION_EXCLUDED_HEIGHT}, black ${CAPTION_EXCLUDED_HEIGHT})`
    const size = `100% 100%, ${edgeFrac}% ${CAPTION_EXCLUDED_HEIGHT}, ${edgeFrac}% ${CAPTION_EXCLUDED_HEIGHT}, ${edgeFrac}% 100%`
    const position = '0 0, 0 0, 100% 0, 0 0'
    return {
      maskImage: image,
      maskSize: size,
      maskPosition: position,
      maskRepeat: 'no-repeat, no-repeat',
      maskComposite: 'add',
      WebkitMaskImage: image,
      WebkitMaskSize: size,
      WebkitMaskPosition: position,
      WebkitMaskRepeat: 'no-repeat, no-repeat',
      WebkitMaskComposite: 'source-over',
    }
  }

  let image: string, size: string, position: string
  if (seg.diagonalRight) {
    // Ordinarily this segment's cut sits at the plain 50% centerline — the
    // exact same line the segment on the other side of an ordinary
    // shared/single boundary cuts at too, so the two meet with no gap and
    // no overlap. When the neighbor is a "double" bridge instead, that
    // centerline is occupied by the bridge's own band — this segment needs
    // to stop at 33% (the band's own outer edge, matching the tile
    // border's own `prevColor 33%` stop) so the two don't overlap through
    // the band's middle.
    const stopPercent = seg.diagonalRightAdjacentToBridge ? '33%' : '50%'
    image =
      `linear-gradient(to right, black 0%, black ${restFrac}%, transparent ${restFrac}%), ` +
      `linear-gradient(135deg, black ${stopPercent}, transparent ${stopPercent})`
    size = `100% 100%, ${edgeFrac}% ${CAPTION_EXCLUDED_HEIGHT}`
    position = '0 0, 100% 0'
  } else if (seg.diagonalLeft) {
    // Mirror of diagonalRight above: when the neighbor on this side is a
    // bridge, this segment needs to start at 67% (the band's own inner
    // edge, matching the tile border's own `piece.color 67%` stop) rather
    // than the plain 50% centerline, so it picks up exactly where the band
    // leaves off instead of overlapping it.
    const stopPercent = seg.diagonalLeftAdjacentToBridge ? '67%' : '50%'
    // The diagonal layer above is deliberately scoped to exclude the
    // caption strip (see CAPTION_EXCLUDED_HEIGHT's own comment) so its
    // percentage stop lands on the same real line the tile border's own
    // stop does — but that scoping leaves the caption strip with *no*
    // coverage from that layer at all, and unlike diagonalRight (below),
    // where "no coverage there" happens to already be the right answer
    // (past the cut, this piece's own color naturally gives way — nothing
    // needs to paint that region), diagonalLeft is the piece *starting* at
    // this boundary: by the time the real diagonal line has exited through
    // the column's side edge (always happens well within the thumbnail's
    // own height, never crossing the bottom — see the note above this
    // function), every remaining pixel below that, all the way through the
    // caption, is unambiguously on this piece's own "after the cut, now
    // visible" side. A third solid-fill layer restores that — plain full
    // visibility across the edge column's own caption-height strip, no
    // diagonal needed there since the line has already fully resolved by
    // that point. Found 2026-08-30, same day as the alignment fix that
    // introduced this regression: reported directly as "the bottom of the
    // lane frame doesn't render."
    const captionFill = `linear-gradient(to bottom, transparent 0%, transparent ${CAPTION_EXCLUDED_HEIGHT}, black ${CAPTION_EXCLUDED_HEIGHT})`
    image =
      `linear-gradient(to right, transparent 0%, transparent ${edgeFrac}%, black ${edgeFrac}%), ` +
      `linear-gradient(135deg, transparent ${stopPercent}, black ${stopPercent}), ` +
      captionFill
    size = `100% 100%, ${edgeFrac}% ${CAPTION_EXCLUDED_HEIGHT}, ${edgeFrac}% 100%`
    position = '0 0, 0 0, 0 0'
  } else {
    return {}
  }
  return {
    maskImage: image,
    maskSize: size,
    maskPosition: position,
    maskRepeat: 'no-repeat, no-repeat',
    maskComposite: 'add',
    WebkitMaskImage: image,
    WebkitMaskSize: size,
    WebkitMaskPosition: position,
    WebkitMaskRepeat: 'no-repeat, no-repeat',
    WebkitMaskComposite: 'source-over',
  }
}
