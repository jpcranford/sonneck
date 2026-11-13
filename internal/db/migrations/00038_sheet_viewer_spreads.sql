-- +goose Up
-- The Sheet Viewer showing more than one page on bigger screens. Per user
-- and piece, on piece_practice_settings: Display's Pages ('auto' as many as
-- fit, 'one') and Turn ('spread', 'slide'), each NULL to follow the user's
-- default; Page 1 alone; and the pages kept together with the next one, as
-- a comma-separated list ("4,9" keeps 4–5 and 9–10 together), NULL for
-- none. Checked by the handler, not by CHECK constraints (a column with one
-- can't be dropped in place).
--
-- Per user, on user_settings: the defaults for Pages and Turn.
ALTER TABLE piece_practice_settings ADD COLUMN pages TEXT;
ALTER TABLE piece_practice_settings ADD COLUMN turn TEXT;
ALTER TABLE piece_practice_settings ADD COLUMN first_alone INTEGER NOT NULL DEFAULT 0;
ALTER TABLE piece_practice_settings ADD COLUMN links TEXT;
ALTER TABLE user_settings ADD COLUMN sheet_viewer_pages TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE user_settings ADD COLUMN sheet_viewer_turn TEXT NOT NULL DEFAULT 'spread';

-- +goose Down
ALTER TABLE piece_practice_settings DROP COLUMN pages;
ALTER TABLE piece_practice_settings DROP COLUMN turn;
ALTER TABLE piece_practice_settings DROP COLUMN first_alone;
ALTER TABLE piece_practice_settings DROP COLUMN links;
ALTER TABLE user_settings DROP COLUMN sheet_viewer_pages;
ALTER TABLE user_settings DROP COLUMN sheet_viewer_turn;
