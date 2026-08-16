-- +goose Up
-- Design doc §14 addition, not in the original spec: lets the user
-- manually pick which rendered page becomes this piece's Library card
-- thumbnail, instead of always defaulting to page 1. DEFAULT 1 matches
-- page_count's own migration (00006) reasoning — every existing/new piece
-- has at least page 1, so it's a safe fallback for pre-existing rows.
ALTER TABLE pieces ADD COLUMN thumbnail_page INTEGER NOT NULL DEFAULT 1;

-- +goose Down
ALTER TABLE pieces DROP COLUMN thumbnail_page;
