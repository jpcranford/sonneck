-- +goose NO TRANSACTION
-- Required by the two PRAGMA foreign_keys toggles below — SQLite refuses to
-- change that pragma while a transaction is open, and goose wraps a plain
-- migration's Up/Down in one transaction unless told not to. The tradeoff
-- (no automatic rollback if a later statement in this file fails) is
-- accepted deliberately: see the foreign_keys comment below for why the
-- toggle itself is non-negotiable. Applies to both Up and Down.

-- +goose Up
-- Multi-user support, Phase 10 of the plan (memory project_multiuser_build.md,
-- precious-kindling-pretzel.md's "Data model" section) — real per-user data
-- scoping and permissions. Builds on migration 00024's users/server_settings
-- (Phase 3), which deliberately left all of this for later. No OIDC yet
-- (Phase 14) — oidc_subject and the rest of the OIDC-specific surface are
-- added when that phase actually wires up login, not pre-built here.
--
-- IMPORTANT — DROP TABLE + foreign_keys(1) + ON DELETE CASCADE gotcha
-- (found the hard way, 2026-09-08, memory feedback_migration_fk_cascade_wipe.md):
-- internal/db/db.go sets `_pragma=foreign_keys(1)` on every connection.
-- With that pragma on, SQLite's DROP TABLE performs an implicit DELETE FROM
-- every row of the table being dropped before removing it — and that
-- implicit delete genuinely fires ON DELETE CASCADE on every OTHER table
-- referencing it, even though DROP TABLE is schema DDL, not an application
-- DELETE. This migration rebuilds both `user_tags` and `pieces` (the usual
-- CREATE ..._new / copy / DROP / RENAME pattern, needed because SQLite
-- can't ALTER a UNIQUE constraint or DROP a CHECK-constrained column in
-- place) — and both are parents of several other tables via ON DELETE
-- CASCADE. Dropping either one un-bracketed would silently wipe every
-- child row for every piece in the library: piece_composers,
-- piece_arrangers, piece_keys, piece_instruments, piece_user_tags, plus
-- this same migration's own freshly-backfilled piece_favorites/
-- piece_practice_status/piece_user_notes. It did exactly that against the
-- real dev library the first time this migration shipped — see memory
-- project_multiuser_build.md's recovery section for the incident. Fix:
-- bracket each rebuild's DROP TABLE in PRAGMA foreign_keys = OFF / ON,
-- which requires the NO TRANSACTION directive above.

CREATE TABLE user_permissions (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission TEXT NOT NULL CHECK (permission IN
        ('read', 'download', 'practice', 'edit', 'upload', 'create', 'delete', 'admin')),
    PRIMARY KEY (user_id, permission)
);

-- id=1 (the seeded local admin from migration 00024) gets every permission,
-- so an existing single-user install keeps working exactly as before the
-- instant this migration runs — nothing was gated before, nothing should
-- feel gated immediately after.
INSERT INTO user_permissions (user_id, permission)
SELECT 1, p.permission FROM (
    SELECT 'read' AS permission UNION ALL SELECT 'download' UNION ALL
    SELECT 'practice' UNION ALL SELECT 'edit' UNION ALL SELECT 'upload' UNION ALL
    SELECT 'create' UNION ALL SELECT 'delete' UNION ALL SELECT 'admin'
) p;

CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);

-- Per-user, per-piece data that used to be flat columns on pieces
-- (favorite/practice_status/user_notes) or a shared lookup (user_tags).
-- Backfilled below, attributing every existing value to user_id=1, before
-- the source columns are dropped from pieces further down.
CREATE TABLE piece_favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    piece_id INTEGER NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, piece_id)
);
INSERT INTO piece_favorites (user_id, piece_id)
SELECT 1, id FROM pieces WHERE favorite = 1;

-- Practice Status became a real, per-user-renameable/creatable lookup
-- (same shape as user_tags) rather than a fixed enum, per direct feedback
-- during the Phase 8 mockup — see precious-kindling-pretzel.md's Data
-- model section for the plain CHECK-enum design this replaces (kept there,
-- commented, for the historical record).
CREATE TABLE practice_statuses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    UNIQUE (owner_user_id, name)
);
INSERT INTO practice_statuses (owner_user_id, name)
SELECT 1, name FROM (
    SELECT 'Want to Learn' AS name UNION ALL SELECT 'Learning' UNION ALL
    SELECT 'Learned' UNION ALL SELECT 'Stalled' UNION ALL SELECT 'Dropped'
);

CREATE TABLE piece_practice_status (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    piece_id INTEGER NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
    status_id INTEGER NOT NULL REFERENCES practice_statuses(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, piece_id)
);
INSERT INTO piece_practice_status (user_id, piece_id, status_id)
SELECT 1, p.id, ps.id
FROM pieces p JOIN practice_statuses ps ON ps.owner_user_id = 1 AND ps.name = p.practice_status
WHERE p.practice_status IS NOT NULL;

CREATE TABLE piece_user_notes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    piece_id INTEGER NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
    notes TEXT NOT NULL,
    PRIMARY KEY (user_id, piece_id)
);
INSERT INTO piece_user_notes (user_id, piece_id, notes)
SELECT 1, id, user_notes FROM pieces WHERE user_notes IS NOT NULL AND user_notes != '';

-- user_tags becomes a private per-user vocabulary (CLAUDE.md > Concurrency's
-- own forward note) — every existing tag attributed to user_id=1, the only
-- user that could have created any of them before this migration. A plain
-- ALTER TABLE ADD COLUMN isn't enough here: the table's original single-
-- column `name TEXT NOT NULL UNIQUE` (migration 00004) stays in force
-- alongside the new column, which would still block two different users
-- from ever using the same tag name — the exact bug this migration exists
-- to fix. Rebuilt (same create-new/copy/drop/rename pattern migration
-- 00012 already used) so the UNIQUE constraint becomes scoped to
-- (owner_user_id, name) instead, matching practice_statuses' own shape.
CREATE TABLE user_tags_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    UNIQUE (owner_user_id, name)
);
INSERT INTO user_tags_new (id, owner_user_id, name)
SELECT id, 1, name FROM user_tags;
PRAGMA foreign_keys = OFF;
DROP TABLE user_tags;
ALTER TABLE user_tags_new RENAME TO user_tags;
PRAGMA foreign_keys = ON;

-- Structured, admin-screen-visible user settings — a small fixed set, one
-- column each. The silent per-page grid/list view-mode memory is
-- deliberately NOT here (frontend localStorage, per device, per the plan's
-- own "Frontend surfaces" section).
CREATE TABLE user_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    show_books_in_sidebar INTEGER NOT NULL DEFAULT 1,
    theme_preference TEXT NOT NULL DEFAULT 'system' CHECK (theme_preference IN ('light', 'dark', 'system')),
    -- 'infinite' default confirmed correct 2026-09-08 against the real,
    -- already-shipped PieceBrowseView.tsx (useInfiniteQuery + an
    -- IntersectionObserver sentinel, unconditionally) — see
    -- precious-kindling-pretzel.md's Data model section for the audit that
    -- caught the original draft defaulting this to 'paginated', which was
    -- simply wrong.
    content_view_mode TEXT NOT NULL DEFAULT 'infinite' CHECK (content_view_mode IN ('paginated', 'infinite'))
);
INSERT INTO user_settings (user_id) VALUES (1);

-- pieces.favorite/practice_status/user_notes are replaced by the per-user
-- tables above, not just superseded by a parallel new one (per-user data
-- can't be expressed as a single global column at all) — so there's no
-- backfill-then-drop-later window to protect, unlike the People overhaul's
-- deliberately-deferred composer/arranger TEXT columns. Backfill above
-- already ran while these columns still existed; SQLite can't DROP COLUMN
-- a column that carries its own CHECK constraint (practice_status) or that
-- other columns don't reference, so the whole table is rebuilt instead —
-- same pattern migration 00012 already used for piece_keys.
CREATE TABLE pieces_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    composer TEXT,
    arranger TEXT,
    work_opus_number TEXT,
    sheet_type_id INTEGER REFERENCES sheet_types(id),
    publisher TEXT,
    publisher_id TEXT,
    year_written TEXT,
    description TEXT,
    imslp_number TEXT,
    source_book_id INTEGER REFERENCES books(id),
    source_page_start INTEGER,
    source_page_end INTEGER,
    duration INTEGER,
    bpm INTEGER,
    measure_count INTEGER,
    beats_per_measure INTEGER,
    file_path TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    copyright_year INTEGER,
    public_domain INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    page_count INTEGER NOT NULL DEFAULT 1,
    thumbnail_page INTEGER NOT NULL DEFAULT 1,
    copyright_holder TEXT,
    copyright_slug TEXT,
    copyright_status TEXT CHECK (copyright_status IN ('publicDomain', 'copyleft', 'likelyPublicDomain', 'inCopyright')),
    copyright_renewed INTEGER
);

INSERT INTO pieces_new (
    id, title, composer, arranger, work_opus_number, sheet_type_id, publisher,
    publisher_id, year_written, description, imslp_number, source_book_id,
    source_page_start, source_page_end, duration, bpm, measure_count,
    beats_per_measure, file_path, file_hash, copyright_year, public_domain,
    created_at, updated_at, page_count, thumbnail_page, copyright_holder,
    copyright_slug, copyright_status, copyright_renewed
)
SELECT
    id, title, composer, arranger, work_opus_number, sheet_type_id, publisher,
    publisher_id, year_written, description, imslp_number, source_book_id,
    source_page_start, source_page_end, duration, bpm, measure_count,
    beats_per_measure, file_path, file_hash, copyright_year, public_domain,
    created_at, updated_at, page_count, thumbnail_page, copyright_holder,
    copyright_slug, copyright_status, copyright_renewed
FROM pieces;

PRAGMA foreign_keys = OFF;
DROP TABLE pieces;
ALTER TABLE pieces_new RENAME TO pieces;
PRAGMA foreign_keys = ON;

CREATE INDEX idx_pieces_source_book_id ON pieces(source_book_id);
CREATE INDEX idx_pieces_sheet_type_id ON pieces(sheet_type_id);

-- pieces_fts/pieces_fts_trigram don't index favorite/practice_status/
-- user_notes (CLAUDE.md > Search — only book-inheritable + tag fields are
-- indexed) and sync is application-level, not SQL triggers, so no FTS
-- rebuild is needed here.
--
-- No inline PRAGMA foreign_key_check here: goose's raw-SQL runner execs
-- each statement and discards any result set, so a bare foreign_key_check
-- can't actually fail the migration even if it finds a violation — there's
-- no procedural way to branch on it without converting this to a Go
-- migration, disproportionate for this fix. The real, enforcing guard is
-- the new internal/db/migration_safety_test.go (CLAUDE.md > Database
-- migrations), which seeds real relational data before migrating forward
-- and asserts every FK-child table's row count is preserved.

-- +goose Down
-- Lossy by necessity, same reasoning as every other collapse-many-back-to-
-- one down migration in this project (e.g. 00012's own Down): only
-- user_id=1's data survives the round-trip, since a flat column can't
-- represent more than one user's value.
ALTER TABLE pieces ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pieces ADD COLUMN practice_status TEXT
    CHECK (practice_status IN ('Want to Learn', 'Learning', 'Learned', 'Stalled', 'Dropped'));
ALTER TABLE pieces ADD COLUMN user_notes TEXT;

UPDATE pieces SET favorite = 1
    WHERE id IN (SELECT piece_id FROM piece_favorites WHERE user_id = 1);
UPDATE pieces SET practice_status = (
    SELECT ps.name FROM piece_practice_status pps
    JOIN practice_statuses ps ON ps.id = pps.status_id
    WHERE pps.piece_id = pieces.id AND pps.user_id = 1
);
UPDATE pieces SET user_notes = (
    SELECT notes FROM piece_user_notes WHERE piece_id = pieces.id AND user_id = 1
);

DROP TABLE user_settings;

CREATE TABLE user_tags_old (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);
INSERT INTO user_tags_old (id, name) SELECT id, name FROM user_tags;
-- Same DROP TABLE + foreign_keys(1) + ON DELETE CASCADE gotcha as the Up
-- direction's own rebuilds (see this file's header comment) — piece_user_tags
-- references user_tags(id) ON DELETE CASCADE and would otherwise be wiped.
PRAGMA foreign_keys = OFF;
DROP TABLE user_tags;
ALTER TABLE user_tags_old RENAME TO user_tags;
PRAGMA foreign_keys = ON;

DROP TABLE piece_user_notes;
DROP TABLE piece_practice_status;
DROP TABLE practice_statuses;
DROP TABLE piece_favorites;
DROP TABLE sessions;
DROP TABLE user_permissions;
