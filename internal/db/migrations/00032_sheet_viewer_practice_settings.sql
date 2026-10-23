-- +goose Up
-- The Sheet Viewer's saved settings ("practice settings"), split by kind:
--
-- The clock's choices follow the user to every piece, so they're per
-- account on user_settings: whether the clock shows, clock or stopwatch,
-- and the clock's seconds. Plain ADD COLUMNs with constant defaults; the
-- mode's allowed values are checked by the handler.
--
-- The page's look is per piece: photo filters (brightness and contrast in
-- percent, grayscale, invert), the edge margin, and whether the notes bar
-- shows. A piece with no row uses the defaults below.
ALTER TABLE user_settings ADD COLUMN sheet_viewer_clock_shown INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_settings ADD COLUMN sheet_viewer_clock_mode TEXT NOT NULL DEFAULT 'clock';
ALTER TABLE user_settings ADD COLUMN sheet_viewer_clock_seconds INTEGER NOT NULL DEFAULT 0;

CREATE TABLE piece_practice_settings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    piece_id INTEGER NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
    brightness INTEGER NOT NULL DEFAULT 100,
    contrast INTEGER NOT NULL DEFAULT 100,
    grayscale INTEGER NOT NULL DEFAULT 0,
    invert INTEGER NOT NULL DEFAULT 0,
    edge_margin INTEGER NOT NULL DEFAULT 0,
    notes_bar_shown INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, piece_id)
);

-- +goose Down
DROP TABLE piece_practice_settings;
ALTER TABLE user_settings DROP COLUMN sheet_viewer_clock_seconds;
ALTER TABLE user_settings DROP COLUMN sheet_viewer_clock_mode;
ALTER TABLE user_settings DROP COLUMN sheet_viewer_clock_shown;
