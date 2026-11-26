// The details pages' toolbar buttons at phone width (under 768px): Piece,
// Book, Person and Setlist Details' top row, Piece and Setlist Details'
// second row (Play, Play Set, the downloads) and Edit Program. Their 38px
// buttons with 16px icons read small on a phone, so there they grow to 44px,
// with 20px icons and 16px labels (option A of
// https://claude.ai/artifact/Qt8ABm3BTmUPvGJVNTwUQi). Back keeps its size.
// The 48×48 tap areas (components/HitArea.tsx) are unchanged. Each button
// sizes its own icon (`[&>svg]`), so icons keep their desktop size prop.
// Shared by the real pages and their mockups.

/** An icon-only button: 44×44. */
export const PHONE_SQUARE_BUTTON = 'max-md:size-11 max-md:[&>svg]:size-5'
/** A labeled button: 44px tall, 16px label. */
export const PHONE_BUTTON = 'max-md:h-11 max-md:text-base max-md:[&>svg]:size-5'
/** A split button's caret, as tall as the button beside it. */
export const PHONE_CARET = 'max-md:[&>svg]:size-5'
