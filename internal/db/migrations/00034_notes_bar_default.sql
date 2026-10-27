-- +goose Up
-- User Settings › Sheet Viewer › "Show practice notes as banner": whether
-- the notes bar shows on a piece whose banner the user hasn't set, off by
-- default.
--
-- A piece's own choice becomes three-way: notes_bar is 1 (shown), 0
-- (hidden) or NULL (not chosen: follow the user's setting). It replaces
-- notes_bar_shown, whose 0 couldn't tell "hidden on purpose" from "never
-- touched" (a row saved for a brightness change carried it too). A stored
-- 1 is kept; a stored 0 becomes NULL, which shows the same as long as the
-- setting stays off.
ALTER TABLE user_settings ADD COLUMN sheet_viewer_notes_bar_default INTEGER NOT NULL DEFAULT 0;
ALTER TABLE piece_practice_settings ADD COLUMN notes_bar INTEGER;
UPDATE piece_practice_settings SET notes_bar = 1 WHERE notes_bar_shown = 1;
ALTER TABLE piece_practice_settings DROP COLUMN notes_bar_shown;
-- A row left holding nothing but defaults is what the app never stores.
DELETE FROM piece_practice_settings
WHERE brightness = 100 AND contrast = 100 AND grayscale = 0 AND invert = 0
    AND edge_margin = 0 AND notes_bar IS NULL;

-- +goose Down
ALTER TABLE piece_practice_settings ADD COLUMN notes_bar_shown INTEGER NOT NULL DEFAULT 0;
UPDATE piece_practice_settings SET notes_bar_shown = 1 WHERE notes_bar = 1;
ALTER TABLE piece_practice_settings DROP COLUMN notes_bar;
ALTER TABLE user_settings DROP COLUMN sheet_viewer_notes_bar_default;
