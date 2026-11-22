-- +goose Up
-- One timestamp format: SQLite's own "YYYY-MM-DD HH:MM:SS", in UTC — what
-- CURRENT_TIMESTAMP writes, and so almost every timestamp already. Two
-- kinds of value didn't follow it, and are rewritten here; anything already
-- in the standard format is left exactly as it is.
--
-- 1. Go's time.Time text ("2026-08-21 00:58:10.080045 +0000 UTC", in any
--    zone, sometimes ending in a monotonic "m=+…"), which the driver wrote
--    for pieces.updated_at (Edit Piece and its file actions) and
--    sessions.expires_at (written in the server's local zone, then compared
--    as text with CURRENT_TIMESTAMP, so a session on a non-UTC machine
--    expired hours early or late). Converted to UTC to the second: the
--    first 19 characters are the local time, the " ±hhmm" after them its
--    offset. The repo writes the standard format from now on.
-- 2. piece_practice_status.updated_at (00041) as ISO "…T…Z" with
--    milliseconds: the same layout with a space, milliseconds kept
--    ("2026-11-19 10:00:00.123"), which sorts with the standard format.
--
-- Rewriting a value to the same instant in another layout changes nothing
-- the app shows (it reads either one), so there's nothing to undo.

UPDATE pieces SET updated_at = datetime(substr(updated_at, 1, 19), printf('%d minutes',
    -(CAST(substr(updated_at, instr(substr(updated_at, 20), ' ') + 20, 3) AS INTEGER) * 60
      + (CASE substr(updated_at, instr(substr(updated_at, 20), ' ') + 20, 1) WHEN '-' THEN -1 ELSE 1 END)
        * CAST(substr(updated_at, instr(substr(updated_at, 20), ' ') + 23, 2) AS INTEGER))))
WHERE updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'
  AND substr(updated_at, instr(substr(updated_at, 20), ' ') + 19, 6) GLOB ' [+-][0-9][0-9][0-9][0-9]';

UPDATE sessions SET expires_at = datetime(substr(expires_at, 1, 19), printf('%d minutes',
    -(CAST(substr(expires_at, instr(substr(expires_at, 20), ' ') + 20, 3) AS INTEGER) * 60
      + (CASE substr(expires_at, instr(substr(expires_at, 20), ' ') + 20, 1) WHEN '-' THEN -1 ELSE 1 END)
        * CAST(substr(expires_at, instr(substr(expires_at, 20), ' ') + 23, 2) AS INTEGER))))
WHERE expires_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'
  AND substr(expires_at, instr(substr(expires_at, 20), ' ') + 19, 6) GLOB ' [+-][0-9][0-9][0-9][0-9]';

UPDATE piece_practice_status SET updated_at = replace(substr(updated_at, 1, 23), 'T', ' ')
WHERE updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z';

-- +goose Down
-- Nothing to undo: every value is the same instant, in a layout the app
-- reads as well as the old one.
SELECT 1;
