-- +goose Up
-- User Settings' "Dark Mode Scores" (Appearance card): when on, sheet-music
-- page images are shown inverted (light notes on a dark page) while the app
-- is in its dark theme. Per account like the theme preference; off by
-- default. A plain ADD COLUMN with a constant default, nothing to rebuild.
ALTER TABLE user_settings ADD COLUMN dark_mode_scores INTEGER NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE user_settings DROP COLUMN dark_mode_scores;
