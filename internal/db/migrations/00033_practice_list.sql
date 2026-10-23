-- +goose Up
-- The Sheet Viewer's Practice List: one saved, ordered queue of pieces per
-- user. A piece is on it at most once; position is its place in the list,
-- rewritten whole on every reorder (0, 1, 2…), and a new piece goes at the
-- end.
CREATE TABLE practice_list_entries (
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    piece_id INTEGER NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (owner_user_id, piece_id)
);

-- Which days a user practiced a piece: a row per user, piece and day — the
-- viewer's local calendar day ('YYYY-MM-DD'), since "today" is the user's,
-- not the server's. practiced = 1 marks it practiced that day; 0 is an
-- explicit unmark, kept so the viewer doesn't mark it again the same day.
-- The practiced rows of a piece, by day, are its practice log.
CREATE TABLE piece_practice_days (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    piece_id INTEGER NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    practiced INTEGER NOT NULL,
    PRIMARY KEY (user_id, piece_id, day)
);

-- User Settings › Sheet Viewer › "Track practice": off, the viewer marks
-- nothing and records nothing. On by default.
ALTER TABLE user_settings ADD COLUMN track_practice INTEGER NOT NULL DEFAULT 1;

-- +goose Down
ALTER TABLE user_settings DROP COLUMN track_practice;
DROP TABLE piece_practice_days;
DROP TABLE practice_list_entries;
