-- +goose Up
-- Public Domain Badge feature (design doc §13) — see the design artifact
-- (memory project_public_domain_badge.md has the URL) for the full spec.

-- Book.yearWritten is renamed to yearPublished: same column, same
-- inheritance behavior (still settable in Edit Book, still inherited by
-- pieces' own Year Written) — relabeled because it's genuinely when the
-- *edition* was published, not when the piece was composed. RENAME COLUMN
-- is supported on ordinary tables by this project's pinned SQLite driver
-- (confirmed via go test — this is NOT the same restriction migration
-- 00019 hit on FTS5 virtual tables, which really don't support ALTER TABLE
-- at all).
ALTER TABLE books RENAME COLUMN year_written TO year_published;

ALTER TABLE books ADD COLUMN copyright_year INTEGER;

-- One-time backfill: copy the (now-renamed) year_published value into the
-- new copyright_year column, but ONLY when it's an unambiguous 4-digit
-- year — year_published is free text (design doc §3) and can legitimately
-- hold something like "ca. 1848" or "1708-1711", which can't be losslessly
-- copied into an INTEGER column. Anything not exactly 4 digits is left
-- NULL rather than guessed at, matching this app's general "never guess,
-- omit instead" convention. After this, the two columns are fully
-- independent (CLAUDE.md > Database migrations).
UPDATE books SET copyright_year = CAST(year_published AS INTEGER)
    WHERE year_published GLOB '[0-9][0-9][0-9][0-9]';

ALTER TABLE books ADD COLUMN copyright_holder TEXT;
ALTER TABLE books ADD COLUMN copyright_slug TEXT;
ALTER TABLE books ADD COLUMN copyright_status TEXT
    CHECK (copyright_status IN ('publicDomain', 'copyleft', 'likelyPublicDomain', 'inCopyright'));

-- Piece.copyrightYear already exists (pre-built, unused — see migration
-- 00003's own comment) and needs no schema change to become
-- book-inheritable; only these three are new. Piece.publicDomain (the
-- other pre-built column) stays in the schema unused — a plain
-- non-nullable bool can't represent a real four-way choice or "unset," so
-- it's superseded by copyright_status below rather than reused, same
-- "leave the old column, don't drop it yet" treatment migration 00020 gave
-- the old composer/arranger TEXT columns.
ALTER TABLE pieces ADD COLUMN copyright_holder TEXT;
ALTER TABLE pieces ADD COLUMN copyright_slug TEXT;
ALTER TABLE pieces ADD COLUMN copyright_status TEXT
    CHECK (copyright_status IN ('publicDomain', 'copyleft', 'likelyPublicDomain', 'inCopyright'));

-- +goose Down
-- Lossy by necessity for the four new columns' own data (same as any
-- down migration removing newly-added columns) — the rename itself is
-- fully reversible.
ALTER TABLE pieces DROP COLUMN copyright_status;
ALTER TABLE pieces DROP COLUMN copyright_slug;
ALTER TABLE pieces DROP COLUMN copyright_holder;

ALTER TABLE books DROP COLUMN copyright_status;
ALTER TABLE books DROP COLUMN copyright_slug;
ALTER TABLE books DROP COLUMN copyright_holder;
ALTER TABLE books DROP COLUMN copyright_year;

ALTER TABLE books RENAME COLUMN year_published TO year_written;
