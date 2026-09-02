-- +goose Up
-- Adds book_title to pieces_fts/pieces_fts_trigram (CLAUDE.md > Search) so
-- the Piece Library's free-text search also matches a piece's source
-- book's title, not just the piece's own fields — searching a book's own
-- name (e.g. "Off the Record") previously found none of its pieces.
--
-- Drop-and-recreate, not ALTER TABLE ADD COLUMN: confirmed directly
-- against this project's actual pinned driver (modernc.org/sqlite v1.56.0,
-- a real throwaway test, not assumed from general SQLite docs) that FTS5
-- virtual tables reject ALTER TABLE entirely here ("virtual tables may not
-- be altered") — later SQLite versions do support ALTER TABLE ADD COLUMN
-- on FTS5 tables, but this driver's bundled version doesn't. Both tables
-- are already documented as safely droppable/rebuildable derived data
-- (design doc §3, migration 00005's own comment), so this is the
-- sanctioned way to change their schema — the same reason migration 00019
-- introduced the whole second (trigram) table rather than altering the
-- first, not a new exception.
--
-- Existing indexed pieces get an empty book_title until their next
-- write-triggered resync or a `rebuild-search-index` CLI run — same
-- one-time-backfill situation migration 00019's own trigram table
-- introduction left behind (CLAUDE.md > Search's own note on that).
DROP TABLE pieces_fts;
CREATE VIRTUAL TABLE pieces_fts USING fts5(
    piece_id UNINDEXED,
    title,
    composer,
    arranger,
    publisher,
    publisher_id,
    imslp_number,
    year_written,
    work_opus_number,
    description,
    user_notes,
    key_name,
    sheet_type_name,
    instruments,
    user_tags,
    book_title
);

DROP TABLE pieces_fts_trigram;
CREATE VIRTUAL TABLE pieces_fts_trigram USING fts5(
    piece_id UNINDEXED,
    title,
    composer,
    arranger,
    publisher,
    publisher_id,
    imslp_number,
    year_written,
    work_opus_number,
    description,
    user_notes,
    key_name,
    sheet_type_name,
    instruments,
    user_tags,
    book_title,
    tokenize = 'trigram'
);

-- +goose Down
DROP TABLE pieces_fts;
CREATE VIRTUAL TABLE pieces_fts USING fts5(
    piece_id UNINDEXED,
    title,
    composer,
    arranger,
    publisher,
    publisher_id,
    imslp_number,
    year_written,
    work_opus_number,
    description,
    user_notes,
    key_name,
    sheet_type_name,
    instruments,
    user_tags
);

DROP TABLE pieces_fts_trigram;
CREATE VIRTUAL TABLE pieces_fts_trigram USING fts5(
    piece_id UNINDEXED,
    title,
    composer,
    arranger,
    publisher,
    publisher_id,
    imslp_number,
    year_written,
    work_opus_number,
    description,
    user_notes,
    key_name,
    sheet_type_name,
    instruments,
    user_tags,
    tokenize = 'trigram'
);
