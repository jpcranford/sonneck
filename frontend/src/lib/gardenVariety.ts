// Garden Variety: the app's ten-color set, as fixed hex values. Used where a
// color is a solid fill under white initials or icons (person avatars, book
// credit circles), which has to look the same in both themes. The upload
// wizard's book-split colors start from the same ten but are theme tokens
// (--color-split-1…10 in index.css; lib/pieceSplitLogic.ts's PALETTE), so
// the dark theme can brighten them.
export const GARDEN_VARIETY = [
  '#7a9c6b',
  '#b87aaf',
  '#5c8a8a',
  '#b8935a',
  '#9c7ab8',
  '#b8827a',
  '#6b8a9c',
  '#87a249',
  '#ac6939',
  '#b87a97',
]
