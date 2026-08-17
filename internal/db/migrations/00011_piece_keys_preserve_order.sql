-- +goose Up
-- A piece's keys need to display in the order the user selected them, not
-- an alphabetical/chromatic one — piece_keys previously had no ordering
-- concept at all (just a plain (piece_id, key_id) pair), so
-- getPieceKeyIDs fell back to `ORDER BY key_id`, silently reshuffling
-- multi-key pieces away from whatever order they were actually entered
-- in. This is a genuinely different axis from musical_keys.sort_order
-- (00010) — that one orders the *lookup list* chromatically for the
-- picker dropdown; this one preserves *this specific piece's* selection
-- order, which has nothing to do with chromatic pitch order.
ALTER TABLE piece_keys ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

-- Backfill: there's no record of the original entry order for existing
-- rows, so this assigns a deterministic (by key_id) position per piece —
-- a reasonable default, not a reconstruction of history. Only affects
-- pieces that already had more than one key before this migration.
UPDATE piece_keys
SET position = (
  SELECT COUNT(*) FROM piece_keys pk2
  WHERE pk2.piece_id = piece_keys.piece_id AND pk2.key_id < piece_keys.key_id
);

-- +goose Down
ALTER TABLE piece_keys DROP COLUMN position;
