-- +goose Up
-- Setlists (design doc §13, precious-kindling-pretzel.md's own "Data
-- model" section) — the first and only real consumer of the `create`
-- permission (migration 00025), which has sat reserved-but-unused since
-- multi-user support shipped. Pure CREATE TABLE, nothing to rebuild — no
-- NO TRANSACTION / PRAGMA foreign_keys bracket needed (that gotcha, see
-- migration 00025's own header, only applies to a rebuild of a table
-- something else already references via ON DELETE CASCADE; both tables
-- here are brand new).
--
-- Ownership mirrors user_tags/practice_statuses exactly (owner_user_id,
-- CASCADE on the owning user's deletion) — in none/singlepass mode
-- everything belongs to id=1, same as everywhere else in the app.
CREATE TABLE setlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    gig_date TEXT,
    description TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- "setlist_entries," not "setlist_pieces" — an entry is either a real
-- piece reference or a freeform custom row (announcements, an offering,
-- walk-in music — decision 5). Exactly one of piece_id/custom_name is set,
-- enforced by the CHECK below rather than trusted to application code
-- alone. A surrogate `id` PK (not a composite key on piece_id) is what
-- lets the same piece repeat within one setlist (a reprised
-- piece/encore — decision 4) and, since piece_id carries no uniqueness
-- constraint of its own, what lets one piece belong to any number of
-- different setlists at once too.
CREATE TABLE setlist_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setlist_id INTEGER NOT NULL REFERENCES setlists(id) ON DELETE CASCADE,
    piece_id INTEGER REFERENCES pieces(id) ON DELETE CASCADE,
    custom_name TEXT,
    custom_duration_seconds INTEGER,
    custom_notes TEXT,
    custom_counts_as_music INTEGER NOT NULL DEFAULT 0,
    role TEXT,
    sort_order INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        (piece_id IS NOT NULL AND custom_name IS NULL)
        OR
        (piece_id IS NULL AND custom_name IS NOT NULL)
    )
);
CREATE INDEX idx_setlist_entries_setlist_id ON setlist_entries(setlist_id);

-- +goose Down
DROP TABLE setlist_entries;
DROP TABLE setlists;
