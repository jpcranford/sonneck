-- +goose Up
-- Composer/arranger overhaul (Phases 1-5 approved, this is the real build):
-- Piece.composer/arranger and Book.composer/arranger move from plain
-- strings to an ordered many-to-many relationship to a new Person entity —
-- see CLAUDE.md's own "People / Composer & Arranger" section and memory
-- project_people_composer_overhaul.md for the full design history.
--
-- Additive only. pieces.composer/arranger and books.composer/arranger are
-- deliberately NOT dropped here — they stay in place, unused by application
-- code from this point on, until the one-shot `migrate-people` CLI
-- backfill (cmd/sonneck) has actually been run against real data and
-- spot-checked. Goose runs every pending migration automatically on
-- startup with no pause for a manual step in between, so a column-drop
-- migration must never ship in the same deploy as this one — see the old
-- string columns' own removal, a separate future migration, once that
-- backfill is confirmed.
CREATE TABLE people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    bio TEXT,
    birth_year INTEGER,
    death_year INTEGER,
    -- Mirrors books.cover_image_hash/cover_image_content_type (migration
    -- 00018) exactly — a manually uploaded portrait, content-addressed on
    -- disk, both nil together meaning "no custom portrait" (falls back to
    -- an initials/bust placeholder, same as Book's own no-cover fallback).
    portrait_image_hash TEXT,
    portrait_image_content_type TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Four tables, not two with a role column: EditPieceModal/EditBookModal
-- already have fully separate Composer/Arranger fields (design doc §15/
-- §16), and each table stays exactly as simple as piece_keys' own original
-- shape (migration 00008) — no role filtering ever needed in a query.
-- Position is a plain 0-indexed insertion-order integer; unlike piece_keys
-- (migration 00012), a person is never credited twice in the same role on
-- the same work, so there's no need for piece_keys' own repeat-value PK
-- trick — PRIMARY KEY (piece_id, person_id) is sufficient and simpler.
CREATE TABLE piece_composers (
    piece_id INTEGER NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (piece_id, person_id)
);

CREATE TABLE piece_arrangers (
    piece_id INTEGER NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (piece_id, person_id)
);

CREATE TABLE book_composers (
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (book_id, person_id)
);

CREATE TABLE book_arrangers (
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (book_id, person_id)
);

-- +goose Down
DROP TABLE book_arrangers;
DROP TABLE book_composers;
DROP TABLE piece_arrangers;
DROP TABLE piece_composers;
DROP TABLE people;
