-- +goose Up
-- The Practice Dashboard (the sidebar's Practice).
--
-- piece_practice_status.updated_at: when the user last changed their
-- status on a piece, for Currently Practicing's "most recently changed
-- first". Set by repo.SetUserPracticeStatus; NULL for a status set before
-- this migration, which sorts after the dated ones. (SQLite's ADD COLUMN
-- can't default to CURRENT_TIMESTAMP, so it isn't backfilled.)
ALTER TABLE piece_practice_status ADD COLUMN updated_at TEXT;

-- The dashboard week's Customize settings, per account:
-- practice_history_mode: 'daily' (the last 7 days) or 'target' (this week
-- toward practice_target_days, 1–7); practice_week_start: 'sunday',
-- 'monday', or '' to follow the browser's locale. Checked by the handler,
-- not by CHECK constraints (a column with one can't be dropped in place).
ALTER TABLE user_settings ADD COLUMN practice_history_mode TEXT NOT NULL DEFAULT 'daily';
ALTER TABLE user_settings ADD COLUMN practice_target_days INTEGER NOT NULL DEFAULT 4;
ALTER TABLE user_settings ADD COLUMN practice_week_start TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE user_settings DROP COLUMN practice_week_start;
ALTER TABLE user_settings DROP COLUMN practice_target_days;
ALTER TABLE user_settings DROP COLUMN practice_history_mode;
ALTER TABLE piece_practice_status DROP COLUMN updated_at;
