-- +goose Up
-- User Settings' Sheet Viewer card: how long after a page turn a second turn
-- the same way is ignored (a double tap, a bouncing pedal), in milliseconds;
-- 0 turns the guard off. Per account, 500 by default. A plain ADD COLUMN with
-- a constant default; the allowed values are checked by the handler.
ALTER TABLE user_settings ADD COLUMN sheet_viewer_turn_guard_ms INTEGER NOT NULL DEFAULT 500;

-- +goose Down
ALTER TABLE user_settings DROP COLUMN sheet_viewer_turn_guard_ms;
