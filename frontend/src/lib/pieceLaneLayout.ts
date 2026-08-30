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
    const diagonalLeftForPiece = !!(prevPiece && prevPiece.end === piece.start)
    const diagonalRightForPiece = !!(nextPiece && nextPiece.start === piece.end)
    let page = piece.start
    while (page <= piece.end) {
      const row = Math.floor((page - 1) / columns)
      const rowEndPage = (row + 1) * columns
      const segEnd = Math.min(piece.end, rowEndPage)
      const colStart = (page - 1) % columns
      const colEnd = colStart + (segEnd - page + 1)
      segments.push({
        key: `${i}-${page}`,
        row,
        colStart,
        colEnd,
        color: piece.color,
        diagonalLeft: page === piece.start && diagonalLeftForPiece,
        diagonalRight: segEnd === piece.end && diagonalRightForPiece,
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

// Depends on a correction baked into the 135deg stop position below to
// still align with the thumbnail's own diagonal (found + fixed
// 2026-08-30, direct screenshot report: "the diagonal cut no longer lines
// up with the thumb border's diagonal," after the lane grew taller to
// wrap the caption row too). `135deg` is a true geometric angle, not
// corner-relative — the resulting line has the exact same real-world
// slope regardless of the box's own aspect ratio (this is *why*
// mask-image replaced clip-path for this border in the first place) — but
// a gradient's default "50%" stop is centered on the box's own geometric
// center, and the lane's own center is no longer the thumbnail's own
// center once the lane wraps a caption hanging off just the bottom (an
// asymmetric addition, unlike LANE_OUTSET_PX above, which is symmetric on
// every side and so doesn't itself move the center at all).
//
// DIAGONAL_SHIFT_PX corrects for exactly that asymmetric offset, derived
// rather than tuned by eye: for any linear-gradient at a fixed angle θ,
// the gradient line's total length is L = |W·sinθ| + |H·cosθ| (the
// standard CSS formula), and moving a point straight down by real pixels
// Δy shifts its position along that line by Δy·cosθ (the projection of a
// pure-vertical displacement onto the line's own direction). At exactly
// θ=135°, sin135°=cos135°=1/√2, so those two facts combine cleanly: the
// W/H terms cancel out of the ratio entirely, leaving a shift that's a
// fixed pixel offset independent of the box's actual rendered size —
// `calc(50% - Xpx)` where X = Δy/√2, and Δy is CAPTION_RESERVE_PX/2 (half
// of the fixed vertical weight the caption adds below the thumbnail,
// which is exactly how far it pulls the lane's own center down from the
// thumbnail's). This is why it's safe as a plain constant rather than
// something computed per-render from actual measured box dimensions.
const DIAGONAL_SHIFT_PX = (CAPTION_RESERVE_PX / 2) * Math.SQRT1_2

// Two layered gradients — one hard vertical cutoff covering every column
// except the diagonal one, plus a 135deg gradient sized/positioned to
// occupy only that one column — so two adjacent lanes meeting at a
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
// scoped to — see DIAGONAL_SHIFT_PX's own derivation for why the box used
// for this is always one column wide regardless of how many columns the
// segment visually spans), never anywhere near a corner. Squaring was
// therefore flattening corners the mask never actually touched — found
// 2026-08-30 via a direct report ("the lane frame for the two 'split'
// statuses isn't rounded on the corners"), reproduced most clearly on a
// `single` page (both overlapping segments confined to one column, so the
// wrongly-squared corner was impossible to miss). Removed entirely at
// every call site — plain `rounded-[10px]` now applies uniformly, and the
// mask cuts cleanly through the already-rounded shape with no artifact.
export function laneDiagonalMaskStyle(seg: LaneSegment): React.CSSProperties {
  const totalCols = seg.colEnd - seg.colStart
  const edgeFrac = (1 / totalCols) * 100
  const restFrac = 100 - edgeFrac
  const stop = `calc(50% - ${DIAGONAL_SHIFT_PX}px)`
  let image: string, size: string, position: string
  if (seg.diagonalRight) {
    image =
      `linear-gradient(to right, black 0%, black ${restFrac}%, transparent ${restFrac}%), ` +
      `linear-gradient(135deg, black ${stop}, transparent ${stop})`
    size = `100% 100%, ${edgeFrac}% 100%`
    position = '0 0, 100% 0'
  } else if (seg.diagonalLeft) {
    image =
      `linear-gradient(to right, transparent 0%, transparent ${edgeFrac}%, black ${edgeFrac}%), ` +
      `linear-gradient(135deg, transparent ${stop}, black ${stop})`
    size = `100% 100%, ${edgeFrac}% 100%`
    position = '0 0, 0 0'
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
