-- +goose Up
-- Keys were previously constrained to at most one row per (piece_id,
-- key_id) — PRIMARY KEY (piece_id, key_id), migration 00008. That blocks a
-- real case: a piece that modulates back to a key it already used (e.g.
-- C major -> G major -> C major) needs that key to appear twice in its
-- key sequence, not just once. SQLite can't ALTER a PRIMARY KEY in place,
-- so the table is recreated with PRIMARY KEY (piece_id, position) instead
-- — position (added 00011) already uniquely identifies a piece's key rows
-- the way SetPieceKeys writes them (delete-all then reinsert 0..n-1), so
-- this is the natural replacement key, not an arbitrary surrogate.
CREATE TABLE piece_keys_new (
    piece_id INTEGER NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
    key_id INTEGER NOT NULL REFERENCES musical_keys(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (piece_id, position)
);

INSERT INTO piece_keys_new (piece_id, key_id, position)
SELECT piece_id, key_id, position FROM piece_keys;

DROP TABLE piece_keys;
ALTER TABLE piece_keys_new RENAME TO piece_keys;

-- +goose Down
-- Lossy by necessity, same as 00008/00010's own down migrations: if any
-- piece actually used a repeated key (the entire point of this
-- migration), collapsing back to PRIMARY KEY (piece_id, key_id) can only
-- keep one row per (piece_id, key_id) — the earliest position wins.
CREATE TABLE piece_keys_old (
    piece_id INTEGER NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
    key_id INTEGER NOT NULL REFERENCES musical_keys(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (piece_id, key_id)
);

INSERT INTO piece_keys_old (piece_id, key_id, position)
SELECT piece_id, key_id, MIN(position) FROM piece_keys GROUP BY piece_id, key_id;

DROP TABLE piece_keys;
ALTER TABLE piece_keys_old RENAME TO piece_keys;
