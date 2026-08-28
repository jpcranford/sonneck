-- +goose Up
-- Trigram shadow index (CLAUDE.md > Search) — a second, separately
-- maintained FTS5 table alongside pieces_fts, not a replacement. pieces_fts
-- (unicode61 tokenizer + a trailing `*` per query token, see
-- sanitizeFTSQuery) does prefix matching: a still-being-typed word matches,
-- but only from its start. This table's tokenize='trigram' matches a query
-- string anywhere inside a word (e.g. "crack" finds "Nutcracker"), at the
-- cost of noisier/less-ranked results for short queries — so it's queried
-- only as a fallback when the primary pieces_fts query finds nothing, not
-- as the primary search path. Same column shape as pieces_fts, kept in sync
-- by the same repo.ResyncSearchIndex call (one INSERT into each table) —
-- derived data, same "safe to drop and rebuild" status as pieces_fts
-- itself.
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

-- +goose Down
DROP TABLE pieces_fts_trigram;
