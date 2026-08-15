-- +goose Up
-- Denormalized search index (design doc §3/§11). Not a source of truth --
-- safe to drop and rebuild from pieces/books/tag tables at any time.
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

-- +goose Down
DROP TABLE pieces_fts;
