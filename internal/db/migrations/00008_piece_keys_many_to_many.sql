-- +goose Up
-- Key becomes many-to-many (a piece can genuinely be written in more than
-- one key — e.g. a piece that modulates, or a medley) — same shape as
-- piece_instruments/piece_user_tags (00004), not a special case.
CREATE TABLE piece_keys (
    piece_id INTEGER NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
    key_id INTEGER NOT NULL REFERENCES musical_keys(id) ON DELETE CASCADE,
    PRIMARY KEY (piece_id, key_id)
);

-- Carry forward every existing single-key assignment before the column
-- that held it goes away.
INSERT INTO piece_keys (piece_id, key_id)
SELECT id, key_id FROM pieces WHERE key_id IS NOT NULL;

DROP INDEX idx_pieces_key_id;
ALTER TABLE pieces DROP COLUMN key_id;

-- +goose Down
-- Lossy: a piece with more than one key collapses to its lowest key_id —
-- there's no single-valued column to restore the full set into.
ALTER TABLE pieces ADD COLUMN key_id INTEGER REFERENCES musical_keys(id);
UPDATE pieces SET key_id = (
    SELECT MIN(key_id) FROM piece_keys WHERE piece_keys.piece_id = pieces.id
);
CREATE INDEX idx_pieces_key_id ON pieces(key_id);
DROP TABLE piece_keys;
