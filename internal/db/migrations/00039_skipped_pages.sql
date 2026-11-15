-- +goose Up
-- Manage Pages: how many pages at a piece's start and end the Sheet Viewer
-- and the Set PDF skip (a cover, a title page, a publisher's catalogue).
-- The piece's own setting, shared by every account. Checked by the handler
-- (at least one page always shown), not by CHECK constraints (a column with
-- one can't be dropped in place).
ALTER TABLE pieces ADD COLUMN skip_start INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pieces ADD COLUMN skip_end INTEGER NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE pieces DROP COLUMN skip_start;
ALTER TABLE pieces DROP COLUMN skip_end;
